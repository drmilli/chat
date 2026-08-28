# Chrome Web Store submission checklist

A wallet-adjacent extension injecting into financial sites attracts maximum
review scrutiny. The trading addendum tells us to budget for rejection loops —
this list exists to reduce them.

## Fixed already

- [x] **No `localhost` in the shipped manifest.** `npm run build` strips dev
      hosts; `npm run build:dev` keeps them for local work. A reviewer seeing
      `http://localhost/*` in host permissions will ask why.
- [x] **Permissions narrowed to `storage`.** The broad `tabs` permission was
      dropped — `host_permissions` already expose `tab.url` for the three sites
      we support, and the popup degrades cleanly elsewhere (verified).
- [x] **Host permissions are per-site**, never `<all_urls>`.
- [x] **A description that states what the extension does** for a user, rather
      than describing the implementation.
- [x] **Icons at 16/32/48/128** generated from a single source (`npm run logo:build`).
- [x] **Privacy policy written** — `apps/extension/PRIVACY.md`.

## Before submitting

- [ ] **Host the privacy policy at a public URL** and put that URL in the listing.
      The store rejects data-handling extensions without one.
- [ ] **Explain the second content script.** `session-bridge.js` runs only on
      our own web app (`chorustrade.online`, plus `token-chat.vercel.app`
      during the domain migration) and does one thing: copy the
      signed-in session token into extension storage so the chat widget can see
      it. Reviewers see two content scripts and will ask why; the answer is
      Chrome's third-party storage partitioning, which stops the embedded widget
      from reading a session created in a first-party tab.

- [ ] **Justify each permission in the listing form.** Expected answers:
      `storage` — remembering detected addresses and your session;
      host permissions — reading the contract address on the three supported
      sites and reaching our own API.
- [ ] **Declare data use**: messages and voice notes are transmitted to our
      server; wallet address only if the user connects one. Tick "not sold to
      third parties".
- [ ] **Screenshots (1280×800)** of the widget on a token page and of the popup.
- [ ] **A demo video or reviewer notes** explaining that the widget is a chat
      overlay that does not modify the host site's trading controls.
- [ ] **Consider publishing the exact shipped build's source** — Frontrun's
      approach to countering wallet-extension distrust.

## Before the Phase 7 (trading) re-review

- [ ] Re-review is triggered by adding wallet/trading capability; budget weeks,
      not days.
- [ ] Pen-test findings on the widget boundary resolved (T-505) — the automated
      boundary regression suite is the baseline.
- [ ] Legal sign-off on custody / money transmission recorded (T-506).
- [ ] Any new permission (e.g. for the wallet provider's domain) added narrowly
      and justified in the listing.
