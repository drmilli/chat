Detection runner

This script runs a headless Chromium (Playwright) instance and evaluates the detectors against pages listed in `urls.json`.

Setup

```bash
# from repo root
npm install -D playwright
npx playwright install chromium
```

Run

```bash
node scripts/detect/run-detection.js scripts/detect/urls.json
```

Outputs
- HTML snapshots saved to `docs/spike-samples/`.
- Results JSON at `docs/spike-results.json`.

Provide real token page URLs in `scripts/detect/urls.json` before running.
