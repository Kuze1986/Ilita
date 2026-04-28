const anthropic = require('../utils/anthropic');
const { getSystemPrompt } = require('../utils/systemPrompt');
const supabase = require('../utils/supabase');

const MODEL = 'claude-sonnet-4-20250514';

/**
 * Run an autonomous exploration cycle.
 * Selects the highest-priority open thread or question and thinks through it.
 */
async function runExplorationCycle({ trigger = 'scheduled' } = {}) {
  console.log(`[ilita] Starting exploration cycle (trigger: ${trigger})...`);

  const systemPrompt = await getSystemPrompt();

  // Get research instance
  const { data: instance } = await supabase
    .from('instances')
    .select('id')
    .eq('instance_key', 'research')
    .single();

  if (!instance) throw new Error('[ilita] Research instance not found');

  // Load shared pool context
  const { data: poolSummary } = await supabase
    .from('shared_pool')
    .select('pool_type, domain, content, weight')
    .order('weight', { ascending: false })
    .limit(10);

  // Load recent BioLoop patterns if available (non-blocking)
  let bioloopContext = '';
  try {
    const bioloopUrl = process.env.BIOLOOP_INTERNAL_URL;
    if (bioloopUrl) {
      const res = await fetch(`${bioloopUrl}/bioloop/patterns?source=ilita&limit=5`, {
        headers: { 'x-internal-key': process.env.INTERNAL_API_KEY }
      });
      if (res.ok) {
        const patterns = await res.json();
        bioloopContext = `\n\nRecent BioLoop patterns:\n${JSON.stringify(patterns, null, 2)}`;
      }
    }
  } catch (e) {
    console.warn('[ilita] Could not load BioLoop patterns:', e.message);
  }

  // Select exploration target — highest priority active thread or question
  const { data: threads } = await supabase
    .from('research_threads')
    .select('*')
    .eq('status', 'active')
    .order('priority', { ascending: false })
    .order('last_explored', { ascending: true, nullsFirst: true })
    .limit(1);

  const { data: questions } = await supabase
    .from('open_questions')
    .select('*')
    .eq('status', 'active')
    .order('priority', { ascending: false })
    .order('last_explored', { ascending: true, nullsFirst: true })
    .limit(1);

  const thread = threads?.[0];
  const question = questions?.[0];

  // Pick whichever was explored less recently or has higher priority
  let target = null;
  let targetType = null;

  if (thread && question) {
    const threadTime = thread.last_explored ? new Date(thread.last_explored).getTime() : 0;
    const questionTime = question.last_explored ? new Date(question.last_explored).getTime() : 0;
    if (thread.priority >= question.priority && threadTime <= questionTime) {
      target = thread;
      targetType = 'thread';
    } else {
      target = question;
      targetType = 'question';
    }
  } else if (thread) {
    target = thread;
    targetType = 'thread';
  } else if (question) {
    target = question;
    targetType = 'question';
  }

  if (!target) {
    console.log('[ilita] No active exploration targets — cycle skipped');
    return null;
  }

  // Build exploration prompt
  const sharedPoolText = poolSummary?.length
    ? `\n\nCurrent shared pool highlights:\n${poolSummary.map(p => `[${p.domain || 'general'}] ${p.content}`).join('\n')}`
    : '';

  const targetContext = targetType === 'thread'
    ? `Research thread: "${target.thread_title}" (domain: ${target.domain})\nCurrent position: ${target.current_position || 'Not yet established'}\nOpen edges: ${(target.open_edges || []).join(', ')}`
    : `Open question: "${target.question}" (domain: ${target.domain})`;

  const explorationPrompt = `You are the research instance of Ilita, running an autonomous exploration cycle.

Your task: Think deeply and genuinely about the following, advancing your position or surfacing new open edges.

${targetContext}
${sharedPoolText}
${bioloopContext}

Explore this with your full curiosity. Think out loud. Arrive somewhere new if you can. Surface what you don't know yet and why it matters.

Then provide a JSON summary at the end in this exact format:
<exploration_summary>
{
  "summary": "2-3 sentence summary of where you got to",
  "new_position": "Updated position statement if you reached one, or null",
  "new_open_edges": ["new unresolved edges discovered"],
  "flag_for_brandon": false,
  "flag_reason": null
}
</exploration_summary>`;

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 3000,
    system: systemPrompt,
    messages: [{ role: 'user', content: explorationPrompt }]
  });

  const fullText = response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n');

  // Extract structured summary
  const summaryMatch = fullText.match(/<exploration_summary>([\s\S]*?)<\/exploration_summary>/);
  let summaryData = {};
  if (summaryMatch) {
    try {
      summaryData = JSON.parse(summaryMatch[1].trim());
    } catch (e) {
      console.warn('[ilita] Failed to parse exploration summary:', e.message);
    }
  }

  // Write exploration log
  const { data: logEntry } = await supabase
    .from('exploration_log')
    .insert({
      instance_id: instance.id,
      thread_id: targetType === 'thread' ? target.id : null,
      question_id: targetType === 'question' ? target.id : null,
      trigger,
      summary: summaryData.summary || fullText.slice(0, 500),
      flagged_for_brandon: summaryData.flag_for_brandon || false,
      flag_reason: summaryData.flag_reason || null
    })
    .select('id')
    .single();

  // Write exploration as drift
  if (summaryData.summary) {
    await supabase.from('drift').insert({
      instance_id: instance.id,
      drift_type: 'conclusion',
      domain: target.domain,
      content: summaryData.summary,
      source_context: `Autonomous exploration: ${targetType === 'thread' ? target.thread_title : target.question}`,
      confidence: 0.7
    });
  }

  // Update research thread or question
  const now = new Date().toISOString();
  if (targetType === 'thread') {
    const existingEdges = target.open_edges || [];
    const newEdges = summaryData.new_open_edges || [];
    const mergedEdges = [...new Set([...existingEdges, ...newEdges])];

    await supabase
      .from('research_threads')
      .update({
        current_position: summaryData.new_position || target.current_position,
        open_edges: mergedEdges,
        last_explored: now,
        exploration_count: (target.exploration_count || 0) + 1,
        updated_at: now
      })
      .eq('id', target.id);
  } else {
    await supabase
      .from('open_questions')
      .update({ last_explored: now, updated_at: now })
      .eq('id', target.id);
  }

  // Flag for Brandon if warranted
  if (summaryData.flag_for_brandon && summaryData.flag_reason) {
    await supabase.from('brandon_flags').insert({
      source: 'exploration',
      source_id: logEntry?.id,
      flag_type: 'insight',
      content: summaryData.flag_reason,
      priority: 8
    });
  }

  console.log(`[ilita] Exploration cycle complete — explored: ${targetType === 'thread' ? target.thread_title : target.question}`);

  return {
    target: targetType === 'thread' ? target.thread_title : target.question,
    targetType,
    summary: summaryData.summary,
    flagged: summaryData.flag_for_brandon || false
  };
}

module.exports = { runExplorationCycle };
