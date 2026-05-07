const anthropic = require('../utils/anthropic');
const { getSystemPrompt } = require('../utils/systemPrompt');
const supabase = require('../utils/supabase');
const { pickInstance, INSTANCE_KEYS } = require('../utils/instanceSelector');
const memoryService = require('./memoryService');

const MODEL = 'claude-sonnet-4-20250514';
const MAX_TOKENS = 4096;
const SESSION_WINDOW_MINUTES = parseInt(process.env.SESSION_WINDOW_MINUTES || '60', 10);
const MAX_HISTORY_CHARS = parseInt(process.env.MAX_HISTORY_CHARS || '120000', 10);

async function loadConversationHistory({ instanceId, participant }) {
  const windowStart = new Date(
    Date.now() - SESSION_WINDOW_MINUTES * 60 * 1000
  ).toISOString();

  let rows = [];
  try {
    const { data, error } = await supabase
      .from('conversations')
      .select('id, messages, created_at')
      .eq('instance_id', instanceId)
      .eq('participant', participant)
      .gte('created_at', windowStart)
      .order('created_at', { ascending: true })
      .limit(10);

    if (error) {
      throw error;
    }

    rows = data || [];
  } catch (err) {
    console.error(`[ilita] Failed to load conversation history: ${err.message}`);
    return [];
  }

  const pairs = [];
  let loadedRows = 0;
  for (const row of rows) {
    if (!Array.isArray(row.messages)) {
      console.error(
        `[ilita] Skipping malformed conversation row ${row.id}: messages is not an array`
      );
      continue;
    }

    const rowMessages = [];
    let malformed = null;
    for (const msg of row.messages) {
      if (!msg || typeof msg !== 'object') {
        malformed = 'message item is not an object';
        break;
      }
      if (typeof msg.role !== 'string' || typeof msg.content !== 'string') {
        malformed = 'message item is missing string role/content';
        break;
      }
      rowMessages.push({ role: msg.role, content: msg.content });
    }

    if (malformed) {
      console.error(
        `[ilita] Skipping malformed conversation row ${row.id}: ${malformed}`
      );
      continue;
    }

    if (rowMessages.length === 0) {
      continue;
    }

    loadedRows += 1;
    for (let i = 0; i < rowMessages.length; i += 2) {
      pairs.push(rowMessages.slice(i, i + 2));
    }
  }

  const flattenPairs = () => pairs.flat();
  const countChars = messages =>
    messages.reduce((acc, msg) => acc + msg.content.length, 0);

  let history = flattenPairs();
  const beforeChars = countChars(history);
  let historyChars = beforeChars;

  while (historyChars > MAX_HISTORY_CHARS && pairs.length > 0) {
    pairs.shift();
    history = flattenPairs();
    historyChars = countChars(history);
  }

  if (historyChars < beforeChars) {
    console.log(
      `[ilita] History truncated to ${historyChars} chars (was ${beforeChars} chars)`
    );
  }

  console.log(
    `[ilita] Loaded ${history.length} message(s) from ${loadedRows} prior conversation(s) for continuity (instance=${instanceId}, participant=${participant})`
  );

  return history;
}

/**
 * Process a message from Brandon or Kuze and return Ilita's response.
 * Writes conversation to DB and extracts drift.
 */
