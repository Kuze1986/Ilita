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
const { processNexusObservations } = require('../services/nexusObservationService');
const {
  getSignedUploadUrl,
  reviewDocument: reviewDocumentPhase6,
  listDocumentsWithReviews,
  getLatestReviewForDocument
} = require('../services/documentReviewService');
const {
  processCollectiveMessage,
  getCollectiveState
} = require('../services/collectiveService');

// ============================================================
// HEALTH
// ============================================================

router.get('/health', (req, res) => {
  res.json({ status: 'alive', entity: 'ilita', timestamp: new Date().toISOString() });
});

// All routes except health require internal API key
router.use(authenticate);

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
      { data: flags },
      { count: sharedMemoriesCount },
      { data: latestDivergence }
    ] = await Promise.all([
      supabase.from('identity').select('version, created_at').eq('active', true).single(),
      supabase.from('instances').select('instance_key, context, status, last_active'),
      supabase.from('shared_pool').select('pool_type, domain, content, weight, convergent, divergent').order('weight', { ascending: false }).limit(5),
      supabase.from('brandon_flags').select('flag_type, content, priority, created_at').eq('seen', false).order('priority', { ascending: false }).limit(5),
      supabase.from('memories').select('*', { count: 'exact', head: true }).eq('visibility', 'shared'),
      supabase.from('memories')
        .select('id, content, summary, domain, created_at')
        .eq('visibility', 'shared')
        .eq('convergence_state', 'divergent')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
    ]);

    res.json({
      identity,
      instances,
      poolHighlights,
      unseenFlags: flags,
      sharedMemoriesCount: sharedMemoriesCount || 0,
      latestDivergence: latestDivergence || null
    });
  } catch (err) {
    console.error('[ilita] /state error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// COLLECTIVE — single synthesized voice across all three arms
// ============================================================

router.post('/collective/message', async (req, res) => {
  try {
    const { from, content, context, priorMessages } = req.body;
    if (!from || !content) {
      return res.status(400).json({ error: 'from and content are required' });
    }
    const result = await processCollectiveMessage({ from, content, context, priorMessages });
    res.json(result);
  } catch (err) {
    console.error('[ilita] /collective/message error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/collective', async (req, res) => {
  try {
    const state = await getCollectiveState();
    res.json(state);
  } catch (err) {
    console.error('[ilita] /collective error:', err.message);
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
// NEXUS OBSERVATIONS — Read + route portfolio signals
// ============================================================

router.get('/observations', async (req, res) => {
  try {
    const { limit = 50, app, significance } = req.query;
    let query = supabase
      .from('app_observations')
      .select('*')
      .order('observed_at', { ascending: false })
      .limit(parseInt(limit, 10) || 50);

    if (app) query = query.eq('app', app);
    if (significance) query = query.eq('significance', significance);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    res.json({ observations: data || [] });
  } catch (err) {
    console.error('[ilita] GET /observations error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/observations/unprocessed', async (req, res) => {
  try {
    const { count, error } = await supabase
      .from('app_observations')
      .select('*', { count: 'exact', head: true })
      .is('processed_at', null);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ unprocessed: count ?? 0 });
  } catch (err) {
    console.error('[ilita] GET /observations/unprocessed error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/observations/process', async (req, res) => {
  try {
    const result = await processNexusObservations();
    res.json({ success: true, processed: result.processed });
  } catch (err) {
    console.error('[ilita] POST /observations/process error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// DOCUMENTS — Upload URL + review (images + text, Phase 6)
// ============================================================

const DOCUMENT_UPLOAD_MIMES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'text/plain',
  'text/markdown',
  'application/json',
  'application/pdf'
];

router.post('/documents/upload-url', async (req, res) => {
  try {
    const body = req.body || {};
    const fileName = body.fileName || body.filename;
    const mimeType = body.mimeType || body.mime_type;
    const fileSize = body.fileSize ?? body.byteSize;

    if (!fileName || !mimeType) {
      return res.status(400).json({ error: 'fileName and mimeType are required' });
    }

    const mt = mimeType.split(';')[0].trim().toLowerCase();
    if (!DOCUMENT_UPLOAD_MIMES.includes(mt)) {
      return res.status(400).json({
        error: `Unsupported file type: ${mimeType}`,
        supported: DOCUMENT_UPLOAD_MIMES
      });
    }

    const result = await getSignedUploadUrl(fileName, mimeType, fileSize);
    res.json(result);
  } catch (err) {
    console.error('[ilita] /documents/upload-url error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/documents/review', async (req, res) => {
  try {
    const { documentId } = req.body || {};
    if (!documentId) return res.status(400).json({ error: 'documentId is required' });

    const review = await reviewDocumentPhase6(documentId);
    res.json({ success: true, review });
  } catch (err) {
    console.error('[ilita] /documents/review error:', err.message);
    const code = /not found|Could not extract/i.test(err.message) ? 404 : 500;
    res.status(code).json({ error: err.message });
  }
});

router.get('/documents', async (req, res) => {
  try {
    const { limit = 20 } = req.query;
    const data = await listDocumentsWithReviews({ limit });
    res.json({ documents: data });
  } catch (err) {
    console.error('[ilita] GET /documents error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/documents/:id/review', async (req, res) => {
  try {
    const review = await getLatestReviewForDocument(req.params.id);
    if (!review) return res.status(404).json({ error: 'No review found' });
    res.json({ review });
  } catch (err) {
    console.error('[ilita] GET /documents/:id/review error:', err.message);
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

    if (!ex?.id) return res.status(500).json({ error: 'Failed to create exchange' });

    // Run orchestration in background using the same row (orchestrator accepts existing id)
    orchestrateExchange({ topic, initiator, seed, context, maxTurns, exchangeId: ex.id })
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
