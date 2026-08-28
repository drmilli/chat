# Chorus — Privacy Policy

_Last updated: 2026-08-25_

This describes exactly what the Chorus browser extension and web app collect,
why, and what we do not do. It is written from the actual behaviour of the code,
not from a template.

## What the extension reads

On **gmgn.ai**, **axiom.trade** and **padre.gg** only, the extension reads the
page URL and — when the URL alone is not enough — a narrow set of page elements
(links to block explorers, `data-*` address attributes, address-shaped meta tags)
to work out which token contract address you are looking at.

It does not read page content generally, does not run on any other site, and does
not observe your browsing elsewhere.

## What is stored on your device

- The contract address detected on the current tab, and a short history of
  recently detected addresses (`chrome.storage.local`).
- Your session token and chosen display name (`localStorage`).
- A copy of your session token in `chrome.storage.local`, once you sign in on
  the Chorus web app. This exists because Chrome keeps separate storage for
  a site opened directly and the same site embedded in a page, so the chat
  widget on a token page cannot otherwise see that you signed in. The extension
  holds the token only to hand it back to its own chat widget, on its own
  origin. **It is never sent to the site you are visiting.**

Clearing the extension's storage or your browser data removes all of it. The
"Clear" button in the extension popup erases the detected-address history.

## What is sent to our servers

Only when you actively use the chat:

- **Messages you send**, and **voice notes you record**, together with the room
  (contract address) and your identity id.
- **Your identity**: either a randomly generated guest id created by our server,
  or — if you choose to connect a wallet — your public wallet address and a
  signature proving you control it. The signature grants no spending permission
  and costs no gas.
- **A display name**, if you set one.

Chat messages and voice notes are visible to anyone who opens that token's room.
Do not post anything you would not say in public.

### Live voice chat

Live voice chat is **opt-in and off until you press "Join voice"**, and it
requires a connected wallet. You join with your microphone **muted**; it only
opens when you press "Unmute".

- **Your audio is not sent to our servers and is not recorded.** Live voice uses
  WebRTC, which connects your browser directly to the other participants. What
  our server relays is only the small connection-setup messages browsers need to
  find each other (network addresses and audio-format descriptions).
- **Direct connections reveal your IP address to the other participants in the
  call.** This is inherent to peer-to-peer audio, not specific to us. Where a
  direct connection is impossible, audio is routed through a relay server
  instead, which sees encrypted traffic but not its contents.
- **Anyone in the room can hear you while you are unmuted.** Live audio is not
  recorded, so unlike text it cannot be reviewed after the fact — which is why
  speaking requires a verified wallet.
- **Moderators can mute or remove you from a voice call.** Because audio is
  peer-to-peer, this works by telling everyone else's browser to stop playing
  your audio, rather than by cutting off your microphone. Being removed also
  keeps you out of that room's voice chat for a cooling-off period.
- Leaving the call, or closing the tab, stops your microphone and removes you
  from the session.

## Technical data

Our API records request counts per IP address and per identity, held in memory,
to enforce rate limits and prevent spam. These counters are not written to the
database and do not persist across restarts. Standard server logs may contain IP
addresses.

## What we never do

- We never have access to your private keys or seed phrase. Connecting a wallet
  only shares your public address and a signature.
- We never initiate transactions or request spending approval from the chat
  extension.
- We do not sell or share your data with third parties, and we run no advertising
  or third-party analytics trackers in the extension.
- We never record live voice chat, and we never open your microphone without you
  pressing "Join voice" and then "Unmute".

## Deletion

To have your messages or identity removed, contact us at the address in the
Chrome Web Store listing with your identity id or wallet address.

## Changes

Material changes to this policy will be reflected in the extension listing and in
this file's revision history.
