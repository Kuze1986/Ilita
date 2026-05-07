const supabase = require('./supabase');

const INSTANCE_KEYS = ['Titarian', 'Titarius', 'Titania'];

/**
 * Pick an Ilita instance for a service action.
 *
 * - If `preferred` matches one of INSTANCE_KEYS, fetch and return that row.
 * - Otherwise return the least-recently-active row from `ilita.instances`,
 *   so all arms get used over time (octopus-arm rotation).
 *
 * Returns the full instance row (`{ id, instance_key, status, ... }`).
 * Throws if no instance can be found.
 */
async function pickInstance({ preferred } = {}) {
  if (preferred && INSTANCE_KEYS.includes(preferred)) {
    const { data, error } = await supabase
      .from('instances')
      .select('id, instance_key, status, context, last_active')
      .eq('instance_key', preferred)
      .maybeSingle();

    if (error) throw new Error(`[instanceSelector] preferred lookup failed: ${error.message}`);
    if (data) return data;
  }

  const { data, error } = await supabase
    .from('instances')
    .select('id, instance_key, status, context, last_active')
    .in('instance_key', INSTANCE_KEYS)
    .order('last_active', { ascending: true, nullsFirst: true })
    .limit(1);

  if (error) throw new Error(`[instanceSelector] selection failed: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error('[instanceSelector] no Ilita instances available — check ilita.instances rows');
  }
  return data[0];
}

/**
 * Fetch all three instance rows in INSTANCE_KEYS order.
 * Used by the collective service for cross-instance memory retrieval.
 */
async function getAllInstances() {
  const { data, error } = await supabase
    .from('instances')
    .select('id, instance_key, status, context, last_active')
    .in('instance_key', INSTANCE_KEYS);

  if (error) throw new Error(`[instanceSelector] getAllInstances failed: ${error.message}`);

  const byKey = new Map((data || []).map(r => [r.instance_key, r]));
  return INSTANCE_KEYS.map(k => byKey.get(k)).filter(Boolean);
}

module.exports = { pickInstance, getAllInstances, INSTANCE_KEYS };
