// HTTP client for the GeoCities gateway.

const GATEWAY_URL = (import.meta as any).env?.VITE_GATEWAY_URL || 'http://localhost:8787';

export type RegisterArgs = {
  label: string;
  address: `0x${string}`;
  signature: `0x${string}`;
  message: string;
};

export type UpdateArgs = RegisterArgs & {
  contenthash: `0x${string}`;
};

async function postJson(path: string, body: unknown) {
  const res = await fetch(`${GATEWAY_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: any;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) {
    throw new Error(json.error || `HTTP ${res.status}`);
  }
  return json;
}

export function registerSubdomain(args: RegisterArgs) {
  return postJson('/register', args);
}

export function updateContenthash(args: UpdateArgs) {
  return postJson('/update-contenthash', args);
}

export async function checkLabelAvailable(label: string): Promise<boolean> {
  const res = await fetch(`${GATEWAY_URL}/record/${encodeURIComponent(label)}`);
  if (res.status === 404) return true;
  if (res.ok) return false;
  // On gateway error we conservatively return true so the user can still try; the
  // server will reject the duplicate at /register if there really is one.
  return true;
}

export async function encodeIpfsContenthash(cid: string): Promise<`0x${string}`> {
  const { encode } = await import('@ensdomains/content-hash');
  return ('0x' + encode('ipfs', cid)) as `0x${string}`;
}
