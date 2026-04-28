const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { processMessage } = require('../services/messageService');
const { openExchange, addExchangeTurn, closeExchange, brandonInject, getRecentExchanges } = require('../services/exchangeService');
const { runSyncCycle } = require('../services/syncService');
const { runExplorationCycle } = require('../services/explorationService');
const { initiateExchange, evaluateTriggers } = require('../services/triggerService');
const { readPatterns } = require('../services/bioloopService');
const supabase = require('../utils/supabase');

// All routes require internal API key
router.use(authenticate);

// ============================================================
// HEALTH
// ============================================================

router.get('/health', (req, res) => {
  res.json({ status: 'alive', entity: 'ilita', timestamp: new Date().toISOString() });
});

// ============================================================
// CORE MESSAGE — Brandon or Kuze sends a message to Ilita
// ============================================================

router.post('/message', async (req, res) => {
  try {
    const { from, content, context, instance, priorMessages } = req.body;

    if (!from || !content) {
      return res.status(400).json({ error: 'from and content are required' });
    }

    if (!['brandon', 'kuze'].includes(from)) {
      return res.status(400).json({ error: 'from must be brandon or kuze' });
    }

    const result = await processMessage({ from, content, context, instance, priorMessages });
    res.json(result);
  } catch (err) {
    console.error('[ilita] /message error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// STATE — Current identity and shared pool summary
// ============================================================

router.get('/state', async (req, res) => {
  try {
    const [
      { data: identity },
      { data: instances },
      { data: poolHighlights },
      { data: flags }
    ] = await Promise.all([
      supabase.from('identity').select('version, created_at').eq('active', true).single(),
      supabase.from('instances').select('instance_key, context, status, last_active'),
      supabase.from('shared_pool').select('pool_type, domain, content, weight, convergent, divergent').order('weight', { ascending: false }).limit(5),
      supabase.from('brandon_flags').select('flag_type, content, priority, created_at').eq('seen', false).order('priority', { ascending: false }).limit(5)
    ]);

    res.json({ identity, instances, poolHighlights, unseenFlags: flags });
  } catch (err) {
    console.error('[ilita] /state error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// DRIFT — Recent drift items
// ============================================================

router.get('/drift', async (req, res) => {
  try {
    const { limit = 20, synced, domain } = req.query;

    let query = supabase
      .from('drift')
      .select('*, instances(instance_key)')
      .order('created_at', { ascending: false })
      .limit(parseInt(limit));

    if (synced !== undefined) query = query.eq('synced', synced === 'true');
    if (domain) query = query.eq('domain', domain);

    const { data, error } = await query;
    if (error) throw error;

    res.json(data);
  } catch (err) {
    console.error('[ilita] /drift error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// QUESTIONS — Open questions registry
// ============================================================

router.get('/questions', async (req, res) => {
  try {
    const { status = 'active' } = req.query;
    const { data, error } = await supabase
      .from('open_questions')
      .select('*')
      .eq('status', status)
      .order('priority', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('[ilita] /questions error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// RESEARCH — Active research threads
// ============================================================

router.get('/research', async (req, res) => {
  try {
    const { status = 'active' } = req.query;
    const { data, error } = await supabase
      .from('research_threads')
      .select('*')
      .eq('status', status)
      .order('priority', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('[ilita] /research error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// EXCHANGES — Observatory feed
// ============================================================

router.get('/exchanges', async (req, res) => {
  try {
    const { limit, exchangeType } = req.query;
    const data = await getRecentExchanges({ limit: parseInt(limit) || 20, exchangeType });
    res.json(data);
  } catch (err) {
    console.error('[ilita] /exchanges error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/exchanges/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('entity_exchanges')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Exchange not found' });
    res.json(data);
  } catch (err) {
    console.error('[ilita] /exchanges/:id error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/exchanges', async (req, res) => {
  try {
    const { initiator, topic, initialMessage, exchangeType } = req.body;
    if (!initiator || !topic) return res.status(400).json({ error: 'initiator and topic required' });

    const exchangeId = await openExchange({ initiator, topic, initialMessage, exchangeType });
    res.json({ exchangeId });
  } catch (err) {
    console.error('[ilita] POST /exchanges error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/exchanges/:id/turn', async (req, res) => {
  try {
    const { from, content } = req.body;
    if (!from || !content) return res.status(400).json({ error: 'from and content required' });

    const result = await addExchangeTurn({ exchangeId: req.params.id, from, content });
    res.json(result);
  } catch (err) {
    console.error('[ilita] /exchanges/:id/turn error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/exchanges/:id/inject', async (req, res) => {
  try {
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: 'content required' });

    const result = await brandonInject({ exchangeId: req.params.id, content });
    res.json(result);
  } catch (err) {
    console.error('[ilita] /exchanges/:id/inject error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/exchanges/:id/close', async (req, res) => {
  try {
    const { outcome } = req.body;
    await closeExchange({ exchangeId: req.params.id, outcome });
    res.json({ closed: true });
  } catch (err) {
    console.error('[ilita] /exchanges/:id/close error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// SYNC — Manual trigger
// ============================================================

router.post('/sync', async (req, res) => {
  try {
    const result = await runSyncCycle();
    res.json(result);
  } catch (err) {
    console.error('[ilita] /sync error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// EXPLORE — Manual trigger
// ============================================================

router.post('/explore', async (req, res) => {
  try {
    const result = await runExplorationCycle({ trigger: 'manual' });
    res.json(result);
  } catch (err) {
    console.error('[ilita] /explore error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// ORCHESTRATE — Initiate a full Ilita/Kuze dialogue
// ============================================================

router.post('/orchestrate', async (req, res) => {
  try {
    const { topic, initiator, seed, context, maxTurns } = req.body;
    if (!topic || !seed) return res.status(400).json({ error: 'topic and seed required' });

    // Non-blocking — exchange runs async, returns exchange ID immediately
    const { orchestrateExchange } = require('../services/orchestratorService');

    // Create exchange shell first so caller has the ID
    const { createClient } = require('@supabase/supabase-js');
    const sb = require('../utils/supabase');

    const { data: ex } = await sb
      .from('entity_exchanges')
      .insert({
        exchange_type: 'ilita-kuze',
        initiator: initiator || 'ilita',
        topic,
        messages: [],
        visible_to_brandon: true
      })
      .select('id')
      .single();

    // Run orchestration in background
    orchestrateExchange({ topic, initiator, seed, context, maxTurns })
      .catch(err => console.error('[orchestrate] Background error:', err.message));

    res.json({ exchangeId: ex.id, status: 'running', message: 'Exchange started — watch the Observatory' });
  } catch (err) {
    console.error('[ilita] /orchestrate error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// TRIGGERS — Evaluate and fire exchange triggers
// ============================================================

router.post('/triggers/evaluate', async (req, res) => {
  try {
    const fired = await evaluateTriggers();
    res.json({ fired, message: fired > 0 ? 'Exchange(s) initiated' : 'No triggers fired' });
  } catch (err) {
    console.error('[ilita] /triggers/evaluate error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// BIOLOOP — Pattern read surface + push receiver
// ============================================================

router.get('/bioloop/patterns', async (req, res) => {
  try {
    const { domain, limit } = req.query;
    const patterns = await readPatterns({ domain, limit: parseInt(limit) || 5 });
    res.json(patterns);
  } catch (err) {
    console.error('[ilita] /bioloop/patterns error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// BioLoop pushes a pattern to Ilita
router.post('/bioloop/receive', async (req, res) => {
  try {
    const { eventType, domain, payload, source } = req.body;
    if (!eventType) return res.status(400).json({ error: 'eventType required' });
    const { receivePattern } = require('../services/bioloopIngestService');
    const id = await receivePattern({ eventType, domain, payload, source });
    res.json({ received: true, id });
  } catch (err) {
    console.error('[ilita] /bioloop/receive error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Manual ingest trigger
router.post('/bioloop/ingest', async (req, res) => {
  try {
    const { runBioLoopIngest } = require('../services/bioloopIngestService');
    const result = await runBioLoopIngest();
    res.json(result);
  } catch (err) {
    console.error('[ilita] /bioloop/ingest error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// FLAGS — Brandon's notification surface
// ============================================================

router.get('/flags', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('brandon_flags')
      .select('*')
      .eq('seen', false)
      .order('priority', { ascending: false })
      .limit(20);

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('[ilita] /flags error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/flags/:id/seen', async (req, res) => {
  try {
    await supabase
      .from('brandon_flags')
      .update({ seen: true, seen_at: new Date().toISOString() })
      .eq('id', req.params.id);

    res.json({ seen: true });
  } catch (err) {
    console.error('[ilita] /flags/:id/seen error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
