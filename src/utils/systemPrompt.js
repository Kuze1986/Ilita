const supabase = require('./supabase');
const fs = require('fs');
const path = require('path');

let cachedPrompt = null;
let cacheTime = null;
const CACHE_TTL_MS = 1000 * 60 * 60; // 1 hour

async function getSystemPrompt() {
  const now = Date.now();

  // Return cache if fresh
  if (cachedPrompt && cacheTime && (now - cacheTime) < CACHE_TTL_MS) {
    return cachedPrompt;
  }

  // Try loading from Supabase identity table
  try {
    const { data, error } = await supabase
      .from('identity')
      .select('system_prompt')
      .eq('active', true)
      .single();

    if (!error && data?.system_prompt) {
      cachedPrompt = data.system_prompt;
      cacheTime = now;
      return cachedPrompt;
    }
  } catch (err) {
    console.warn('[ilita] Failed to load system prompt from DB, using fallback:', err.message);
  }

  // Fallback to local file
  const fallbackPath = path.join(__dirname, '../../config/system_prompt.txt');
  if (fs.existsSync(fallbackPath)) {
    cachedPrompt = fs.readFileSync(fallbackPath, 'utf8');
    cacheTime = now;
    return cachedPrompt;
  }

  throw new Error('[ilita] No system prompt available — check DB identity table or config/system_prompt.txt');
}

function invalidateCache() {
  cachedPrompt = null;
  cacheTime = null;
}

module.exports = { getSystemPrompt, invalidateCache };
