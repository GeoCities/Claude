import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { create } from '@web3-storage/w3up-client';
import { CarReader } from '@ipld/car';

const PORT = Number(process.env.PORT || 8788);
const W3_EMAIL = process.env.W3_EMAIL;
const W3_SPACE = process.env.W3_SPACE;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

let _clientPromise = null;

// Lazy-init: w3up has to round-trip an email login the first time, so we don't want
// to block server startup. The first /pin call pays the latency.
async function getClient() {
  if (_clientPromise) return _clientPromise;
  _clientPromise = (async () => {
    if (!W3_EMAIL || !W3_SPACE) {
      throw new Error('W3_EMAIL and W3_SPACE must be set in env (see .env.example)');
    }
    console.log('[pinning] initializing w3up-client…');
    const client = await create();
    await client.login(W3_EMAIL);
    await client.setCurrentSpace(W3_SPACE);
    console.log('[pinning] w3up ready, space:', W3_SPACE);
    return client;
  })().catch((err) => {
    // Reset so a retry can re-init.
    _clientPromise = null;
    throw err;
  });
  return _clientPromise;
}

const app = express();
app.use(cors());
app.use(express.json());

app.post('/pin', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file field required' });
    const client = await getClient();
    const filename = req.file.originalname || 'index.html';
    const file = new File([req.file.buffer], filename, {
      type: req.file.mimetype || 'application/octet-stream',
    });
    const cid = await client.uploadFile(file);
    const cidStr = cid.toString();
    res.json({
      cid: cidStr,
      contenthash: { type: 'ipfs', cid: cidStr },
      size: req.file.size,
    });
  } catch (err) {
    console.error('[pinning] /pin error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/pin-bundle', upload.single('car'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'car field required' });
    const client = await getClient();
    const reader = await CarReader.fromBytes(req.file.buffer);
    const roots = await reader.getRoots();
    if (!roots.length) return res.status(400).json({ error: 'CAR has no roots' });
    await client.uploadCAR(new Blob([req.file.buffer]));
    res.json({
      cid: roots[0].toString(),
      roots: roots.map((r) => r.toString()),
      size: req.file.size,
    });
  } catch (err) {
    console.error('[pinning] /pin-bundle error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/health', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`[pinning] listening on http://localhost:${PORT}`);
});
