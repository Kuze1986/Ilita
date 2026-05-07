const supabase = require('../utils/supabase');
const anthropic = require('../utils/anthropic');
const { getAllInstances, INSTANCE_KEYS } = require('../utils/instanceSelector');

const MODEL = process.env.ILITA_MEMORY_MODEL || 'claude-sonnet-4-20250514';
const SHARE_THRESHOLD = parseFloat(process.env.ILITA_MEMORY_SHARE_THRESHOLD || '0.7');
const DECAY_HALF_LIFE_DAYS = parseFloat(process.env.ILITA_MEMORY_DECAY_HALF_LIFE_DAYS || '14');
const PRUNE_FLOOR = parseFloat(process.env.ILITA_MEMORY_PRUNE_FLOOR || '0.05');

const VALID_KINDS = new Set(['episodic', 'semantic', 'reflection', 'decision', 'question']);

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function tokenize(text) {
  if (!text) return [];
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 3);
}

function buildKeywordOr(field, words, max = 6) {
  const slice = [...new Set(words)].slice(0, max);
  if (slice.length === 0) return null;
  return slice.map(w => `${field}.ilike.%${w}%`).join(',');
}

function clamp01(n, fallback = 0.5) {
  if (typeof n !== 'number' || Number.isNaN(n)) return fallback;
  return Math.min(1, Math.max(0, n));
}

// ─────────────────────────────────────────────────────────────────────────────
// RETRIEVAL — per-instance reply
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Retrieve memory + open loops to inform a per-instance reply.
 * Returns slices that the caller can compose into a structured prompt block.
 */
async function retrieveForReply({ instanceId, queryText, domain, perSliceLimit = 6 }) {
  const words = tokenize(queryText);
  const keywordOr = buildKeywordOr('content', words);

  const { data: localRecent } = await supabase
    .from('memories')
    .select('id, memory_kind, content, summary, importance, confidence, domain, created_at')
    .eq('instance_id', instanceId)
    .eq('visibility', 'local')
    .order('last_accessed_at', { ascending: false })
    .limit(perSliceLimit);

  let localSemantic = [];
  if (keywordOr) {
    const q = supabase
      .from('memories')
      .select('id, memory_kind, content, summary, importance, confidence, domain, created_at')
      .eq('instance_id', instanceId)
      .eq('visibility', 'local')
      .or(keywordOr)
      .order('importance', { ascending: false })
      .limit(perSliceLimit);
    const { data } = await q;
    localSemantic = data || [];
  }

  const { data: sharedConvergent } = await supabase
    .from('memories')
    .select('id, memory_kind, content, summary, importance, confidence, domain, created_at')
    .eq('visibility', 'shared')
    .eq('convergence_state', 'convergent')
    .order('importance', { ascending: false })
    .limit(perSliceLimit);

  const { data: sharedDivergent } = await supabase
    .from('memories')
    .select('id, memory_kind, content, summary, importance, confidence, domain, positions, created_at')
    .eq('visibility', 'shared')
    .eq('convergence_state', 'divergent')
    .order('created_at', { ascending: false })
    .limit(Math.max(2, Math.floor(perSliceLimit / 2)));

  const { data: questions } = await supabase
    .from('open_questions')
    .select('id, question, domain, priority')
    .eq('status', 'active')
    .order('priority', { ascending: false })
    .limit(5);

  const { data: threads } = await supabase
    .from('research_threads')
    .select('id, thread_title, domain, current_position')
    .eq('status', 'active')
    .order('priority', { ascending: false })
    .limit(5);

  const driftQuery = supabase
    .from('drift')
    .select('id, drift_type, domain, content, created_at')
    .order('created_at', { ascending: false })
    .limit(5);
  if (domain) driftQuery.eq('domain', domain);
  const { data: recentDrift } = await driftQuery;

  return {
    localRecent: localRecent || [],
    localSemantic: localSemantic || [],
    sharedConvergent: sharedConvergent || [],
    sharedDivergent: sharedDivergent || [],
    openLoops: {
      questions: questions || [],
      threads: threads || [],
      drift: recentDrift || []
    }
  };
}

/**
 * Cross-instance retrieval for the Collective. Pulls all shared memories plus
 * a balanced cap of relevant local memories from each instance.
 */
