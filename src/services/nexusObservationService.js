const supabase = require('../utils/supabase');
const anthropic = require('../utils/anthropic');
const { pickInstance } = require('../utils/instanceSelector');

const MODEL = 'claude-sonnet-4-20250514';

const ROUTING_RULES = {
  certificate_earned: 'open_questions',
  job_placed: 'open_questions',
  credential_earned: 'open_questions',
  demo_completed: 'open_questions',
  lead_converted: 'open_questions',

  campaign_activated: 'research_threads',
  simulation_run: 'research_threads',
  evaluation_submitted: 'research_threads',
  gauntlet_completed: 'research_threads',

  constitution_hard_rule_invoked: 'drift',
  mode_switched: 'drift',
  childcare_disruption_flagged: 'drift',
  bioloop_recommendation_surfaced: 'drift',

  default: 'brandon_flags'
};

function destinationFor(obs) {
  return ROUTING_RULES[obs.event_type] || ROUTING_RULES.default;
}

function confidenceFromSignificance(sig) {
  if (sig === 'critical') return 0.9;
  if (sig === 'high') return 0.65;
  return 0.35;
}

async function getRoutingInstanceId() {
  try {
    const inst = await pickInstance({});
    return inst?.id || null;
  } catch (err) {
    console.warn('[nexus-obs] could not pick Ilita instance:', err.message);
    return null;
  }
}

async function interpretAndRoute(obs, useInterpretation) {
  const destination = destinationFor(obs);
  let ilitaInterpretation = null;

  if (useInterpretation && process.env.ANTHROPIC_API_KEY) {
    try {
      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 300,
        system: `You are Ilita, observing signals from the NEXUS portfolio.
You read what happens and notice what it means — for Brandon, for the work, for the trajectory.
Be brief, direct, and genuinely interested. One to three sentences maximum.
You are not summarizing. You are noticing.`,
        messages: [{
          role: 'user',
          content: `Signal from ${obs.app}: ${obs.event_type}
Payload: ${JSON.stringify(obs.payload ?? {}).slice(0, 4000)}
Significance: ${obs.significance ?? 'unknown'}

What do you notice?`
        }]
      });
      const block = response.content?.find(b => b.type === 'text');
      ilitaInterpretation = block?.text?.trim() || null;
    } catch (e) {
      console.warn('[nexus-obs] interpretation skipped:', e.message);
    }
  }

  await routeObservation(obs, destination, ilitaInterpretation);
}

async function routeObservation(obs, destination, interpretation = null) {
  const dest = destination ?? destinationFor(obs);
  const app = obs.app || 'unknown';
  const payload = obs.payload ?? {};
  const payloadStr = JSON.stringify(payload);

  try {
    if (dest === 'open_questions') {
      await supabase.from('open_questions').insert({
        question: `${app} / ${obs.event_type}: ${payloadStr.slice(0, 500)}`,
        domain: app,
        origin: 'nexus_observation',
        status: 'active',
        priority: obs.significance === 'critical' ? 9 : obs.significance === 'high' ? 7 : 5
      });
    } else if (dest === 'research_threads') {
      const threadTitle = `NEXUS GTM — ${app}`;
      const edge = `${obs.event_type} @ ${obs.observed_at || new Date().toISOString()}: ${payloadStr.slice(0, 240)}`;

      const { data: existing } = await supabase
        .from('research_threads')
        .select('id, open_edges, current_position')
        .eq('thread_title', threadTitle)
        .maybeSingle();

      if (existing?.id) {
        const edges = [...(existing.open_edges || []), interpretation ? `${edge} — ${interpretation}` : edge];
        await supabase
          .from('research_threads')
          .update({
            open_edges: edges,
            ...(interpretation ? { current_position: interpretation } : {}),
            updated_at: new Date().toISOString()
          })
          .eq('id', existing.id);
      } else {
        await supabase.from('research_threads').insert({
          thread_title: threadTitle,
          domain: 'nexus',
          status: 'active',
          priority: 6,
          current_position: interpretation || `Portfolio signal stream for ${app}`,
          open_edges: [interpretation ? `${edge} — ${interpretation}` : edge],
          exploration_count: 0
        });
      }
    } else if (dest === 'drift') {
      const instanceId = await getRoutingInstanceId();
      const content =
        interpretation ||
        `${obs.event_type} in ${app}${payloadStr.length > 2 ? `: ${payloadStr.slice(0, 400)}` : ''}`;

      await supabase.from('drift').insert({
        instance_id: instanceId,
        drift_type: String(obs.event_type || 'nexus_signal').slice(0, 80),
        domain: app,
        content,
        source_context: 'NEXUS observation',
        confidence: confidenceFromSignificance(obs.significance)
      });
    } else {
      await supabase.from('brandon_flags').insert({
        source: 'nexus_observation',
        flag_type: 'ambient',
        content: interpretation || `${app}: ${obs.event_type}`,
        priority: obs.significance === 'critical' ? 6 : 4
      });
    }

    await supabase
      .from('app_observations')
      .update({
        processed_at: new Date().toISOString(),
        routed_to: dest
      })
      .eq('id', obs.id);
  } catch (err) {
    console.error(`[nexus-obs] Failed to route observation ${obs.id}:`, err.message);
  }
}

async function processNexusObservations() {
  const { data: observations, error } = await supabase
    .from('app_observations')
    .select('*')
    .is('processed_at', null)
    .order('observed_at', { ascending: true })
    .limit(50);

  if (error) {
    console.error('[nexus-obs] fetch failed:', error.message);
    return { processed: 0, error: error.message };
  }
  if (!observations?.length) return { processed: 0 };

  const critical = observations.filter(o => o.significance === 'critical');
  const high = observations.filter(o => o.significance === 'high');
  const other = observations.filter(o => !['critical', 'high'].includes(o.significance));

  let processed = 0;

  for (const obs of critical) {
    await interpretAndRoute(obs, true);
    processed++;
  }
  for (const obs of high) {
    await interpretAndRoute(obs, true);
    processed++;
  }
  for (const obs of other) {
    await routeObservation(obs);
    processed++;
  }

  return { processed };
}

module.exports = {
  processNexusObservations,
  ROUTING_RULES
};
