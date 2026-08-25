// Two local origins: 4200 plays the "host site", 4173 serves the real widget.
// Being on different ports makes them genuinely cross-origin.
import http from 'node:http';

const WIDGET = 'http://localhost:4173';
const CA = 'boundary-test-room';
const PORT = 4200;

// The host page mimics what the content script does, including the checks.
const page = (channel) => `<!doctype html>
<html><body style="background:#eee;font-family:sans-serif">
<h3>pretend host site</h3>
<div id="log"></div>
<iframe id="w" src="${WIDGET}/embed/${CA}?host=http%3A%2F%2Flocalhost%3A${PORT}&channel=${channel}"
        style="position:fixed;bottom:12px;right:12px;width:380px;height:56px;border:none"
        sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups"
        allow="microphone"></iframe>
<script>
  const PROTOCOL = 'token-chat/1';
  const CHANNEL = ${JSON.stringify(channel)};
  const WIDGET_ORIGIN = ${JSON.stringify(new URL(WIDGET).origin)};
  const iframe = document.getElementById('w');

  window.__received = [];      // messages that passed every check
  window.__rejected = [];      // messages seen but dropped

  window.addEventListener('message', (event) => {
    const d = event.data;
    const why = [];
    if (event.source !== iframe.contentWindow) why.push('source');
    if (event.origin !== WIDGET_ORIGIN) why.push('origin');
    if (!d || d.protocol !== PROTOCOL) why.push('protocol');
    if (d && d.channel !== CHANNEL) why.push('channel');
    if (why.length) { window.__rejected.push({ data: d, why }); return; }
    window.__received.push(d);
    if (d.type === 'resize') {
      const h = Number(d.height);
      if (Number.isFinite(h)) iframe.style.height = Math.min(Math.max(h, 56), window.innerHeight - 40) + 'px';
    }
  });
</script>
</body></html>`;

export function startHostSimulator() {
  return http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(page(url.searchParams.get('channel') || 'chan-abc123'));
  })
  .listen(PORT);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startHostSimulator();
  console.log('host-site simulator on', PORT);
}