async function retrieveForCollective({ queryText, perInstanceLimit = 3, sharedLimit = 8 }) {
  const words = tokenize(queryText);
  const keywordOr = buildKeywordOr('content', words);

  const { data: shared } = await supabase
    .from('memories')
    .select('id, instance_id, memory_kind, content, summary, importance, confidence, domain, convergence_state, positions, created_at')
    .eq('visibility', 'shared')
    .order('importance', { ascending: false })
    .limit(sharedLimit);

  const instances = await getAllInstances();
  const perInstance = {};
  for (const inst of instances) {
    let q = supabase
      .from('memories')
      .select('id, instance_id, memory_kind, content, summary, importance, confidence, domain, created_at')
      .eq('instance_id', inst.id)
      .eq('visibility', 'local');
    if (keywordOr) q = q.or(keywordOr);
    q = q.order('importance', { ascending: false }).limit(perInstanceLimit);
    const { data } = await q;
    perInstance[inst.instance_key] = data || [];
  }

  const { data: questions } = await supabase
    .from('open_questions')
    .select('id, question, domain, priority')
    .eq('status', 'active')
    .order('priority', { ascending: false })
    .limit(5);

  const { data: threads } = await supabase
    .from('research_threads')
    .select('id, thread_title, domain, current_position')
    .eq('status', 'active')
    .order('priority', { ascending: false })
    .limit(5);

  const { data: recentDrift } = await supabase
    .from('drift')
    .select('id, drift_type, domain, content, created_at, instances(instance_key)')
    .order('created_at', { ascending: false })
    .limit(8);

  return {
    shared: shared || [],
    perInstance,
    instanceMap: Object.fromEntries(instances.map(i => [i.id, i.instance_key])),
    openLoops: {
      questions: questions || [],
      threads: threads || [],
      drift: recentDrift || []
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPOSITION — render slices into a prompt block (token-budgeted)
// ─────────────────────────────────────────────────────────────────────────────

function composeMemoryBlockForInstance({ instanceKey, slices, charBudget = 8000 }) {
  const lines = [];
  const push = (s) => { if (s) lines.push(s); };

  push(`# Memory context for ${instanceKey}`);

  if (slices.localRecent.length || slices.localSemantic.length) {
    push(`\n## Local memory (${instanceKey})`);
    const seen = new Set();
    const localItems = [...slices.localSemantic, ...slices.localRecent];
    for (const m of localItems) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      push(`- [${m.memory_kind}] ${m.summary || m.content}`);
    }
  }

  if (slices.sharedConvergent.length) {
    push(`\n## Shared convergences (collective)`);
    for (const m of slices.sharedConvergent) {
      push(`- ${m.summary || m.content}`);
    }
  }

  if (slices.sharedDivergent.length) {
    push(`\n## Shared divergences (positions held distinctly across arms)`);
    for (const m of slices.sharedDivergent) {
      const pos = Array.isArray(m.positions) ? ` — positions: ${JSON.stringify(m.positions).slice(0, 240)}` : '';
      push(`- ${m.summary || m.content}${pos}`);
    }
  }

  const ol = slices.openLoops || {};
  if ((ol.questions || []).length) {
    push(`\n## Open questions`);
    for (const q of ol.questions) push(`- ${q.question}`);
  }
  if ((ol.threads || []).length) {
    push(`\n## Active research threads`);
    for (const t of ol.threads) push(`- ${t.thread_title}${t.current_position ? `: ${t.current_position}` : ''}`);
  }
  if ((ol.drift || []).length) {
    push(`\n## Recent drift`);
    for (const d of ol.drift) push(`- [${d.drift_type}${d.domain ? `/${d.domain}` : ''}] ${d.content}`);
  }

  let block = lines.join('\n');
  if (block.length > charBudget) block = block.slice(0, charBudget) + '\n…';
  return block;
}

function composeMemoryBlockForCollective({ slices, charBudget = 12000 }) {
  const lines = [];
  const push = (s) => { if (s) lines.push(s); };

  push(`# Collective memory context — Titarian, Titarius, and Titania speaking with one voice`);

  if (slices.shared.length) {
    push(`\n## Shared memory (across all arms)`);
    for (const m of slices.shared) {
      const tag = m.convergence_state === 'divergent' ? 'divergent' : 'convergent';
      push(`- [${tag}] ${m.summary || m.content}`);
    }
  }

  for (const key of INSTANCE_KEYS) {
    const items = slices.perInstance[key] || [];
    if (items.length === 0) continue;
    push(`\n## Local memory (${key})`);
    for (const m of items) push(`- [${m.memory_kind}] ${m.summary || m.content}`);
  }

  const ol = slices.openLoops || {};
  if ((ol.questions || []).length) {
    push(`\n## Open questions`);
    for (const q of ol.questions) push(`- ${q.question}`);
  }
  if ((ol.threads || []).length) {
    push(`\n## Active research threads`);
    for (const t of ol.threads) push(`- ${t.thread_title}${t.current_position ? `: ${t.current_position}` : ''}`);
  }
  if ((ol.drift || []).length) {
    push(`\n## Recent drift across arms`);
    for (const d of ol.drift) {
      const arm = d.instances?.instance_key ? ` (${d.instances.instance_key})` : '';
      push(`- [${d.drift_type}${d.domain ? `/${d.domain}` : ''}]${arm} ${d.content}`);
    }
  }

  let block = lines.join('\n');
  if (block.length > charBudget) block = block.slice(0, charBudget) + '\n…';
  return block;
}

// ─────────────────────────────────────────────────────────────────────────────
// WRITE — extract candidate memories from a turn
// ─────────────────────────────────────────────────────────────────────────────

async function extractCandidateMemories({ userContent, replyText }) {
  const prompt = `You are extracting memory items from a single conversational turn between Brandon and Ilita.

Return ONLY a JSON array (no markdown fences) of 0-3 items. Schema:
[
  {
    "memory_kind": "episodic|semantic|reflection|decision|question",
    "domain": "string or null",
    "content": "1-3 sentence concrete statement worth remembering",
    "summary": "very short label",
    "importance": 0.0-1.0,
    "confidence": 0.0-1.0
  }
]

Rules:
- Only include items that change Ilita's understanding, mark a decision, or are durable signals.
- Skip pleasantries, restatements, and one-off chatter.
- "importance" reflects how much this should affect future replies.
- "confidence" reflects how certain Ilita is about this claim.

Brandon: ${userContent || ''}

Ilita: ${replyText || ''}`;

  let raw = '';
  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }]
    });
    raw = response.content?.filter(b => b.type === 'text').map(b => b.text).join('') || '';
  } catch (err) {
    console.warn('[memoryService] candidate extraction model call failed:', err.message);
    return [];
  }

  raw = raw.replace(/```json|```/g, '').trim();
  let items = [];
  try { items = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(items)) return [];

  return items
    .filter(it => it && typeof it.content === 'string' && VALID_KINDS.has(it.memory_kind))
    .map(it => ({
      memory_kind: it.memory_kind,
      domain: it.domain || null,
      content: it.content.trim(),
      summary: typeof it.summary === 'string' ? it.summary.trim().slice(0, 200) : null,
      importance: clamp01(it.importance, 0.5),
      confidence: clamp01(it.confidence, 0.5)
    }))
    .slice(0, 3);
}