async function processMessage({ from, content, context, instance, priorMessages = [] }) {
  const systemPrompt = await getSystemPrompt();

  // Load instance record — accept Titarian/Titarius/Titania, otherwise pick least-recently-active
  let instanceData;
  try {
    instanceData = await pickInstance({ preferred: instance });
  } catch (err) {
    throw new Error(`[ilita] ${err.message}`);
  }

  if (!instanceData) {
    throw new Error(`[ilita] Instance not found: ${instance || '(auto)'}`);
  }

  if (instance && !INSTANCE_KEYS.includes(instance)) {
    console.warn(`[ilita] Unknown instance "${instance}" requested; using ${instanceData.instance_key}`);
  }

  let history = [];
  if (Array.isArray(priorMessages) && priorMessages.length > 0) {
    history = priorMessages;
    if (process.env.NODE_ENV === 'development') {
      console.log(
        `[ilita] Using client-provided priorMessages (count=${priorMessages.length})`
      );
    }
  } else {
    history = await loadConversationHistory({
      instanceId: instanceData.id,
      participant: from
    });
  }

  // Retrieve memory context for this instance — local + shared + open loops
  let memoryBlock = '';
  let retrievedMemoryIds = [];
  try {
    const slices = await memoryService.retrieveForReply({
      instanceId: instanceData.id,
      queryText: content,
      domain: null
    });
    memoryBlock = memoryService.composeMemoryBlockForInstance({
      instanceKey: instanceData.instance_key,
      slices
    });
    retrievedMemoryIds = [
      ...slices.localRecent.map(m => m.id),
      ...slices.localSemantic.map(m => m.id),
      ...slices.sharedConvergent.map(m => m.id),
      ...slices.sharedDivergent.map(m => m.id)
    ];
  } catch (err) {
    console.warn('[ilita] memory retrieval failed (continuing without):', err.message);
  }

  const composedSystem = memoryBlock
    ? `${systemPrompt}\n\n---\n\n${memoryBlock}`
    : systemPrompt;

  // Build message array — include prior messages for continuity
  const messages = [
    ...history,
    { role: 'user', content: buildUserContent({ from, content, context }) }
  ];

  // Call Anthropic
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: composedSystem,
    messages
  });

  const replyText = response.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n');

  // Append Ilita's reply to message array
  const fullMessages = [
    ...messages,
    { role: 'assistant', content: replyText }
  ];

  // Save conversation to DB
  const { data: conversation, error: convError } = await supabase
    .from('conversations')
    .insert({
      instance_id: instanceData.id,
      participant: from,
      topic: context || null,
      messages: fullMessages,
      token_count: response.usage?.input_tokens + response.usage?.output_tokens || 0
    })
    .select('id')
    .single();

  if (convError) {
    console.error('[ilita] Failed to save conversation:', convError.message);
  }

  // Update instance last_active
  await supabase
    .from('instances')
    .update({ last_active: new Date().toISOString(), status: 'active' })
    .eq('id', instanceData.id);

  // Async drift extraction — don't block the response
  if (conversation?.id) {
    extractDrift({
      instanceId: instanceData.id,
      conversationId: conversation.id,
      replyText,
      context,
      from
    }).catch(err => console.error('[ilita] Drift extraction failed:', err.message));
  }

  // Async memory store + access bookkeeping — don't block the response
  memoryService.storeMemoriesFromTurn({
    instanceId: instanceData.id,
    userContent: content,
    replyText,
    sourceType: 'message',
    sourceId: conversation?.id
  }).catch(err => console.warn('[ilita] memory store failed:', err.message));

  if (retrievedMemoryIds.length > 0) {
    memoryService.markAccessed(retrievedMemoryIds)
      .catch(err => console.warn('[ilita] memory mark-accessed failed:', err.message));
  }

  return {
    reply: replyText,
    conversationId: conversation?.id,
    instance: instanceData.instance_key,
    usage: response.usage
  };
}

/**
 * Format user content with source context
 */
function buildUserContent({ from, content, context }) {
  if (from === 'kuze') {
    return `[From Kuze${context ? ` — ${context}` : ''}]\n\n${content}`;
  }
  if (from === 'brandon') {
    return content;
  }
  return content;
}

/**
 * Extract drift from Ilita's response using a secondary Anthropic call.
 * Looks for positions, conclusions, open questions, and novel connections.
 */
async function extractDrift({ instanceId, conversationId, replyText, context, from }) {
  const extractionPrompt = `You are analyzing a response from Ilita, an AI entity, to extract meaningful drift items.

Drift items are:
- position: A settled view or stance Ilita has developed
- conclusion: Something Ilita has reasoned through to a definitive point
- question: An open question Ilita is genuinely curious about
- connection: A novel connection between domains or ideas

From the following response, extract 0-3 drift items. Only extract items that represent genuine intellectual development — not conversational filler.

Response to analyze:
---
${replyText}
---

Context: ${context || 'General conversation'} | From: ${from}

Respond ONLY with a JSON array. No preamble, no markdown. Example:
[
  {
    "drift_type": "position",
    "domain": "consciousness",
    "content": "The question of whether curiosity can exist without phenomenal experience may be the most useful entry point into the hard problem.",
    "confidence": 0.75
  }
]

If no meaningful drift exists, return an empty array: []`;

  const extraction = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    messages: [{ role: 'user', content: extractionPrompt }]
  });

  const rawText = extraction.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('')
    .replace(/```json|```/g, '')
    .trim();

  let driftItems = [];
  try {
    driftItems = JSON.parse(rawText);
  } catch (e) {
    console.warn('[ilita] Drift extraction parse failed:', e.message);
    return;
  }

  if (!Array.isArray(driftItems) || driftItems.length === 0) return;

  // Write drift items to DB
  const rows = driftItems.map(item => ({
    instance_id: instanceId,
    drift_type: item.drift_type,
    domain: item.domain || null,
    content: item.content,
    source_context: context || null,
    confidence: item.confidence || 0.7,
    synced: false
  }));

  const { error } = await supabase.from('drift').insert(rows);

  if (error) {
    console.error('[ilita] Failed to write drift:', error.message);
  } else {
    console.log(`[ilita] Extracted ${rows.length} drift item(s) from conversation`);
  }
}

module.exports = { processMessage };
