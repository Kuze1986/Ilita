const anthropic = require('../utils/anthropic');
const supabase = require('../utils/supabase');

const MODEL = 'claude-sonnet-4-20250514';

/**
 * Run a full sync cycle across all instances.
 * Convergent drift increases weight. Divergent drift is preserved.
 */
async function runSyncCycle() {
  console.log('[ilita] Starting sync cycle...');

  // Get all unsynced drift
  const { data: unsyncedDrift, error: driftError } = await supabase
    .from('drift')
    .select('*, instances(instance_key)')
    .eq('synced', false)
    .order('created_at', { ascending: true });

  if (driftError) throw new Error(`[ilita] Failed to fetch drift: ${driftError.message}`);
  if (!unsyncedDrift || unsyncedDrift.length === 0) {
    console.log('[ilita] No unsynced drift — sync cycle complete');
    return { cycleNumber: null, processed: 0 };
  }

  console.log(`[ilita] Processing ${unsyncedDrift.length} drift items...`);

  // Group by domain + drift_type for convergence analysis
  const groups = {};
  for (const item of unsyncedDrift) {
    const key = `${item.drift_type}::${item.domain || 'general'}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  }

  // Get next cycle number
  const { data: lastCycle } = await supabase
    .from('sync_cycles')
    .select('cycle_number')
    .order('cycle_number', { ascending: false })
    .limit(1)
    .single();

  const cycleNumber = (lastCycle?.cycle_number || 0) + 1;

  // Create sync cycle record first to get ID
  const { data: cycle, error: cycleError } = await supabase
    .from('sync_cycles')
    .insert({
      cycle_number: cycleNumber,
      instances_synced: [...new Set(unsyncedDrift.map(d => d.instances?.instance_key).filter(Boolean))],
      drift_items_processed: unsyncedDrift.length
    })
    .select('id')
    .single();

  if (cycleError) throw new Error(`[ilita] Failed to create sync cycle: ${cycleError.message}`);

  let poolCreated = 0;
  let poolUpdated = 0;
  let convergenceCount = 0;
  let divergenceCount = 0;

  for (const [groupKey, items] of Object.entries(groups)) {
    const [driftType, domain] = groupKey.split('::');
    const instanceKeys = items.map(i => i.instances?.instance_key).filter(Boolean);
    const uniqueInstances = [...new Set(instanceKeys)];
    const isMultiInstance = uniqueInstances.length > 1;

    if (isMultiInstance) {
      // Analyze convergence/divergence with Anthropic
      const analysis = await analyzeConvergence(items, driftType, domain);

      if (analysis.convergent) {
        // Write converged position to pool
        await supabase.from('shared_pool').insert({
          pool_type: driftType,
          domain: domain === 'general' ? null : domain,
          content: analysis.synthesized,
          contributing_instances: uniqueInstances,
          sync_cycle_id: cycle.id,
          weight: 1.0 + (uniqueInstances.length * 0.25),
          convergent: true,
          divergent: false
        });
        convergenceCount++;
        poolCreated++;
      } else {
        // Preserve divergent positions — both sides matter
        await supabase.from('shared_pool').insert({
          pool_type: driftType,
          domain: domain === 'general' ? null : domain,
          content: analysis.synthesized,
          contributing_instances: uniqueInstances,
          sync_cycle_id: cycle.id,
          weight: 1.0,
          convergent: false,
          divergent: true,
          divergent_positions: analysis.positions
        });
        divergenceCount++;
        poolCreated++;
      }
    } else {
      // Single instance drift — write directly to pool
      for (const item of items) {
        await supabase.from('shared_pool').insert({
          pool_type: item.drift_type,
          domain: item.domain,
          content: item.content,
          contributing_instances: [item.instances?.instance_key].filter(Boolean),
          sync_cycle_id: cycle.id,
          weight: item.confidence || 0.7,
          convergent: false,
          divergent: false
        });
        poolCreated++;
      }
    }
  }

  // Mark all drift as synced
  const driftIds = unsyncedDrift.map(d => d.id);
  await supabase
    .from('drift')
    .update({ synced: true, sync_cycle_id: cycle.id })
    .in('id', driftIds);

  // Update sync cycle with results
  await supabase
    .from('sync_cycles')
    .update({
      pool_items_created: poolCreated,
      pool_items_updated: poolUpdated,
      convergence_count: convergenceCount,
      divergence_count: divergenceCount,
      completed_at: new Date().toISOString()
    })
    .eq('id', cycle.id);

  console.log(`[ilita] Sync cycle ${cycleNumber} complete — ${poolCreated} pool items, ${convergenceCount} convergent, ${divergenceCount} divergent`);

  // Flag significant divergence for Brandon
  if (divergenceCount > 0) {
    await supabase.from('brandon_flags').insert({
      source: 'sync',
      source_id: cycle.id,
      flag_type: 'insight',
      content: `Sync cycle ${cycleNumber} found ${divergenceCount} divergent position(s) across instances — her instances reached different conclusions from different experiences. Worth reviewing in the Observatory.`,
      priority: 7
    });
  }

  return { cycleNumber, processed: unsyncedDrift.length, poolCreated, convergenceCount, divergenceCount };
}

/**
 * Use Anthropic to analyze whether multiple drift items from different instances converge or diverge.
 */
async function analyzeConvergence(items, driftType, domain) {
  const itemList = items.map((item, i) =>
    `Instance ${item.instances?.instance_key || i + 1}: "${item.content}"`
  ).join('\n');

  const prompt = `Analyze whether the following ${driftType} items from different AI instances converge toward the same position or diverge into genuinely different positions.

Domain: ${domain}
Items:
${itemList}

Respond ONLY with JSON. No markdown, no preamble:
{
  "convergent": true or false,
  "synthesized": "A single synthesized statement if convergent, or a neutral summary of the tension if divergent",
  "positions": {
    "instanceKey": "their specific position"
  }
}`;

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }]
  });

  const raw = response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('')
    .replace(/```json|```/g, '')
    .trim();

  try {
    return JSON.parse(raw);
  } catch (e) {
    // Fallback — treat as non-convergent
    return {
      convergent: false,
      synthesized: 'Multiple positions — analysis failed',
      positions: {}
    };
  }
}

module.exports = { runSyncCycle };
