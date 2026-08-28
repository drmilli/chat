/**
 * Content script for the Chorus web app itself.
 *
 * THE PROBLEM IT SOLVES. The popup's "Connect wallet" button opens the web app
 * in its own tab, because that is where an injected wallet actually lives. The
 * app signs in and stores a session token in localStorage. The widget on a
 * token page is the SAME origin — but embedded in gmgn.ai, and Chrome
 * partitions third-party storage by top-level site. The widget therefore reads
 * a different, empty bucket and stays signed out forever. Connecting appeared
 * to do nothing, because for the widget it genuinely did nothing.
 *
 * This script runs in the first-party tab, hears the app announce its session,
 * and parks the token in extension storage — which is not partitioned. The
 * widget's content script then hands it across the validated host bridge.
 *
 * WHY A SESSION TOKEN IS SAFE TO HOLD HERE. It is the same bearer token the
 * app already keeps in localStorage, scoped to one identity, and the extension
 * only ever gives it back to a frame it created itself, on the origin it came
 * from. It is never sent to a host page.
 */

const SESSION_PROTOCOL = 'token-chat/session/1';
export const SESSION_KEY = 'token-chat:session';

window.addEventListener('message', (event: MessageEvent) => {
  // Only our own page may announce a session. Without the origin check any
  // frame on the page could plant a token of its choosing.
  if (event.source !== window) return;
  if (event.origin !== window.location.origin) return;

  const data = event.data;
  if (!data || data.protocol !== SESSION_PROTOCOL || data.type !== 'session') return;
  if (typeof data.token !== 'string' || !data.token) return;

  chrome.storage.local.set({ [SESSION_KEY]: data.token }).catch(() => {
    /* storage full or unavailable — the widget simply stays signed out */
  });
});
