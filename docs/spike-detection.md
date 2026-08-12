Spike: CA Detection (GMGN, Axiom, Padre)

Goal
Run a focused 2-day spike to determine reliable token contract address (CA) detection strategies for the three target sites. Deliver selectors, URL patterns, and a regression test approach.

Objectives
- Identify URL patterns that contain CA for each site.
- Identify DOM selectors that contain CA when URL is insufficient.
- Produce a detection module per site (URL-first, DOM fallback).
- Collect at least 5 example pages per site demonstrating detection success and edge-cases.
- Deliver a short report with selectors, regexes, and a confidence level per site.

Data collection checklist
- Gather 5 canonical token pages from GMGN, Axiom, and Padre each (total 15 pages).
- Record page URLs and a short note when URL contains CA vs when DOM-only.
- Save HTML snapshots for at least 2 pages per site to test DOM scraping regressions.

Detection approach
1. URL-first: attempt CA extraction using deterministic regexes on the URL path/query.
2. DOM fallback: attempt robust selectors (data attributes, meta tags, link rels, or visible address elements).
3. Normalization: lowercase; prefix with chain if multi-chain support is planned (e.g. `robinhood:<address>`).
4. Fallback UI: expose a small paste-CA input in the widget when detectors fail.

Implementation checklist
- [ ] Implement `apps/extension/detectors/gmgn.ts` (URL regex + DOM selectors)
- [ ] Implement `apps/extension/detectors/axiom.ts`
- [ ] Implement `apps/extension/detectors/padre.ts`
- [ ] Add `apps/extension/content-script.ts` to wire detectors and inject iframe
- [ ] Collect 15 example URLs and save snapshots into `docs/spike-samples/`

Deliverables
- `docs/spike-detection.md` (this file)
- Detector modules in `apps/extension/detectors/`
- A short report (markdown) listing selectors, URL patterns, and confidence levels per site

Testing notes
- Run detectors against saved HTML snapshots (manual) and a small headless Chromium script if feasible.
- Confirm detection success rate >= 80% on collected examples for URL-first method.

Owners
- Frontend Engineer (owner): run the spike, implement detectors, collect examples.
- Backend/Product: available for clarifications on room routing and CA normalization.
