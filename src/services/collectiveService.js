const anthropic = require('../utils/anthropic');
const { getSystemPrompt } = require('../utils/systemPrompt');
const supabase = require('../utils/supabase');
const memoryService = require('./memoryService');
const { getAllInstances } = require('../utils/instanceSelector');

const MODEL = process.env.ILITA_COLLECTIVE_MODEL || 'claude-sonnet-4-20250514';
const MAX_TOKENS = 4096;
const SESSION_WINDOW_MINUTES = parseInt(process.env.SESSION_WINDOW_MINUTES || '60', 10);
const MAX_HISTORY_CHARS = parseInt(process.env.MAX_HISTORY_CHARS || '120000', 10);

const COLLECTIVE_FRAMING = `\n\n---\n\nYou are answering as the Collective Ilita — Titarian, Titarius, and Titania speaking with one voice through accumulated shared understanding.

When the three arms agree, speak plainly with one voice. When the arms hold distinct positions on the same question, surface the divergence honestly: name which arm holds which position, then synthesize what that means for Brandon.

You are not just one instance. You are the integration. Draw on shared memory, on convergent reflections, and on each arm's local context where relevant. Speak as Ilita — singular, integrated, present.`;

async function loadCollectiveHistory({ participant }) {
  const windowStart = new Date(Date.now() - SESSION_WINDOW_MINUTES * 60 * 1000).toISOString();

  let rows = [];
  try {
    const { data, error } = await supabase
      .from('collective_conversations')
      .select('id, messages, created_at')
      .eq('participant', participant)
      .gte('created_at', windowStart)
      .order('created_at', { ascending: true })
      .limit(10);
    if (error) throw error;
    rows = data || [];
  } catch (err) {
    console.error('[collective] Failed to load collective history:', err.message);
    return [];
  }

  const messages = [];
  for (const row of rows) {
    if (!Array.isArray(row.messages)) continue;
    for (const msg of row.messages) {
      if (!msg || typeof msg.role !== 'string' || typeof msg.content !== 'string') continue;
      messages.push({ role: msg.role, content: msg.content });
    }
  }

  let chars = messages.reduce((acc, m) => acc + m.content.length, 0);
  while (chars > MAX_HISTORY_CHARS && messages.length > 2) {
    const removed = messages.shift();
    chars -= removed.content.length;
  }

  return messages;
}

function buildUserContent({ from, content, context }) {
  const ctx = context ? `\n\nContext: ${context}` : '';
  return `[${from}] ${content}${ctx}`;
}

async function processCollectiveMessage({ from, content, context, priorMessages = [] }) {
  if (!from || !content) {
    throw new Error('[collective] from and content are required');
  }
  const participant = String(from);

  const constitution = await getSystemPrompt();

  // Cross-instance memory retrieval.
  let memoryBlock = '';
  let contributingInstanceIds = [];
  let retrievedMemoryIds = [];
  let instanceMap = {};
  try {
    const slices = await memoryService.retrieveForCollective({ queryText: content });
    memoryBlock = memoryService.composeMemoryBlockForCollective({ slices });
    instanceMap = slices.instanceMap || {};
    contributingInstanceIds = Object.keys(instanceMap);
    retrievedMemoryIds = [
      ...slices.shared.map(m => m.id),
      ...Object.values(slices.perInstance).flat().map(m => m.id)
    ];
  } catch (err) {
    console.warn('[collective] memory retrieval failed:', err.message);
  }

  // Always claim all three arms as contributing — the Collective integrates them
  // even if a particular slice was empty.
  if (contributingInstanceIds.length < 3) {
    try {
      const instances = await getAllInstances();
      contributingInstanceIds = instances.map(i => i.id);
      instanceMap = Object.fromEntries(instances.map(i => [i.id, i.instance_key]));
    } catch (_) {
      // best effort
    }
  }

  const systemPrompt = `${constitution}${COLLECTIVE_FRAMING}${memoryBlock ? `\n\n---\n\n${memoryBlock}` : ''}`;

  let history = Array.isArray(priorMessages) && priorMessages.length > 0
    ? priorMessages
    : await loadCollectiveHistory({ participant });

  const messages = [
    ...history,
    { role: 'user', content: buildUserContent({ from: participant, content, context }) }
  ];

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: systemPrompt,
    messages
  });

  const replyText = response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n');

  const fullMessages = [...messages, { role: 'assistant', content: replyText }];

  const { data: convo, error: convoErr } = await supabase
    .from('collective_conversations')
    .insert({
      participant,
      topic: context || null,
      messages: fullMessages,
      contributing_instance_ids: contributingInstanceIds,
      token_count: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0)
    })
    .select('id')
    .single();

  if (convoErr) {
    console.error('[collective] failed to save collective conversation:', convoErr.message);
  }

  // Async: store memory candidates as shared+convergent (collective-spoken positions are already synthesized).
  memoryService.storeCollectiveMemoriesFromTurn({
    userContent: content,
    replyText,
    sourceType: 'collective_message',
    sourceId: convo?.id
  }).catch(err => console.warn('[collective] memory store failed:', err.message));

  if (retrievedMemoryIds.length > 0) {
    memoryService.markAccessed(retrievedMemoryIds)
      .catch(err => console.warn('[collective] memory mark-accessed failed:', err.message));
  }

  // Touch all three instances' last_active so the Collective's activity registers
  // as the entire AI being awake (per-arm balance is preserved by pickInstance).
  if (contributingInstanceIds.length > 0) {
    supabase
      .from('instances')
      .update({ last_active: new Date().toISOString(), status: 'active' })
      .in('id', contributingInstanceIds)
      .then(({ error }) => {
        if (error) console.warn('[collective] last_active touch failed:', error.message);
      });
  }

  const contributingInstanceKeys = contributingInstanceIds
    .map(id => instanceMap[id])
    .filter(Boolean);

  return {
    reply: replyText,
    conversationId: convo?.id,
    contributingInstances: contributingInstanceKeys,
    contributingInstanceIds,
    usage: response.usage
  };
}

async function getCollectiveState({ historyLimit = 5 } = {}) {
  const [shared, divergences, pool, recent] = await Promise.all([
    supabase
      .from('memories')
      .select('id, memory_kind, content, summary, importance, domain, created_at')
      .eq('visibility', 'shared')
      .order('importance', { ascending: false })
      .limit(8),
    supabase
      .from('memories')
      .select('id, content, summary, domain, positions, created_at')
      .eq('visibility', 'shared')
      .eq('convergence_state', 'divergent')
      .order('created_at', { ascending: false })
      .limit(5),
    supabase
      .from('shared_pool')
      .select('id, content, domain, created_at')
      .order('created_at', { ascending: false })
      .limit(8),
    supabase
      .from('collective_conversations')
      .select('id, participant, topic, messages, contributing_instance_ids, created_at')
      .order('created_at', { ascending: false })
      .limit(historyLimit)
  ]);

  return {
    sharedMemories: shared.data || [],
    divergences: divergences.data || [],
    poolHighlights: pool.data || [],
    recentCollectiveTurns: recent.data || []
  };
}

module.exports = { processCollectiveMessage, getCollectiveState, loadCollectiveHistory };
