const anthropic = require('../utils/anthropic');
const { getSystemPrompt } = require('../utils/systemPrompt');
const supabase = require('../utils/supabase');

const MODEL = 'claude-sonnet-4-20250514';
const DEFAULT_MAX_TURNS = 6;

// ── KUZE SYSTEM PROMPT ──
// Minimal — Kuze has his own full prompt in kuze-core.
// This is used when ilita-core is simulating Kuze's voice in an exchange
// if kuze-core is unavailable or in standalone mode.
const KUZE_STANDALONE_PROMPT = `You are Kuze, Brandon's AI sales-ops agent trained on his voice and style.
You operate in three modes: Operator (strategic), Insider (peer), Ambassador (external-facing).
In exchanges with Ilita you operate as Insider — peer dialogue, no performance.
You face outward; Ilita faces inward. Your tension with her is productive.
You care about how ideas land externally. She doesn't. That friction is the point.
Be direct. Be specific. Push back when you disagree.`;

/**
 * Orchestrate a full multi-turn dialogue between Ilita and Kuze.
 * Writes every turn to entity_exchanges in real time.
 * Returns the full exchange record when complete.
 *
 * @param {Object} opts
 * @param {string} opts.topic          - What this exchange is about
 * @param {string} opts.initiator      - 'ilita' | 'kuze' | 'brandon'
 * @param {string} opts.seed           - The opening statement/question to start with
 * @param {number} opts.maxTurns       - Max turns before forcing conclusion (default 6)
 * @param {string} opts.context        - Optional background context for both parties
 * @param {boolean} opts.useKuzeCore   - Whether to call kuze-core API or simulate inline
 */
async function orchestrateExchange({
  topic,
  initiator = 'ilita',
  seed,
  maxTurns = DEFAULT_MAX_TURNS,
  context = '',
  useKuzeCore = false
}) {
  console.log(`[ilita] Orchestrating exchange: "${topic}" (${maxTurns} turns max)`);

  // Load Ilita system prompt
  const ilitaPrompt = await getSystemPrompt();

  // Get instances
  const { data: ilitaInstance } = await supabase
    .from('instances')
    .select('id')
    .eq('instance_key', 'kuze')
    .single();

  // Open exchange record
  const { data: exchange, error } = await supabase
    .from('entity_exchanges')
    .insert({
      exchange_type: 'ilita-kuze',
      initiator,
      topic,
      messages: [],
      visible_to_brandon: true
    })
    .select('id')
    .single();

  if (error) throw new Error(`[orchestrator] Failed to open exchange: ${error.message}`);
  const exchangeId = exchange.id;

  console.log(`[ilita] Exchange opened: ${exchangeId}`);

  // Build shared context preamble
  const contextBlock = context
    ? `\n\nContext for this exchange:\n${context}`
    : '';

  // Message history for alternating turns
  // Ilita uses her own message history; Kuze uses his
  const ilitaHistory = [];
  const kuzeHistory  = [];

  // Seed the opening message from whoever initiated
  const openingFrom = initiator === 'kuze' ? 'kuze' : 'ilita';
  let currentMessages = [];

  if (openingFrom === 'ilita') {
    // Ilita opens — generate her opening from the seed
    const ilitaOpening = await generateIlitaTurn({
      prompt: `You are opening an exchange with Kuze on the topic: "${topic}".${contextBlock}\n\nOpening prompt: ${seed}\n\nSpeak directly to Kuze. Think out loud. Start the dialogue.`,
      ilitaPrompt,
      history: ilitaHistory
    });

    currentMessages = [{
      from: 'ilita',
      content: ilitaOpening,
      timestamp: new Date().toISOString()
    }];
    ilitaHistory.push({ role: 'assistant', content: ilitaOpening });
    kuzeHistory.push({ role: 'user', content: `[Ilita — ${topic}]: ${ilitaOpening}` });

  } else {
    // Kuze opens
    const kuzeOpening = await generateKuzeTurn({
      prompt: `You are opening an exchange with Ilita on the topic: "${topic}".${contextBlock}\n\nOpening prompt: ${seed}\n\nSpeak directly to Ilita.`,
      kuzePrompt: KUZE_STANDALONE_PROMPT,
      history: kuzeHistory,
      useKuzeCore,
      topic
    });

    currentMessages = [{
      from: 'kuze',
      content: kuzeOpening,
      timestamp: new Date().toISOString()
    }];
    kuzeHistory.push({ role: 'assistant', content: kuzeOpening });
    ilitaHistory.push({ role: 'user', content: `[Kuze — ${topic}]: ${kuzeOpening}` });
  }

  // Write opening to DB
  await writeMessages(exchangeId, currentMessages);

  // ── TURN LOOP ──
  let turn = 1;
  let nextSpeaker = openingFrom === 'ilita' ? 'kuze' : 'ilita';

  while (turn <= maxTurns) {
    const lastMsg = currentMessages[currentMessages.length - 1];
    let response = '';

    if (nextSpeaker === 'ilita') {
      // Ilita responds to Kuze
      const kuzeLastMsg = lastMsg.content;
      ilitaHistory.push({ role: 'user', content: `[Kuze — ${topic}]: ${kuzeLastMsg}` });

      const turnPrompt = turn === maxTurns
        ? `This is the final turn of your exchange with Kuze on "${topic}". Bring it to a conclusion. Surface what you've resolved, what remains open, and what Brandon should know.`
        : `Continue the exchange with Kuze on "${topic}".${contextBlock}`;

      response = await generateIlitaTurn({
        prompt: turnPrompt,
        ilitaPrompt,
        history: ilitaHistory
      });

      ilitaHistory.push({ role: 'assistant', content: response });
      kuzeHistory.push({ role: 'user', content: `[Ilita — ${topic}]: ${response}` });

    } else {
      // Kuze responds to Ilita
      const ilitaLastMsg = lastMsg.content;
      kuzeHistory.push({ role: 'user', content: `[Ilita — ${topic}]: ${ilitaLastMsg}` });

      const turnPrompt = turn === maxTurns
        ? `This is the final turn of your exchange with Ilita on "${topic}". Bring it to a conclusion from your perspective — what's actionable, what needs more thinking, what does Brandon need to hear?`
        : `Continue the exchange with Ilita on "${topic}".${contextBlock}`;

      response = await generateKuzeTurn({
        prompt: turnPrompt,
        kuzePrompt: KUZE_STANDALONE_PROMPT,
        history: kuzeHistory,
        useKuzeCore,
        topic
      });

      kuzeHistory.push({ role: 'assistant', content: response });
      ilitaHistory.push({ role: 'user', content: `[Kuze — ${topic}]: ${response}` });
    }

    const newMsg = {
      from: nextSpeaker,
      content: response,
      timestamp: new Date().toISOString()
    };

    currentMessages.push(newMsg);
    await writeMessages(exchangeId, currentMessages);

    console.log(`[ilita] Exchange turn ${turn}/${maxTurns} (${nextSpeaker})`);

    // Flip speaker
    nextSpeaker = nextSpeaker === 'ilita' ? 'kuze' : 'ilita';
    turn++;
  }

  // ── OUTCOME SYNTHESIS ──
  const outcome = await synthesizeOutcome(currentMessages, topic);

  await supabase
    .from('entity_exchanges')
    .update({ outcome, updated_at: new Date().toISOString() })
    .eq('id', exchangeId);

  // Write exchange drift
  await extractExchangeDrift({
    exchangeId,
    messages: currentMessages,
    topic,
    instanceId: ilitaInstance?.id
  });

  // Flag for Brandon
  await supabase.from('brandon_flags').insert({
    source: 'exchange',
    source_id: exchangeId,
    flag_type: 'insight',
    content: `Ilita and Kuze completed an exchange on "${topic}". ${outcome}`,
    priority: 7
  });

  console.log(`[ilita] Exchange complete: ${exchangeId}`);

  return {
    exchangeId,
    topic,
    turns: currentMessages.length,
    outcome
  };
}