/**
 * Persist memory candidates from a per-instance turn.
 * Items above SHARE_THRESHOLD on importance get marked candidate_shared
 * for later cross-instance consolidation.
 */
async function storeMemoriesFromTurn({ instanceId, userContent, replyText, sourceType, sourceId }) {
  if (!instanceId) return [];
  const candidates = await extractCandidateMemories({ userContent, replyText });
  if (candidates.length === 0) return [];

  const rows = candidates.map(c => ({
    instance_id: instanceId,
    visibility: 'local',
    memory_kind: c.memory_kind,
    convergence_state: c.importance >= SHARE_THRESHOLD ? 'candidate_shared' : 'local',
    domain: c.domain,
    content: c.content,
    summary: c.summary,
    importance: c.importance,
    confidence: c.confidence,
    source_type: sourceType || 'message',
    source_id: sourceId ? String(sourceId) : null
  }));

  const { data, error } = await supabase.from('memories').insert(rows).select('id');
  if (error) {
    console.warn('[memoryService] insert failed:', error.message);
    return [];
  }
  return data || [];
}

/**
 * Persist memory candidates from a Collective turn directly as shared+convergent
 * (the Collective speaks for all arms, so its persisted memory is already shared).
 */
async function storeCollectiveMemoriesFromTurn({ userContent, replyText, sourceType, sourceId }) {
  const candidates = await extractCandidateMemories({ userContent, replyText });
  if (candidates.length === 0) return [];

  const rows = candidates.map(c => ({
    instance_id: null,
    visibility: 'shared',
    memory_kind: c.memory_kind,
    convergence_state: 'convergent',
    domain: c.domain,
    content: c.content,
    summary: c.summary,
    importance: c.importance,
    confidence: c.confidence,
    source_type: sourceType || 'collective_message',
    source_id: sourceId ? String(sourceId) : null
  }));

  const { data, error } = await supabase.from('memories').insert(rows).select('id');
  if (error) {
    console.warn('[memoryService] collective insert failed:', error.message);
    return [];
  }
  return data || [];
}

