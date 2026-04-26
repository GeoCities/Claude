// Tiny file-backed JSON record store. One JSON object keyed by label.
// Each record: { address, contenthash, text: {}, updatedAt }.
//
// Synchronous I/O is fine for v1: the store is small, single-process, and the
// gateway is read-mostly. Swap for SQLite / Postgres before mainnet.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const STORE_PATH = resolve(process.env.STORE_PATH || './records.json');
const LABEL_RE = /^[a-z0-9-]{3,32}$/;

function load() {
  if (!existsSync(STORE_PATH)) return {};
  try {
    const raw = readFileSync(STORE_PATH, 'utf8');
    return JSON.parse(raw || '{}');
  } catch (err) {
    console.error('[records] failed to read store, starting empty:', err.message);
    return {};
  }
}

function save(db) {
  writeFileSync(STORE_PATH, JSON.stringify(db, null, 2));
}

export function isValidLabel(label) {
  return typeof label === 'string' && LABEL_RE.test(label);
}

export function getUserRecord(label) {
  if (!isValidLabel(label)) return null;
  const db = load();
  return db[label] || null;
}

export function upsertUserRecord(label, partial) {
  if (!isValidLabel(label)) throw new Error('invalid label');
  const db = load();
  const prev = db[label] || { address: null, contenthash: '0x', text: {}, updatedAt: 0 };
  const next = {
    address: partial.address ?? prev.address,
    contenthash: partial.contenthash ?? prev.contenthash,
    text: { ...(prev.text || {}), ...(partial.text || {}) },
    updatedAt: Date.now(),
  };
  db[label] = next;
  save(db);
  return next;
}

export function listAllRecords() {
  return load();
}

export const STORE_FILE = STORE_PATH;
