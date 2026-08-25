/**
 * Widget side of the host <-> widget message boundary.
 *
 * The widget used to `postMessage(..., '*')`, so any page that embedded it
 * received its messages, and it accepted anything sent back. That is tolerable
 * for resizing a chat box and unacceptable once the iframe can move money —
 * the trading addendum calls this boundary "attack surface #1".
 *
 * Protocol:
 *  - The host injects the iframe with `?host=<origin>&channel=<random>`.
 *  - The widget posts ONLY to that exact origin, tagging every message with the
 *    protocol name and channel.
 *  - Inbound messages must match origin, channel and protocol, or are dropped.
 */

export const WIDGET_PROTOCOL = 'token-chat/1';

export type HostContext = { origin: string | null; channel: string | null };

/** Reads the host origin and channel the extension embedded us with. */
export function readHostContext(): HostContext {
  if (typeof window === 'undefined') return { origin: null, channel: null };
  try {
    const params = new URLSearchParams(window.location.search);
    const origin = params.get('host');
    const channel = params.get('channel');
    // An origin must be a real absolute origin, never "*" or a path.
    if (!origin || !/^https?:\/\/[^/]+$/.test(origin)) return { origin: null, channel };
    return { origin, channel };
  } catch (err) {
    return { origin: null, channel: null };
  }
}

/**
 * Sends a message to the embedding host.
 * Returns false (and sends nothing) when there is no verified host origin —
 * silence is the correct behaviour for an unknown embedder.
 */
export function postToHost(context: HostContext, type: string, payload: Record<string, unknown> = {}): boolean {
  if (typeof window === 'undefined' || window.parent === window) return false;
  if (!context.origin) return false;

  window.parent.postMessage(
    { protocol: WIDGET_PROTOCOL, channel: context.channel, type, ...payload },
    context.origin // never '*'
  );
  return true;
}

/** Subscribes to host messages, dropping anything that fails validation. */
export function onHostMessage(
  context: HostContext,
  handler: (type: string, data: any) => void
): () => void {
  if (typeof window === 'undefined') return () => {};

  const listener = (event: MessageEvent) => {
    if (!context.origin || event.origin !== context.origin) return;
    if (event.source !== window.parent) return;
    const data = event.data;
    if (!data || data.protocol !== WIDGET_PROTOCOL) return;
    if (context.channel && data.channel !== context.channel) return;
    if (typeof data.type !== 'string') return;
    handler(data.type, data);
  };

  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}
