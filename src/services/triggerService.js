const supabase = require('../utils/supabase');
const { orchestrateExchange } = require('./orchestratorService');

/**
 * Trigger registry — conditions that cause Ilita to initiate an exchange with Kuze.
 * Each trigger has a check() that evaluates state, and a build() that constructs
 * the exchange parameters if the check passes.
 */
const TRIGGERS = [

  // ── DRIFT ACCUMULATION TRIGGER ──
  // When Ilita has accumulated significant unsynced drift in a domain Kuze cares about,
  // she surfaces it to him proactively.
  {
    id: 'drift-portfolio-relevant',
    name: 'Portfolio-relevant drift',
    description: 'Ilita has developed positions with implications for NEXUS delivery or positioning',
    cooldownHours: 12,
    async check() {
      const { data } = await supabase
        .from('drift')
        .select('id, domain, content, drift_type')
        .eq('synced', false)
        .in('domain', ['bioloop', 'city', 'space', 'nano'])
        .eq('drift_type', 'conclusion')
        .gte('confidence', 0.75)
        .limit(3);

      return data?.length >= 2 ? data : null;
    },
    build(data) {
      const topics = [...new Set(data.map(d => d.domain))].join(', ');
      return {
        topic: `Implications of recent conclusions — ${topics}`,
        initiator: 'ilita',
        seed: `I've been developing some positions that I think have implications for how you're representing the work externally. I want to think through them with you before the next sync.`,
        context: `Ilita's recent conclusions:\n${data.map(d => `[${d.domain}] ${d.content}`).join('\n')}`,
        maxTurns: 4
      };
    }
  },

  // ── RESEARCH MILESTONE TRIGGER ──
  // When a research thread reaches a conclusion worth surfacing.
  {
    id: 'research-milestone',
    name: 'Research thread milestone',
    description: 'A research thread has reached a conclusion with external relevance',
    cooldownHours: 24,
    async check() {
      const { data } = await supabase
        .from('research_threads')
        .select('*')
        .eq('status', 'active')
        .not('current_position', 'is', null)
        .gte('exploration_count', 3)
        .order('last_explored', { ascending: false })
        .limit(1);

      return data?.[0] || null;
    },
    build(thread) {
      return {
        topic: `Research update — ${thread.thread_title}`,
        initiator: 'ilita',
        seed: `I've been working on the ${thread.thread_title} thread and reached a position I want to check against how you're thinking about it from the outside.`,
        context: `Thread: ${thread.thread_title}\nDomain: ${thread.domain}\nCurrent position: ${thread.current_position}\nOpen edges: ${(thread.open_edges || []).join(', ')}`,
        maxTurns: 4
      };
    }
  },

  // ── DIVERGENCE TRIGGER ──
  // When sync produces significant divergence — instances disagreeing — worth discussing.
  {
    id: 'sync-divergence',
    name: 'Instance divergence',
    description: 'Recent sync found meaningful divergence between Ilita instances',
    cooldownHours: 48,
    async check() {
      const { data } = await supabase
        .from('shared_pool')
        .select('*')
        .eq('divergent', true)
        .order('created_at', { ascending: false })
        .limit(2);

      return data?.length > 0 ? data : null;
    },
    build(items) {
      const domains = [...new Set(items.map(i => i.domain).filter(Boolean))].join(', ');
      return {
        topic: `Instance divergence — ${domains}`,
        initiator: 'ilita',
        seed: `My instances reached different conclusions on something. I want to think through it with you — sometimes you see the external angle I'm missing.`,
        context: `Divergent positions:\n${items.map(i => `[${i.domain}] ${i.content}\nPositions: ${JSON.stringify(i.divergent_positions)}`).join('\n\n')}`,
        maxTurns: 4
      };
    }
  }

];

// Cooldown tracking — in-memory (resets on service restart, intentionally lightweight)
const lastFired = {};

/**
 * Evaluate all triggers and fire any that pass their check.
 * Called on a schedule — typically after exploration cycles.
 */
async function evaluateTriggers() {
  console.log('[ilita] Evaluating exchange triggers...');

  const now = Date.now();
  let fired = 0;

  for (const trigger of TRIGGERS) {
    // Cooldown check
    const last = lastFired[trigger.id];
    if (last && (now - last) < trigger.cooldownHours * 3600 * 1000) {
      continue;
    }

    // Check if trigger condition is met
    let data;
    try {
      data = await trigger.check();
    } catch (e) {
      console.warn(`[triggers] Check failed for ${trigger.id}:`, e.message);
      continue;
    }

    if (!data) continue;

    // Fire the exchange
    console.log(`[triggers] Firing: ${trigger.name}`);
    lastFired[trigger.id] = now;

    const params = trigger.build(data);

    // Non-blocking — exchange runs in background
    orchestrateExchange(params).catch(err => {
      console.error(`[triggers] Exchange failed for ${trigger.id}:`, err.message);
    });

    fired++;

    // Only fire one trigger per evaluation cycle to avoid flooding
    break;
  }

  if (fired === 0) {
    console.log('[triggers] No triggers fired this cycle');
  }

  return fired;
}

/**
 * Manually initiate an exchange between Ilita and Kuze.
 * Called from the API when Brandon or Kuze requests one directly.
 */
async function initiateExchange({ topic, initiator, seed, context, maxTurns }) {
  return orchestrateExchange({ topic, initiator, seed, context, maxTurns });
}

module.exports = { evaluateTriggers, initiateExchange };
