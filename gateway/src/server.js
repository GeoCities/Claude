import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import dnsPacket from 'dns-packet';
import { ethers } from 'ethers';

import { getUserRecord } from './records.js';
import { mountRegistrationRoutes } from './registration.js';

const PORT = Number(process.env.PORT || 8787);
const RESOLVER_ADDRESS = process.env.RESOLVER_ADDRESS;
const SIGNER_PK = process.env.SIGNER_PK;

if (!RESOLVER_ADDRESS || !SIGNER_PK) {
  console.error('Missing RESOLVER_ADDRESS or SIGNER_PK in env. See gateway/.env.example');
  process.exit(1);
}

const signer = new ethers.Wallet(SIGNER_PK);
console.log('[gateway] signer address:', signer.address);
console.log('[gateway] resolver      :', RESOLVER_ADDRESS);
console.log('[gateway] make sure the on-chain resolver.signer == this signer.address');

// --- ENS resolver ABI fragments we need to decode/encode ---
const RESOLVE_IFACE = new ethers.Interface([
  'function resolve(bytes name, bytes data) view returns (bytes)',
]);
const RECORDS_IFACE = new ethers.Interface([
  'function addr(bytes32 node) view returns (address)',
  'function addr(bytes32 node, uint256 coinType) view returns (bytes)',
  'function text(bytes32 node, string key) view returns (string)',
  'function contenthash(bytes32 node) view returns (bytes)',
]);

const SEL_ADDR        = ethers.id('addr(bytes32)').slice(0, 10);
const SEL_ADDR_COIN   = ethers.id('addr(bytes32,uint256)').slice(0, 10);
const SEL_TEXT        = ethers.id('text(bytes32,string)').slice(0, 10);
const SEL_CONTENTHASH = ethers.id('contenthash(bytes32)').slice(0, 10);

function dnsDecodeName(nameHex) {
  const bytes = Buffer.from(nameHex.slice(2), 'hex');
  // dns-packet's name codec returns the full dot-joined name without the trailing dot.
  return dnsPacket.name.decode(bytes);
}

function leftmostLabel(name) {
  const labels = name.split('.').filter(Boolean);
  return labels[0] || null;
}

async function handleLookup(callDataHex) {
  const [nameBytes, dataBytes] = RESOLVE_IFACE.decodeFunctionData('resolve', callDataHex);
  const name = dnsDecodeName(nameBytes);
  const label = leftmostLabel(name);
  console.log('[gateway] lookup', { name, label });

  const record = label ? getUserRecord(label) : null;

  // No record → return empty bytes (still signed); the resolver will hand the client back
  // an empty answer for the query, which decodes to address(0) / empty string / etc.
  if (!record) {
    const result = '0x';
    return await signResponse(callDataHex, result);
  }

  const innerSelector = ethers.dataSlice(dataBytes, 0, 4);
  let result = '0x';

  if (innerSelector === SEL_ADDR) {
    const addr = record.address || ethers.ZeroAddress;
    result = ethers.AbiCoder.defaultAbiCoder().encode(['address'], [addr]);
  } else if (innerSelector === SEL_ADDR_COIN) {
    const decoded = RECORDS_IFACE.decodeFunctionData('addr(bytes32,uint256)', dataBytes);
    const coinType = decoded[1];
    if (coinType === 60n) {
      // ETH — return the 20-byte address as raw bytes (per ENSIP-9 / ENSIP-11).
      const addrBytes = record.address ? ethers.getBytes(record.address) : new Uint8Array();
      result = ethers.AbiCoder.defaultAbiCoder().encode(['bytes'], [addrBytes]);
    } else {
      result = ethers.AbiCoder.defaultAbiCoder().encode(['bytes'], ['0x']);
    }
  } else if (innerSelector === SEL_TEXT) {
    const decoded = RECORDS_IFACE.decodeFunctionData('text', dataBytes);
    const key = decoded[1];
    const value = (record.text && record.text[key]) || '';
    result = ethers.AbiCoder.defaultAbiCoder().encode(['string'], [value]);
  } else if (innerSelector === SEL_CONTENTHASH) {
    const ch = record.contenthash && record.contenthash !== '0x' ? record.contenthash : '0x';
    result = ethers.AbiCoder.defaultAbiCoder().encode(['bytes'], [ch === '0x' ? '0x' : ch]);
  } else {
    console.warn('[gateway] unhandled selector', innerSelector);
    result = '0x';
  }

  return await signResponse(callDataHex, result);
}

// extraData on-chain is `abi.encode(name, data)` — i.e. the *original* request, not the
// ABI-encoded `resolve(...)` call. The contract hashes extraData; we must hash the same
// bytes here. The web client passes us the wrapped resolve(name, data) callData; we
// re-derive (name, data) and re-encode them as the contract did.
async function signResponse(callDataHex, result) {
  const [nameBytes, dataBytes] = RESOLVE_IFACE.decodeFunctionData('resolve', callDataHex);
  const extraData = ethers.AbiCoder.defaultAbiCoder().encode(['bytes', 'bytes'], [nameBytes, dataBytes]);

  const expires = BigInt(Math.floor(Date.now() / 1000) + 300);

  // Must match the Solidity construction byte-for-byte:
  //   keccak256(0x1900 || resolver || expires || keccak(extraData) || keccak(result))
  const messageHash = ethers.solidityPackedKeccak256(
    ['bytes2', 'address', 'uint64', 'bytes32', 'bytes32'],
    ['0x1900', RESOLVER_ADDRESS, expires, ethers.keccak256(extraData), ethers.keccak256(result)],
  );

  const signature = signer.signingKey.sign(messageHash).serialized;
  const data = ethers.AbiCoder.defaultAbiCoder().encode(
    ['bytes', 'uint64', 'bytes'],
    [result, expires, signature],
  );
  return data;
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

async function lookupHandler(req, res) {
  try {
    const { data } = req.params;
    // Both URL forms append `.json`; trim it.
    const callData = data.endsWith('.json') ? data.slice(0, -5) : data;
    const out = await handleLookup(callData);
    res.json({ data: out });
  } catch (err) {
    console.error('[gateway] /lookup error:', err);
    res.status(400).json({ error: err.message });
  }
}

app.get('/lookup/:sender/:data', lookupHandler);
app.post('/lookup/:sender/:data', lookupHandler);

app.get('/health', (_req, res) => res.json({ ok: true, signer: signer.address }));

mountRegistrationRoutes(app);

app.listen(PORT, () => {
  console.log(`[gateway] listening on http://localhost:${PORT}`);
});
