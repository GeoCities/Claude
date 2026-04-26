import { ethers } from 'ethers';
import { getUserRecord, upsertUserRecord, isValidLabel } from './records.js';

const HEX_RE = /^0x[0-9a-f]+$/i;

// v1 dev mode: smart-account passkey-signed messages don't reduce to a plain
// EOA personal_sign, so the web client posts a 65-byte zero "signature" as a
// placeholder. We accept that here; production must verify EIP-1271 against
// the user's smart account and reject the placeholder.
const ZERO_SIG = '0x' + '00'.repeat(65);

function verifyOrAcceptDevSig(message, signature, claimedAddress) {
  if (signature && signature.toLowerCase() === ZERO_SIG) {
    console.warn('[registration] DEV: accepting placeholder signature for', claimedAddress);
    return true;
  }
  try {
    const recovered = ethers.verifyMessage(message, signature);
    return recovered.toLowerCase() === claimedAddress.toLowerCase();
  } catch (err) {
    console.error('[registration] verifyMessage failed:', err.message);
    return false;
  }
}

export function mountRegistrationRoutes(app) {
  app.post('/register', (req, res) => {
    const { label, address, signature, message } = req.body || {};
    if (!isValidLabel(label)) return res.status(400).json({ error: 'invalid label' });
    if (!ethers.isAddress(address || '')) return res.status(400).json({ error: 'invalid address' });
    if (typeof message !== 'string' || !message.includes(label)) {
      return res.status(400).json({ error: 'message must contain label (replay protection)' });
    }
    if (!verifyOrAcceptDevSig(message, signature, address)) {
      return res.status(401).json({ error: 'bad signature' });
    }
    const existing = getUserRecord(label);
    if (existing && existing.address && existing.address.toLowerCase() !== address.toLowerCase()) {
      return res.status(409).json({ error: 'label already taken' });
    }
    const record = upsertUserRecord(label, {
      address,
      contenthash: existing?.contenthash || '0x',
      text: existing?.text || {},
    });
    res.json({ ok: true, label, record });
  });

  app.post('/update-contenthash', (req, res) => {
    const { label, contenthash, address, signature, message } = req.body || {};
    if (!isValidLabel(label)) return res.status(400).json({ error: 'invalid label' });
    if (!ethers.isAddress(address || '')) return res.status(400).json({ error: 'invalid address' });
    if (typeof contenthash !== 'string' || !HEX_RE.test(contenthash)) {
      return res.status(400).json({ error: 'invalid contenthash' });
    }
    if (typeof message !== 'string' || !message.includes(label)) {
      return res.status(400).json({ error: 'message must contain label' });
    }
    if (!verifyOrAcceptDevSig(message, signature, address)) {
      return res.status(401).json({ error: 'bad signature' });
    }
    const existing = getUserRecord(label);
    if (!existing) return res.status(404).json({ error: 'label not found' });
    if (existing.address.toLowerCase() !== address.toLowerCase()) {
      return res.status(403).json({ error: 'not the owner' });
    }
    const record = upsertUserRecord(label, { contenthash });
    res.json({ ok: true, label, record });
  });

  app.get('/record/:label', (req, res) => {
    const { label } = req.params;
    if (!isValidLabel(label)) return res.status(400).json({ error: 'invalid label' });
    const record = getUserRecord(label);
    if (!record) return res.status(404).json({ error: 'not found' });
    res.json({ label, record });
  });
}
