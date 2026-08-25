/**
 * In-process pub/sub for room events, backing the SSE endpoint.
 *
 * ============================ RUN ONE INSTANCE ============================
 * Subscribers live in this process's memory, so a message published by one
 * instance is only delivered to clients connected to that same instance. With
 * two replicas, half the room silently stops receiving messages — there is no
 * error, it just looks like chat is broken.
 *
 * The same applies to the sign-in nonces in routes/auth.js and the rate-limiter
 * counters in middleware/rateLimiter.js.
 *
 * Before scaling out, move all three to a shared store (Redis pub/sub; Postgres
 * LISTEN/NOTIFY will not work over Neon's `-pooler` host).
 * ==========================================================================
 */

const MAX_CLIENTS = Number(process.env.SSE_MAX_CLIENTS || 2000);

/** roomId -> Set of subscriber callbacks */
const rooms = new Map();
let clientCount = 0;

function subscribe(roomId, onEvent) {
  if (clientCount >= MAX_CLIENTS) return null;

  let subscribers = rooms.get(roomId);
  if (!subscribers) {
    subscribers = new Set();
    rooms.set(roomId, subscribers);
  }
  subscribers.add(onEvent);
  clientCount += 1;

  return function unsubscribe() {
    const current = rooms.get(roomId);
    if (!current || !current.delete(onEvent)) return;
    clientCount -= 1;
    // Drop the room entry so a busy day does not leave thousands of empty Sets.
    if (current.size === 0) rooms.delete(roomId);
  };
}

function publish(roomId, event) {
  const subscribers = rooms.get(roomId);
  if (!subscribers) return 0;

  let delivered = 0;
  for (const onEvent of subscribers) {
    try {
      onEvent(event);
      delivered += 1;
    } catch (err) {
      // One broken socket must not stop delivery to everyone else.
      console.warn('SSE delivery failed:', err.message);
    }
  }
  return delivered;
}

function stats() {
  return { rooms: rooms.size, clients: clientCount, maxClients: MAX_CLIENTS };
}

module.exports = { subscribe, publish, stats };