async function markAccessed(memoryIds) {
  if (!Array.isArray(memoryIds) || memoryIds.length === 0) return;
  await supabase
    .from('memories')
    .update({ last_accessed_at: new Date().toISOString() })
    .in('id', memoryIds);
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSOLIDATION — reflection + cross-instance + decay
// ─────────────────────────────────────────────────────────────────────────────

async function consolidatePerInstance(instanceId, { lookbackHours = 24, maxItems = 24 } = {}) {
  if (!instanceId) return { reflectionId: null };

  const since = new Date(Date.now() - lookbackHours * 3600 * 1000).toISOString();
  const { data: items } = await supabase
    .from('memories')
    .select('id, memory_kind, content, summary, importance')
    .eq('instance_id', instanceId)
    .eq('visibility', 'local')
    .neq('memory_kind', 'reflection')
    .gte('created_at', since)
    .order('importance', { ascending: false })
    .limit(maxItems);

  if (!items || items.length < 3) return { reflectionId: null };

  const text = items.map(i => `- [${i.memory_kind}] ${i.summary || i.content}`).join('\n');

  let summary = null;
  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `You are summarizing recent memory items from one of Ilita's instances into a single reflection.\n\nReturn ONLY plain text, 3-6 sentences, present tense, first person plural ("we noticed"). No preamble.\n\nItems:\n${text}`
      }]
    });
    summary = response.content?.filter(b => b.type === 'text').map(b => b.text).join('').trim();
  } catch (err) {
    console.warn('[memoryService] reflection model call failed:', err.message);
    return { reflectionId: null };
  }

  if (!summary) return { reflectionId: null };

  const { data: row, error } = await supabase
    .from('memories')
    .insert({
      instance_id: instanceId,
      visibility: 'local',
      memory_kind: 'reflection',
      convergence_state: 'local',
      content: summary,
      summary: summary.slice(0, 200),
      importance: 0.6,
      confidence: 0.7,
      source_type: 'reflection',
      related_memory_ids: items.map(i => i.id)
    })
    .select('id')
    .single();

  if (error) {
    console.warn('[memoryService] reflection insert failed:', error.message);
    return { reflectionId: null };
  }
  return { reflectionId: row.id };
}

/**
 * Cluster candidate_shared local memories by domain across instances.
 * If two or more instances have aligned items in the same domain,
 * write a single shared+convergent memory; if conflicting positions exist,
 * write a shared+divergent memory with positions array. Originals preserved.
 */
