// Passkey (WebAuthn) helpers. We use SimpleWebAuthn for the browser ceremony and
// then hand-parse the attestationObject to extract a raw P-256 public key, since
// we need the uncompressed point ("0x04 || X || Y") to plug into a smart-account
// ownership slot — not just an opaque credential id.

import { startRegistration, startAuthentication } from '@simplewebauthn/browser';

export type PasskeyResult = {
  credentialId: string;     // base64url
  publicKey: `0x${string}`; // uncompressed P-256, 65 bytes
  algorithm: -7;            // ES256
};

function randomChallenge(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return bufToBase64Url(buf);
}

function bufToBase64Url(buf: Uint8Array): string {
  let s = '';
  for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(b64url.length + ((4 - (b64url.length % 4)) % 4), '=');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToHex(buf: Uint8Array): `0x${string}` {
  let s = '0x';
  for (let i = 0; i < buf.length; i++) s += buf[i].toString(16).padStart(2, '0');
  return s as `0x${string}`;
}

/**
 * Walks the CBOR-encoded attestationObject to extract the raw P-256 public key.
 *
 * We don't pull in a full CBOR parser — the attestationObject layout is fixed
 * for our params (alg=-7, attestation='none'), so we can scan for landmarks:
 *
 *   1. Locate the literal ASCII bytes "authData" (the CBOR map key).
 *   2. The value is a CBOR byte-string. Header byte tells us its length encoding:
 *        0x58 → 1-byte length follows
 *        0x59 → 2-byte length follows
 *      Skip the header bytes accordingly.
 *   3. Inside authData: skip rpIdHash(32) + flags(1) + signCount(4) + AAGUID(16)
 *      = 53 bytes to land at credIdLength.
 *   4. Read 2 bytes credIdLength, skip that many to reach the COSE_Key.
 *   5. The COSE_Key is a CBOR map. We don't parse it strictly; we know we need
 *      the X (-2 = label 0x21 in our negative-int encoding) and Y (-3 = 0x22)
 *      coordinates, which are 32-byte byte-strings encoded as `<key> 0x58 0x20`.
 *      Scan for those byte sequences.
 *
 * Production should use a real CBOR decoder + verify the attestation; v1 is
 * "none" attestation so there's nothing to verify against, only to extract.
 */
function extractP256PubKey(attestationObject: Uint8Array): `0x${string}` {
  // 1. Find "authData"
  const marker = new TextEncoder().encode('authData');
  let idx = -1;
  outer: for (let i = 0; i + marker.length <= attestationObject.length; i++) {
    for (let j = 0; j < marker.length; j++) {
      if (attestationObject[i + j] !== marker[j]) continue outer;
    }
    idx = i + marker.length;
    break;
  }
  if (idx < 0) throw new Error('passkey: authData marker not found');

  // 2. Skip CBOR byte-string header.
  let cursor = idx;
  const header = attestationObject[cursor++];
  if (header === 0x58) {
    cursor += 1; // 1-byte length
  } else if (header === 0x59) {
    cursor += 2; // 2-byte length
  } else if (header >= 0x40 && header <= 0x57) {
    // tiny byte-string with length embedded in header — no extra length bytes
  } else {
    throw new Error(`passkey: unexpected authData header 0x${header.toString(16)}`);
  }

  // 3. Skip rpIdHash + flags + counter + AAGUID.
  cursor += 53;

  // 4. credIdLength as big-endian uint16, then skip the credId.
  const credIdLen = (attestationObject[cursor] << 8) | attestationObject[cursor + 1];
  cursor += 2 + credIdLen;

  // 5. Scan for X (key 0x21, sig "21 58 20") and Y (key 0x22, sig "22 58 20").
  function findCoord(keyByte: number): Uint8Array {
    for (let i = cursor; i + 35 <= attestationObject.length; i++) {
      if (
        attestationObject[i] === keyByte &&
        attestationObject[i + 1] === 0x58 &&
        attestationObject[i + 2] === 0x20
      ) {
        return attestationObject.slice(i + 3, i + 3 + 32);
      }
    }
    throw new Error(`passkey: COSE coord 0x${keyByte.toString(16)} not found`);
  }
  const x = findCoord(0x21);
  const y = findCoord(0x22);

  const pub = new Uint8Array(65);
  pub[0] = 0x04;
  pub.set(x, 1);
  pub.set(y, 33);
  return bytesToHex(pub);
}

export async function createPasskey(username: string): Promise<PasskeyResult> {
  const challenge = randomChallenge(32);
  const userId = bufToBase64Url(new TextEncoder().encode(username));

  // SimpleWebAuthn v10 takes options directly; v11+ wraps them in `{ optionsJSON }`.
  const reg = await startRegistration({
    challenge,
    rp: {
      id: window.location.hostname,
      name: 'GeoCities',
    },
    user: {
      id: userId,
      name: `${username}.geocities.eth`,
      displayName: `${username}.geocities.eth`,
    },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
    timeout: 60_000,
    attestation: 'none',
    authenticatorSelection: {
      residentKey: 'required',
      userVerification: 'required',
    },
  });

  const attObjBytes = base64UrlToBytes(reg.response.attestationObject);
  const publicKey = extractP256PubKey(attObjBytes);

  return {
    credentialId: reg.id,
    publicKey,
    algorithm: -7,
  };
}

export async function signWithPasskey(credentialId: string, challenge: Uint8Array) {
  const auth = await startAuthentication({
    challenge: bufToBase64Url(challenge),
    rpId: window.location.hostname,
    allowCredentials: [{ id: credentialId, type: 'public-key' }],
    userVerification: 'required',
    timeout: 60_000,
  });
  return {
    signature: auth.response.signature,
    clientDataJSON: auth.response.clientDataJSON,
    authenticatorData: auth.response.authenticatorData,
  };
}
