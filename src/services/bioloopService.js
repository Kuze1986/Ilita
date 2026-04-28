const supabase = require('../utils/supabase');

/**
 * Write Ilita's intelligence contributions to the BioLoop outbox.
 * BioLoop processes these and makes them available portfolio-wide.
 */
async function writeToBioLoop(eventType, payload) {
  try {
    // Write to bioloop schema outbox using service role
    const { error } = await supabase
      .schema('bioloop') // Note: requires supabase client without schema lock
      .from('outbox')
      .insert({
        source: 'ilita',
        event_type: eventType,
        payload,
        processed: false
      });

    if (error) throw error;
    console.log(`[bioloop] Wrote event: ${eventType}`);
  } catch (e) {
    console.warn(`[bioloop] Write failed for ${eventType}:`, e.message);
  }
}

/**
 * Emit drift events to BioLoop — her most valuable signal.
 */
async function emitDrift(driftItem) {
  await writeToBioLoop('ilita.drift.' + driftItem.drift_type, {
    domain: driftItem.domain,
    content: driftItem.content,
    confidence: driftItem.confidence,
    instance: driftItem.instance_key,
    timestamp: new Date().toISOString()
  });
}

/**
 * Emit sync results — convergence and divergence are high-value signals.
 */
async function emitSyncResult({ cycleNumber, convergenceCount, divergenceCount, divergentItems }) {
  if (convergenceCount > 0) {
    await writeToBioLoop('ilita.sync.convergence', {
      cycle: cycleNumber,
      count: convergenceCount,
      timestamp: new Date().toISOString()
    });
  }

  if (divergenceCount > 0) {
    await writeToBioLoop('ilita.sync.divergence', {
      cycle: cycleNumber,
      count: divergenceCount,
      items: divergentItems || [],
      timestamp: new Date().toISOString()
    });
  }
}

/**
 * Emit research findings — thread conclusions are actionable for the portfolio.
 */
async function emitResearchFinding({ domain, title, position, openEdges }) {
  await writeToBioLoop('ilita.research.finding', {
    domain,
    title,
    position,
    open_edges: openEdges,
    timestamp: new Date().toISOString()
  });
}

/**
 * Read patterns that BioLoop has surfaced back to Ilita.
 * Polls the BioLoop service directly if available, otherwise queries shared tables.
 */
async function readPatterns({ domain, limit = 5 } = {}) {
  try {
    const bioloopUrl = process.env.BIOLOOP_INTERNAL_URL;
    if (!bioloopUrl) return [];

    const params = new URLSearchParams({ source: 'ilita', limit });
    if (domain) params.append('domain', domain);

    const res = await fetch(`${bioloopUrl}/bioloop/patterns?${params}`, {
      headers: { 'x-internal-key': process.env.INTERNAL_API_KEY }
    });

    if (!res.ok) return [];
    return res.json();
  } catch (e) {
    console.warn('[bioloop] Could not read patterns:', e.message);
    return [];
  }
}

/**
 * Emit an exchange conclusion — Ilita/Kuze dialogue outcomes are BioLoop signal.
 */
async function emitExchangeOutcome({ exchangeId, topic, outcome, driftCount }) {
  await writeToBioLoop('ilita.exchange.outcome', {
    exchange_id: exchangeId,
    topic,
    outcome,
    drift_generated: driftCount,
    timestamp: new Date().toISOString()
  });
}

module.exports = {
  writeToBioLoop,
  emitDrift,
  emitSyncResult,
  emitResearchFinding,
  emitExchangeOutcome,
  readPatterns
};
