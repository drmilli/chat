# Token Chat — Privacy Policy

_Last updated: 2026-08-25_

This describes exactly what the Token Chat browser extension and web app collect,
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

## Deletion

To have your messages or identity removed, contact us at the address in the
Chrome Web Store listing with your identity id or wallet address.

## Changes

Material changes to this policy will be reflected in the extension listing and in
this file's revision history.
