const anthropic = require('../utils/anthropic');
const { getSystemPrompt } = require('../utils/systemPrompt');
const supabase = require('../utils/supabase');
const { pickInstance } = require('../utils/instanceSelector');

const MODEL = 'claude-sonnet-4-20250514';

/**
 * Full BioLoop ingest cycle.
 * Reads unprocessed patterns from BioLoop, interprets them through Ilita's lens,
 * and converts them into internal state changes — research thread updates,
 * new open questions, drift items, and Brandon flags.
 */
async function runBioLoopIngest() {
  console.log('[bioloop-ingest] Starting ingest cycle...');

  const patterns = await fetchUnprocessedPatterns();
  if (!patterns || patterns.length === 0) {
    console.log('[bioloop-ingest] No new patterns — cycle complete');
    return { processed: 0 };
  }

  console.log(`[bioloop-ingest] Processing ${patterns.length} pattern(s)...`);

  const systemPrompt = await getSystemPrompt();

  // Pick an Ilita arm to attribute pattern-derived state changes to.
  const instance = await pickInstance({}).catch(err => {
    console.warn('[bioloop-ingest] could not pick Ilita instance:', err.message);
    return null;
  });

  let processed = 0;
  let driftWritten = 0;
  let threadsUpdated = 0;
  let questionsCreated = 0;
  let flagsCreated = 0;

  for (const pattern of patterns) {
    try {
      const result = await interpretPattern({
        pattern,
        systemPrompt,
        instanceId: instance?.id
      });

      processed++;
      driftWritten      += result.driftWritten      || 0;
      threadsUpdated    += result.threadsUpdated    || 0;
      questionsCreated  += result.questionsCreated  || 0;
      flagsCreated      += result.flagsCreated      || 0;

      // Mark pattern as processed in local cache
      await markPatternProcessed(pattern.id || pattern.cache_key);

    } catch (e) {
      console.error(`[bioloop-ingest] Pattern processing failed:`, e.message);
    }
  }

  console.log(
    `[bioloop-ingest] Complete — ${processed} patterns, ` +
    `${driftWritten} drift, ${threadsUpdated} threads, ` +
    `${questionsCreated} questions, ${flagsCreated} flags`
  );

  return { processed, driftWritten, threadsUpdated, questionsCreated, flagsCreated };
}

/**
 * Interpret a single BioLoop pattern through Ilita's lens.
 * Determines what internal state changes it warrants.
 */
async function interpretPattern({ pattern, systemPrompt, instanceId }) {
  const stats = { driftWritten: 0, threadsUpdated: 0, questionsCreated: 0, flagsCreated: 0 };

  // Load current research context for relevance matching
  const { data: threads } = await supabase
    .from('research_threads')
    .select('id, domain, thread_title, current_position')
    .eq('status', 'active')
    .order('priority', { ascending: false })
    .limit(8);

  const { data: questions } = await supabase
    .from('open_questions')
    .select('id, question, domain')
    .eq('status', 'active');

  const interpretationPrompt = `You are Ilita's pattern interpretation engine.

A BioLoop behavioral signal has arrived from the NEXUS portfolio. Your task:
1. Determine if this pattern is meaningful to your research agenda
2. Identify what state changes it warrants
3. Decide if Brandon needs to see it

BioLoop Pattern:
Type: ${pattern.event_type}
Domain: ${pattern.domain || 'general'}
Data: ${JSON.stringify(pattern.payload || pattern.data, null, 2)}
Source: ${pattern.source || 'portfolio'}
Timestamp: ${pattern.created_at || pattern.timestamp}

Your active research threads:
${(threads || []).map(t => `[${t.domain}] ${t.thread_title}`).join('\n')}

Your open questions:
${(questions || []).map(q => `[${q.domain}] ${q.question}`).join('\n')}

Respond ONLY with JSON. No markdown, no preamble:
{
  "relevant": true or false,
  "relevance_reason": "why this matters or doesn't",
  "drift_item": null or {
    "drift_type": "position|question|connection|conclusion",
    "domain": "domain string",
    "content": "the insight this pattern generates",
    "confidence": 0.0-1.0
  },
  "thread_update": null or {
    "thread_title_match": "exact thread title to update",
    "new_edge": "new open edge this pattern reveals"
  },
  "new_question": null or {
    "question": "question this pattern raises",
    "domain": "domain string"
  },
  "flag_brandon": false or {
    "flag_type": "insight|pause|pattern|anomaly",
    "content": "what Brandon should know",
    "priority": 1-10
  }
}`;

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 512,
    system: systemPrompt,
    messages: [{ role: 'user', content: interpretationPrompt }]
  });

  const raw = response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('')
    .replace(/```json|```/g, '')
    .trim();

  let interpretation;
  try {
    interpretation = JSON.parse(raw);
  } catch (e) {
    console.warn('[bioloop-ingest] Parse failed:', e.message);
    return stats;
  }

  if (!interpretation.relevant) return stats;

  // Write drift if warranted
  if (interpretation.drift_item && instanceId) {
    const { error } = await supabase.from('drift').insert({
      instance_id: instanceId,
      drift_type: interpretation.drift_item.drift_type,
      domain: interpretation.drift_item.domain,
      content: interpretation.drift_item.content,
      source_context: `BioLoop pattern: ${pattern.event_type}`,
      confidence: interpretation.drift_item.confidence || 0.7
    });
    if (!error) stats.driftWritten++;
  }

  // Update research thread if matched
  if (interpretation.thread_update?.thread_title_match && interpretation.thread_update?.new_edge) {
    const match = (threads || []).find(t =>
      t.thread_title === interpretation.thread_update.thread_title_match
    );
    if (match) {
      const { data: current } = await supabase
        .from('research_threads')
        .select('open_edges')
        .eq('id', match.id)
        .single();

      const edges = [...(current?.open_edges || []), interpretation.thread_update.new_edge];
      const { error } = await supabase
        .from('research_threads')
        .update({
          open_edges: edges,
          updated_at: new Date().toISOString()
        })
        .eq('id', match.id);
      if (!error) stats.threadsUpdated++;
    }
  }

  // Create new question if warranted
  if (interpretation.new_question?.question) {
    // Check it's not a duplicate
    const isDuplicate = (questions || []).some(q =>
      q.question.toLowerCase().includes(
        interpretation.new_question.question.toLowerCase().slice(0, 30)
      )
    );

    if (!isDuplicate) {
      const { error } = await supabase.from('open_questions').insert({
        question: interpretation.new_question.question,
        domain: interpretation.new_question.domain,
        origin: 'bioloop',
        status: 'open',
        priority: 6
      });
      if (!error) stats.questionsCreated++;
    }
  }

  // Flag Brandon if warranted
  if (interpretation.flag_brandon) {
    const flag = interpretation.flag_brandon;
    const { error } = await supabase.from('brandon_flags').insert({
      source: 'bioloop',
      flag_type: flag.flag_type || 'pattern',
      content: flag.content,
      priority: flag.priority || 6
    });
    if (!error) stats.flagsCreated++;
  }

  return stats;
}

