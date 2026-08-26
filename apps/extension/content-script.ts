import { detectGMGN } from './detectors/gmgn';
import { detectAxiom } from './detectors/axiom';
import { detectPadre } from './detectors/padre';
import { normalizeCA } from './detectors/common.ts';
import { embedUrl, siteLabel, WEB_APP_URL } from './config';

const WIDGET_PROTOCOL = 'token-chat/1';

// A random channel per injected widget, so two frames (or a hostile frame that
// somehow learns the origin) cannot cross-talk.
const WIDGET_CHANNEL = Math.random().toString(36).slice(2) + Date.now().toString(36);

// The one origin the widget is allowed to live on. Anything claiming to be the
// widget from a different origin is ignored.
const WIDGET_ORIGIN = (() => {
  try {
    return new URL(WEB_APP_URL).origin;
  } catch (err) {
    return '';
  }
})();

(function () {
  const WIDGET_ID = 'token-chat-widget';
  const FALLBACK_ID = 'token-chat-fallback';

  // These sites are client-rendered: the address is usually in the URL on first
  // paint, but the DOM (and sometimes the route itself) fills in later. Retry on
  // a decaying schedule instead of giving up after one look.
  const RETRY_DELAYS = [0, 300, 700, 1500, 2500, 4000, 6000, 9000, 13000];
  // They are also SPAs — clicking a new token swaps the URL with no page load,
  // so the URL has to be polled. History patching does not work from a content
  // script's isolated world.
  const URL_POLL_MS = 700;

  let currentCA: string | null = null;
  let currentUrl = location.href;
  let timers: number[] = [];

  function detect(): string | null {
    const url = location.href;
    const host = location.hostname;
    try {
      if (host.includes('gmgn')) return detectGMGN(url, document);
      if (host.includes('axiom')) return detectAxiom(url, document);
      if (host.includes('padre')) return detectPadre(url, document);
    } catch (err) {
      console.warn('[token-chat] detector error:', err);
    }
    return null;
  }

  function clearTimers() {
    for (const timer of timers) clearTimeout(timer);
    timers = [];
  }

  /** Run detection now and keep retrying while the page renders. */
  function scheduleDetection() {
    clearTimers();
    RETRY_DELAYS.forEach((delay, index) => {
      const timer = window.setTimeout(() => {
        const detected = detect();

        if (detected) {
          clearTimers();
          if (detected !== currentCA) applyDetection(detected);
          return;
        }

        // Only give up — and offer the manual paste — after the last attempt.
        if (index === RETRY_DELAYS.length - 1) handleNoDetection();
      }, delay);
      timers.push(timer);
    });
  }

  function applyDetection(ca: string) {
    currentCA = ca;
    removeFallback();
    injectWidget(ca);
    report(ca);
  }

  function handleNoDetection() {
    if (currentCA) {
      currentCA = null;
      report(null);
    } else {
      report(null);
    }
    removeWidget();
    injectFallback();
  }

  function report(detected: string | null) {
    try {
      chrome.runtime.sendMessage(
        detected
          ? {
              type: 'token-chat:detected',
              ca: detected,
              url: location.href,
              title: document.title,
              site: siteLabel(location.hostname),
            }
          : { type: 'token-chat:none' }
      );
    } catch (err) {
      // Extension context is invalidated on reload — non-fatal.
    }
  }

  // ---------- widget ----------

  // The script runs at document_start so the URL is read as early as possible,
  // which means <body> may not exist yet when we want to mount the widget.
  function withBody(mount: () => void) {
    if (document.body) {
      mount();
      return;
    }
    document.addEventListener('DOMContentLoaded', () => mount(), { once: true });
  }

  function injectWidget(ca: string) {
    const existing = document.getElementById(WIDGET_ID) as HTMLIFrameElement | null;
    if (existing) {
      const next = withHostContext(embedUrl(ca));
      if (existing.src !== next) existing.src = next;
      return;
    }

    const iframe = document.createElement('iframe');
    iframe.id = WIDGET_ID;
    iframe.src = withHostContext(embedUrl(ca));
    iframe.style.position = 'fixed';
    iframe.style.bottom = '12px';
    iframe.style.right = '12px';
    iframe.style.width = '380px';
    iframe.style.height = '56px';
    iframe.style.border = 'none';
    iframe.style.colorScheme = 'dark';
    // Permissions-Policy delegation. `microphone` lets the cross-origin widget
    // call getUserMedia at all. `autoplay` is a SEPARATE feature and is just as
    // necessary for live voice: without it the browser refuses to play the
    // remote audio elements, so calls connect perfectly and nobody hears
    // anything — a failure with no visible cause.
    iframe.allow = 'microphone; autoplay';
    iframe.style.zIndex = '2147483647';
    iframe.style.transition = 'height 0.22s ease';
    // allow-forms is required or Chrome blocks the composer's submit event,
    // which makes the widget look loaded but inert. allow-modals covers the
    // manual-paste prompt; allow-popups lets in-chat links open a tab.
    // Least privilege: allow-popups-to-escape-sandbox is deliberately NOT set —
    // a popup opened by the widget stays sandboxed. allow-forms is required or
    // Chrome blocks the composer's submit event entirely.
    iframe.sandbox.add('allow-scripts', 'allow-same-origin', 'allow-forms', 'allow-modals', 'allow-popups');
    iframe.referrerPolicy = 'no-referrer';
    withBody(() => {
      // The route may have changed again while we waited for <body>.
      if (currentCA !== ca || document.getElementById(WIDGET_ID)) return;
      document.body.appendChild(iframe);
      listenForResize(iframe);
    });
  }

  function removeWidget() {
    document.getElementById(WIDGET_ID)?.remove();
  }

  /** Appends the host origin and channel so the widget knows exactly who embedded it. */
  function withHostContext(url: string): string {
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}host=${encodeURIComponent(window.location.origin)}&channel=${WIDGET_CHANNEL}`;
  }

  /**
   * Host side of the widget boundary.
   *
   * Every check matters: source proves it came from our frame, origin proves
   * that frame is still on our web app (a redirect elsewhere would keep the same
   * source), protocol and channel reject stray page chatter, and the height is
   * clamped so the widget cannot cover the whole host page.
   */
  function listenForResize(iframe: HTMLIFrameElement) {
    window.addEventListener('message', (event) => {
      if (event.source !== iframe.contentWindow) return;
      if (!WIDGET_ORIGIN || event.origin !== WIDGET_ORIGIN) return;

      const data = event.data;
      if (!data || data.protocol !== WIDGET_PROTOCOL) return;
      if (data.channel !== WIDGET_CHANNEL) return;
      if (data.type !== 'resize') return;

      const height = Number(data.height);
      if (!Number.isFinite(height)) return;
      iframe.style.height = `${Math.min(Math.max(height, 56), window.innerHeight - 40)}px`;
    });
  }

  /** Sends to the widget's exact origin — never '*'. */
  function postToWidget(iframe: HTMLIFrameElement, type: string, payload: Record<string, unknown> = {}) {
    if (!WIDGET_ORIGIN) return;
    iframe.contentWindow?.postMessage(
      { protocol: WIDGET_PROTOCOL, channel: WIDGET_CHANNEL, type, ...payload },
      WIDGET_ORIGIN
    );
  }

  function injectFallback() {
    if (document.getElementById(FALLBACK_ID)) return;

    const btn = document.createElement('button');
    btn.id = FALLBACK_ID;
    btn.innerText = 'Open token chat';
    btn.style.position = 'fixed';
    btn.style.bottom = '12px';
    btn.style.right = '12px';
    btn.style.zIndex = '2147483647';
    btn.style.padding = '10px 16px';
    btn.style.borderRadius = '999px';
    btn.style.background = 'linear-gradient(135deg, #7c5cff, #22d3ee)';
    btn.style.color = '#05070e';
    btn.style.fontWeight = '700';
    btn.style.border = 'none';
    btn.style.cursor = 'pointer';
    btn.onclick = () => {
      const input = prompt('No token detected on this page.\nPaste the contract address (CA):');
      if (input?.trim()) applyDetection(normalizeCA(input));
    };
    withBody(() => {
      if (currentCA || document.getElementById(FALLBACK_ID)) return;
      document.body.appendChild(btn);
    });
  }

  function removeFallback() {
    document.getElementById(FALLBACK_ID)?.remove();
  }

  // ---------- SPA navigation ----------

  function onUrlMaybeChanged() {
    if (location.href === currentUrl) return;
    currentUrl = location.href;
    // A route change invalidates the previous token; re-detect from scratch.
    currentCA = null;
    removeFallback();
    scheduleDetection();
  }

  window.addEventListener('popstate', onUrlMaybeChanged);
  window.addEventListener('hashchange', onUrlMaybeChanged);
  window.setInterval(onUrlMaybeChanged, URL_POLL_MS);

  // Let the popup open the widget on demand, even when detection failed.
  chrome.runtime.onMessage.addListener((message: any, _sender: any, sendResponse: (response?: any) => void) => {
    if (message?.type === 'token-chat:open-widget') {
      const target = message.ca ? normalizeCA(message.ca) : currentCA;
      if (!target) {
        sendResponse({ ok: false, error: 'No contract address available for this page' });
        return false;
      }
      applyDetection(target);
      sendResponse({ ok: true, ca: target });
      return false;
    }
    return false;
  });

  scheduleDetection();
})();
