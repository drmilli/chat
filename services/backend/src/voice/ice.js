/**
 * ICE server configuration handed to the browser before it negotiates.
 *
 * STUN alone is not enough. Roughly 10-20% of users sit behind symmetric NAT,
 * where no amount of hole-punching works and the media has to be relayed. With
 * no TURN server configured those users do not get bad audio — they get no
 * connection at all, and the failure looks like the feature is broken.
 *
 * TURN CREDENTIALS ARE EPHEMERAL, AND MUST BE.
 * A TURN server relays bandwidth, which costs money, so its credentials are a
 * theft target. Shipping a static username/password to the client publishes it
 * to anyone who opens devtools. Instead this issues coturn's REST-API
 * credentials: a username that is just an expiry timestamp, and a password that
 * is an HMAC of it under a secret that never leaves the server. They expire on
 * their own, so a scraped credential is worth minutes rather than forever.
 */

const crypto = require('crypto');

/** Public STUN, used for the majority of peers that can connect directly. */
const DEFAULT_STUN = ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'];

const CREDENTIAL_TTL_SECONDS = Number(process.env.TURN_CREDENTIAL_TTL_SECONDS || 3600);

function stunUrls() {
  const configured = String(process.env.STUN_URLS || '')
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean);
  return configured.length ? configured : DEFAULT_STUN;
}

function turnUrls() {
  return String(process.env.TURN_URLS || '')
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean);
}

/**
 * coturn's `use-auth-secret` scheme: username is "<expiry>:<label>", credential
 * is base64(HMAC-SHA1(username, secret)).
 */
function turnCredentials(label, now = Date.now()) {
  const secret = process.env.TURN_SECRET;
  if (!secret) return null;

  const expiry = Math.floor(now / 1000) + CREDENTIAL_TTL_SECONDS;
  const username = `${expiry}:${label}`;
  const credential = crypto.createHmac('sha1', secret).update(username).digest('base64');

  return { username, credential, expiresAt: expiry * 1000 };
}

/**
 * Builds the RTCConfiguration `iceServers` array for one participant.
 *
 * @param {string} label identifies the credential in TURN logs — the peer id,
 *        never a wallet address, which would put identity in a third party's logs.
 */
function iceServers(label, now = Date.now()) {
  const servers = [{ urls: stunUrls() }];

  const urls = turnUrls();
  const credentials = turnCredentials(label, now);

  if (urls.length && credentials) {
    servers.push({
      urls,
      username: credentials.username,
      credential: credentials.credential,
    });
  }

  return {
    iceServers: servers,
    // Report the gap rather than let it look like a client-side bug: without
    // TURN a predictable slice of users simply cannot connect.
    turnConfigured: Boolean(urls.length && credentials),
    expiresAt: credentials?.expiresAt ?? null,
  };
}

/** Warns once at boot so a missing relay is noticed before users are. */
function warnIfIncomplete(warn = console.warn) {
  const urls = turnUrls();
  if (!urls.length) {
    warn(
      'VOICE: no TURN_URLS configured. Peers behind symmetric NAT (commonly 10-20% ' +
        'of users) will fail to connect, and it will look like voice chat is broken.'
    );
    return false;
  }
  if (!process.env.TURN_SECRET) {
    warn(
      'VOICE: TURN_URLS is set but TURN_SECRET is not, so no credentials can be ' +
        'issued and the relay will reject every allocation.'
    );
    return false;
  }
  return true;
}

module.exports = { iceServers, turnCredentials, warnIfIncomplete, DEFAULT_STUN, CREDENTIAL_TTL_SECONDS };