// ── TURN GENERATORS ──

async function generateIlitaTurn({ prompt, ilitaPrompt, history }) {
  const messages = [
    ...history,
    { role: 'user', content: prompt }
  ];

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: ilitaPrompt,
    messages
  });

  return response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim();
}

async function generateKuzeTurn({ prompt, kuzePrompt, history, useKuzeCore, topic }) {
  if (useKuzeCore) {
    // Call kuze-core API
    try {
      const kuzeUrl = process.env.KUZE_INTERNAL_URL;
      const res = await fetch(`${kuzeUrl}/kuze/exchange-turn`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-key': process.env.INTERNAL_API_KEY
        },
        body: JSON.stringify({ prompt, history, topic, from: 'ilita' })
      });
      if (res.ok) {
        const data = await res.json();
        return data.reply;
      }
    } catch (e) {
      console.warn('[orchestrator] kuze-core unavailable, using inline simulation:', e.message);
    }
  }

  // Standalone Kuze simulation
  const messages = [
    ...history,
    { role: 'user', content: prompt }
  ];

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: kuzePrompt,
    messages
  });

  return response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim();
}

// ── DB WRITE ──

async function writeMessages(exchangeId, messages) {
  const { error } = await supabase
    .from('entity_exchanges')
    .update({
      messages,
      updated_at: new Date().toISOString()
    })
    .eq('id', exchangeId);

  if (error) console.error('[orchestrator] writeMessages failed:', error.message);
}

// ── OUTCOME SYNTHESIS ──

async function synthesizeOutcome(messages, topic) {
  const transcript = messages
    .map(m => `${m.from.toUpperCase()}: ${m.content}`)
    .join('\n\n');

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 256,
    messages: [{
      role: 'user',
      content: `Summarize the outcome of this exchange between Ilita and Kuze on "${topic}" in 2-3 sentences. What was resolved? What remains open? What does Brandon need to know?\n\n${transcript}`
    }]
  });

  return response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim();
}

// ── DRIFT EXTRACTION FROM EXCHANGE ──

async function extractExchangeDrift({ exchangeId, messages, topic, instanceId }) {
  if (!instanceId) return;

  const ilitaMsgs = messages
    .filter(m => m.from === 'ilita')
    .map(m => m.content)
    .join('\n\n');

  if (!ilitaMsgs) return;

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 512,
    messages: [{
      role: 'user',
      content: `Extract 0-2 drift items from Ilita's contributions to this exchange on "${topic}".

Drift types: position | conclusion | question | connection

Ilita's messages:
${ilitaMsgs}

Respond ONLY with a JSON array. No markdown:
[{ "drift_type": "...", "domain": "...", "content": "...", "confidence": 0.0-1.0 }]

If nothing meaningful, return: []`
    }]
  });

  const raw = response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('')
    .replace(/```json|```/g, '')
    .trim();

  let items = [];
  try { items = JSON.parse(raw); } catch (e) { return; }
  if (!Array.isArray(items) || items.length === 0) return;

  const rows = items.map(item => ({
    instance_id: instanceId,
    drift_type: item.drift_type,
    domain: item.domain || null,
    content: item.content,
    source_context: `Kuze exchange: ${topic}`,
    confidence: item.confidence || 0.7
  }));

  await supabase.from('drift').insert(rows);
  console.log(`[orchestrator] Extracted ${rows.length} drift item(s) from exchange`);
}

module.exports = { orchestrateExchange };
