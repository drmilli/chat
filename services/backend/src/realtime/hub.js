/**
 * In-process pub/sub for room events, backing the SSE endpoint.
 *
 * ============================ RUN ONE INSTANCE ============================
 * Subscribers live in this process's memory, so a message published by one
 * instance is only delivered to clients connected to that same instance. With
 * two replicas, half the room silently stops receiving messages — there is no
 * error, it just looks like chat is broken.
 *
 * The same applies to the sign-in nonces in routes/auth.js, the rate-limiter
 * counters in middleware/rateLimiter.js, and the voice-room presence in
 * voice/rooms.js — WebRTC signalling is routed through this hub, so two peers
 * on different instances can never negotiate a connection at all.
 *
 * Before scaling out, move all three to a shared store (Redis pub/sub; Postgres
 * LISTEN/NOTIFY will not work over Neon's `-pooler` host).
 * ==========================================================================
 */

const MAX_CLIENTS = Number(process.env.SSE_MAX_CLIENTS || 2000);

/**
 * roomId -> { subscribers: Set<fn>, peers: Map<peerId, fn> }
 *
 * `peers` exists for WebRTC signalling, which is addressed rather than
 * broadcast: an SDP offer is for exactly one recipient. Fanning offers and ICE
 * candidates out to the whole room would publish every participant's
 * connection details to every listener, and burn bandwidth doing it. The Map
 * makes that delivery O(1) instead of a scan of every subscriber in the room.
 */
const rooms = new Map();
let clientCount = 0;

function roomState(roomId) {
  let state = rooms.get(roomId);
  if (!state) {
    state = { subscribers: new Set(), peers: new Map() };
    rooms.set(roomId, state);
  }
  return state;
}

/**
 * @param {string} roomId
 * @param {(event: object) => void} onEvent
 * @param {{ peerId?: string }} [options] register a peer id to receive
 *        addressed signalling as well as room broadcasts.
 */
function subscribe(roomId, onEvent, options = {}) {
  if (clientCount >= MAX_CLIENTS) return null;

  const state = roomState(roomId);
  state.subscribers.add(onEvent);
  if (options.peerId) state.peers.set(options.peerId, onEvent);
  clientCount += 1;

  return function unsubscribe() {
    const current = rooms.get(roomId);
    if (!current || !current.subscribers.delete(onEvent)) return;
    if (options.peerId) current.peers.delete(options.peerId);
    clientCount -= 1;
    // Drop the room entry so a busy day does not leave thousands of empty Sets.
    if (current.subscribers.size === 0) rooms.delete(roomId);
  };
}

function deliver(onEvent, event) {
  try {
    onEvent(event);
    return true;
  } catch (err) {
    // One broken socket must not stop delivery to everyone else.
    console.warn('SSE delivery failed:', err.message);
    return false;
  }
}

function publish(roomId, event) {
  const state = rooms.get(roomId);
  if (!state) return 0;

  let delivered = 0;
  for (const onEvent of state.subscribers) {
    if (deliver(onEvent, event)) delivered += 1;
  }
  return delivered;
}

/**
 * Sends an event to a single peer.
 *
 * Returns false when the peer is not connected here, which the caller must
 * treat as "gone", not as "retry": a signalling message for an absent peer is
 * a negotiation that will never complete, and the sender needs to know now
 * rather than wait out an ICE timeout.
 */
function publishToPeer(roomId, peerId, event) {
  const onEvent = rooms.get(roomId)?.peers.get(peerId);
  if (!onEvent) return false;
  return deliver(onEvent, event);
}

/** Is this peer currently holding a live stream on this instance? */
function hasPeer(roomId, peerId) {
  return Boolean(rooms.get(roomId)?.peers.has(peerId));
}

function stats() {
  return { rooms: rooms.size, clients: clientCount, maxClients: MAX_CLIENTS };
}

module.exports = { subscribe, publish, publishToPeer, hasPeer, stats };
