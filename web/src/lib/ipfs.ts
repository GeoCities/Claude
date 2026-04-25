// Multi-gateway IPFS fetcher.
//
// v1 trusts whichever gateway answers first; we surface which one was used so
// the user knows. A real implementation would fetch the raw blocks and verify
// them against the CID locally (Helia in-process), but that's a follow-up.

const PIN_URL = (import.meta as any).env?.VITE_PIN_URL || 'http://localhost:8788';

export const GATEWAYS = [
  'https://w3s.link/ipfs',
  'https://dweb.link/ipfs',
  'https://ipfs.io/ipfs',
  'https://cf-ipfs.com/ipfs',
] as const;

export type IpfsContent = {
  body: string;
  contentType: string;
  cid: string;
  gateway: string;
};

export async function fetchIpfsContent(cid: string): Promise<IpfsContent> {
  let lastErr: unknown = null;
  for (const gw of GATEWAYS) {
    try {
      const url = `${gw}/${cid}`;
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) {
        lastErr = new Error(`${gw} → HTTP ${res.status}`);
        continue;
      }
      const contentType = res.headers.get('content-type') || 'text/html';
      const body = await res.text();
      const host = new URL(gw).hostname;
      return { body, contentType, cid, gateway: host };
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(`all gateways failed: ${(lastErr as Error)?.message ?? 'unknown'}`);
}

export async function pinSite(html: string): Promise<{ cid: string }> {
  const form = new FormData();
  form.append('file', new Blob([html], { type: 'text/html' }), 'index.html');
  const res = await fetch(`${PIN_URL}/pin`, { method: 'POST', body: form });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`pinning failed: HTTP ${res.status} ${text}`);
  }
  return res.json();
}