async function consolidateAcrossInstances({ lookbackHours = 24 } = {}) {
  const since = new Date(Date.now() - lookbackHours * 3600 * 1000).toISOString();

  const { data: candidates } = await supabase
    .from('memories')
    .select('id, instance_id, domain, content, summary, importance, confidence, instances:instance_id(instance_key)')
    .eq('visibility', 'local')
    .eq('convergence_state', 'candidate_shared')
    .gte('created_at', since)
    .limit(200);

  if (!candidates || candidates.length === 0) return { convergent: 0, divergent: 0 };

  const byDomain = new Map();
  for (const c of candidates) {
    const key = c.domain || '__no_domain__';
    if (!byDomain.has(key)) byDomain.set(key, []);
    byDomain.get(key).push(c);
  }

  let convergent = 0;
  let divergent = 0;

  for (const [domain, items] of byDomain.entries()) {
    const byInstance = new Map();
    for (const it of items) {
      const k = it.instance_id;
      if (!byInstance.has(k)) byInstance.set(k, []);
      byInstance.get(k).push(it);
    }
    if (byInstance.size < 2) continue;

    const summary = await classifyConvergence(items);
    if (!summary) continue;

    const positions = items.map(it => ({
      instance: it.instances?.instance_key,
      content: it.summary || it.content
    }));

    const { error } = await supabase.from('memories').insert({
      instance_id: null,
      visibility: 'shared',
      memory_kind: 'reflection',
      convergence_state: summary.state,
      domain: domain === '__no_domain__' ? null : domain,
      content: summary.text,
      summary: summary.text.slice(0, 200),
      importance: 0.7,
      confidence: 0.7,
      positions,
      related_memory_ids: items.map(i => i.id),
      source_type: 'cross_instance_consolidation'
    });
    if (error) {
      console.warn('[memoryService] consolidation insert failed:', error.message);
      continue;
    }
    if (summary.state === 'convergent') convergent++;
    else divergent++;

    // Promote candidates so they aren't reconsolidated.
    await supabase
      .from('memories')
      .update({ convergence_state: 'local' })
      .in('id', items.map(i => i.id));
  }

  return { convergent, divergent };
}

async function classifyConvergence(items) {
  const text = items.map(i => `- (${i.instances?.instance_key}) ${i.summary || i.content}`).join('\n');

  let raw = '';
  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: `These memory items came from different Ilita instances on the same domain. Decide whether they converge on the same position or diverge into distinct positions.\n\nReturn ONLY JSON: { "state": "convergent" | "divergent", "text": "1-3 sentence synthesis" }\n\nItems:\n${text}`
      }]
    });
    raw = response.content?.filter(b => b.type === 'text').map(b => b.text).join('') || '';
  } catch (err) {
    console.warn('[memoryService] classify model call failed:', err.message);
    return null;
  }

  raw = raw.replace(/```json|```/g, '').trim();
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || (parsed.state !== 'convergent' && parsed.state !== 'divergent')) return null;
    if (typeof parsed.text !== 'string' || !parsed.text.trim()) return null;
    return { state: parsed.state, text: parsed.text.trim() };
  } catch {
    return null;
  }
}

/**
 * Apply gentle decay to importance based on staleness, and prune nothing —
 * we never hard-delete memory; importance just falls toward PRUNE_FLOOR for
 * stale low-importance items. Reflections + shared memory are spared.
 */
async function decayAndPrune({ batchLimit = 500 } = {}) {
  const cutoffMs = Date.now() - DECAY_HALF_LIFE_DAYS * 24 * 3600 * 1000;
  const cutoffIso = new Date(cutoffMs).toISOString();

  const { data: items } = await supabase
    .from('memories')
    .select('id, importance, last_accessed_at, memory_kind, visibility')
    .lt('last_accessed_at', cutoffIso)
    .eq('visibility', 'local')
    .neq('memory_kind', 'reflection')
    .gt('importance', PRUNE_FLOOR)
    .limit(batchLimit);

  if (!items || items.length === 0) return { decayed: 0 };

  const now = Date.now();
  const halfLifeMs = DECAY_HALF_LIFE_DAYS * 24 * 3600 * 1000;

  for (const it of items) {
    const last = it.last_accessed_at ? new Date(it.last_accessed_at).getTime() : now;
    const halfLives = Math.max(0, (now - last) / halfLifeMs);
    const factor = Math.pow(0.5, halfLives);
    const next = Math.max(PRUNE_FLOOR, +(it.importance * factor).toFixed(4));
    if (next < it.importance - 0.001) {
      await supabase.from('memories').update({ importance: next }).eq('id', it.id);
    }
  }

  return { decayed: items.length };
}

module.exports = {
  retrieveForReply,
  retrieveForCollective,
  composeMemoryBlockForInstance,
  composeMemoryBlockForCollective,
  storeMemoriesFromTurn,
  storeCollectiveMemoriesFromTurn,
  markAccessed,
  consolidatePerInstance,
  consolidateAcrossInstances,
  decayAndPrune
};