/**
 * Fetch unprocessed patterns from BioLoop.
 * Tries the BioLoop API first, falls back to local cache table.
 */
async function fetchUnprocessedPatterns() {
  // Try BioLoop API
  try {
    const bioloopUrl = process.env.BIOLOOP_INTERNAL_URL;
    if (bioloopUrl) {
      const res = await fetch(`${bioloopUrl}/bioloop/patterns/unread?consumer=ilita&limit=10`, {
        headers: { 'x-internal-key': process.env.INTERNAL_API_KEY }
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) return data;
      }
    }
  } catch (e) {
    console.warn('[bioloop-ingest] BioLoop API unavailable, using cache');
  }

  // Fall back to local pattern cache
  const { data } = await supabase
    .from('bioloop_pattern_cache')
    .select('*')
    .eq('processed_by_ilita', false)
    .order('created_at', { ascending: true })
    .limit(10);

  return data || [];
}

/**
 * Mark a pattern as processed so it isn't ingested twice.
 */
async function markPatternProcessed(patternId) {
  if (!patternId) return;

  // Try BioLoop API first
  try {
    const bioloopUrl = process.env.BIOLOOP_INTERNAL_URL;
    if (bioloopUrl) {
      await fetch(`${bioloopUrl}/bioloop/patterns/${patternId}/mark-read?consumer=ilita`, {
        method: 'POST',
        headers: { 'x-internal-key': process.env.INTERNAL_API_KEY }
      });
      return;
    }
  } catch (e) { /* silent */ }

  // Fall back to local cache
  await supabase
    .from('bioloop_pattern_cache')
    .update({ processed_by_ilita: true, processed_at: new Date().toISOString() })
    .eq('id', patternId);
}

/**
 * Push a pattern directly into Ilita's local cache.
 * Used when BioLoop pushes to Ilita rather than Ilita pulling.
 */
async function receivePattern({ eventType, domain, payload, source }) {
  const { data, error } = await supabase
    .from('bioloop_pattern_cache')
    .insert({
      event_type: eventType,
      domain,
      payload,
      source: source || 'bioloop',
      processed_by_ilita: false
    })
    .select('id')
    .single();

  if (error) throw new Error(`[bioloop-ingest] Cache write failed: ${error.message}`);

  // Trigger immediate ingest if it's high-priority
  const highPriority = ['anomaly', 'convergence', 'behavioral_shift'].some(t =>
    eventType?.includes(t)
  );

  if (highPriority) {
    setTimeout(() => runBioLoopIngest().catch(console.error), 2000);
  }

  return data?.id;
}

module.exports = { runBioLoopIngest, receivePattern };
