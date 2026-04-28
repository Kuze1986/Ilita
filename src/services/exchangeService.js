const anthropic = require('../utils/anthropic');
const { getSystemPrompt } = require('../utils/systemPrompt');
const supabase = require('../utils/supabase');

const MODEL = 'claude-sonnet-4-20250514';

/**
 * Open an Ilita <-> Kuze exchange.
 * Logs to entity_exchanges, visible to Brandon via Observatory.
 */
async function openExchange({ initiator, topic, initialMessage, exchangeType = 'ilita-kuze' }) {
  // Create exchange record
  const { data: exchange, error } = await supabase
    .from('entity_exchanges')
    .insert({
      exchange_type: exchangeType,
      initiator,
      topic,
      messages: [],
      visible_to_brandon: true
    })
    .select('id')
    .single();

  if (error) throw new Error(`[ilita] Failed to create exchange: ${error.message}`);

  return exchange.id;
}

/**
 * Add a message turn to an existing exchange.
 * Returns Ilita's response to the message.
 */
async function addExchangeTurn({ exchangeId, from, content }) {
  const systemPrompt = await getSystemPrompt();

  // Load current exchange
  const { data: exchange, error } = await supabase
    .from('entity_exchanges')
    .select('*')
    .eq('id', exchangeId)
    .single();

  if (error || !exchange) throw new Error(`[ilita] Exchange not found: ${exchangeId}`);

  const currentMessages = exchange.messages || [];

  // Add incoming message
  const newMessage = {
    from,
    content,
    timestamp: new Date().toISOString()
  };

  const updatedMessages = [...currentMessages, newMessage];

  // Build Anthropic message array
  const anthropicMessages = updatedMessages.map(msg => ({
    role: msg.from === 'ilita' ? 'assistant' : 'user',
    content: msg.from === 'kuze'
      ? `[Kuze — ${exchange.topic}]: ${msg.content}`
      : msg.content
  }));

  // Get Ilita's response
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: systemPrompt,
    messages: anthropicMessages
  });

  const replyText = response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n');

  // Append Ilita's reply
  const ilitaMessage = {
    from: 'ilita',
    content: replyText,
    timestamp: new Date().toISOString()
  };

  const finalMessages = [...updatedMessages, ilitaMessage];

  // Update exchange in DB
  await supabase
    .from('entity_exchanges')
    .update({ messages: finalMessages, updated_at: new Date().toISOString() })
    .eq('id', exchangeId);

  return {
    exchangeId,
    reply: replyText,
    messageCount: finalMessages.length
  };
}

/**
 * Close an exchange with an outcome summary.
 */
async function closeExchange({ exchangeId, outcome }) {
  await supabase
    .from('entity_exchanges')
    .update({ outcome, updated_at: new Date().toISOString() })
    .eq('id', exchangeId);
}

/**
 * Brandon injects into an active exchange.
 */
async function brandonInject({ exchangeId, content }) {
  const { data: exchange } = await supabase
    .from('entity_exchanges')
    .select('messages')
    .eq('id', exchangeId)
    .single();

  const injection = {
    from: 'brandon',
    content,
    timestamp: new Date().toISOString(),
    injected: true
  };

  const updatedMessages = [...(exchange?.messages || []), injection];

  await supabase
    .from('entity_exchanges')
    .update({
      messages: updatedMessages,
      brandon_injected: true,
      updated_at: new Date().toISOString()
    })
    .eq('id', exchangeId);

  return { injected: true, messageCount: updatedMessages.length };
}

/**
 * Get recent exchanges for the Observatory feed.
 */
async function getRecentExchanges({ limit = 20, exchangeType } = {}) {
  let query = supabase
    .from('entity_exchanges')
    .select('id, exchange_type, initiator, topic, messages, brandon_injected, outcome, created_at, updated_at')
    .eq('visible_to_brandon', true)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (exchangeType) {
    query = query.eq('exchange_type', exchangeType);
  }

  const { data, error } = await query;
  if (error) throw new Error(`[ilita] Failed to fetch exchanges: ${error.message}`);

  return data;
}

module.exports = { openExchange, addExchangeTurn, closeExchange, brandonInject, getRecentExchanges };
