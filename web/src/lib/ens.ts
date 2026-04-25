import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';

const RPC_URL = (import.meta as any).env?.VITE_MAINNET_RPC || 'https://eth.llamarpc.com';

export const publicClient = createPublicClient({
  chain: mainnet,
  transport: http(RPC_URL),
});

export type Decoded =
  | { protocol: 'ipfs' | 'ipns'; cid: string }
  | { protocol: 'unknown'; raw: string };

export type ResolvedName = {
  name: string;
  address: `0x${string}` | null;
  contenthash: Decoded | null;
  text: { description: string | null; avatar: string | null; url: string | null };
};

const TEXT_KEYS = ['description', 'avatar', 'url'] as const;

export async function resolveName(name: string): Promise<ResolvedName> {
  // viem ships getEnsContenthash but the exact spelling has wandered between
  // versions; reach for it tolerantly so this still compiles forward.
  const getCH = (publicClient as any).getEnsContentHash || (publicClient as any).getEnsContenthash;

  const [address, description, avatar, url, contenthashRaw] = await Promise.all([
    publicClient.getEnsAddress({ name }).catch(() => null),
    publicClient.getEnsText({ name, key: TEXT_KEYS[0] }).catch(() => null),
    publicClient.getEnsText({ name, key: TEXT_KEYS[1] }).catch(() => null),
    publicClient.getEnsText({ name, key: TEXT_KEYS[2] }).catch(() => null),
    getCH ? getCH.call(publicClient, { name }).catch(() => null) : Promise.resolve(null),
  ]);

  return {
    name,
    address: (address as `0x${string}` | null) ?? null,
    contenthash: contenthashRaw ? decodeContenthash(contenthashRaw as string) : null,
    text: { description, avatar, url },
  };
}

// ENSIP-7 contenthash codec (just the IPFS / IPNS branches we care about).
//   0xe3 0x01 <varint-cidv1>...   → IPFS
//   0xe5 0x01 <varint-cidv1>...   → IPNS
// We need to render the trailing bytes as a base32 CIDv1 with multibase prefix 'b'.
const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

function bytesToBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  return out;
}

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}

export function decodeContenthash(hex: string): Decoded {
  if (!hex || hex === '0x') return { protocol: 'unknown', raw: hex || '0x' };
  const bytes = hexToBytes(hex);
  if (bytes.length < 2) return { protocol: 'unknown', raw: hex };

  // Multicodec prefix is varint-encoded but for IPFS (0xe3 0x01) and IPNS (0xe5 0x01)
  // both prefixes serialize to two bytes — sufficient for v1.
  if (bytes[0] === 0xe3 && bytes[1] === 0x01) {
    const cidBytes = bytes.slice(2);
    return { protocol: 'ipfs', cid: 'b' + bytesToBase32(cidBytes) };
  }
  if (bytes[0] === 0xe5 && bytes[1] === 0x01) {
    const cidBytes = bytes.slice(2);
    return { protocol: 'ipns', cid: 'b' + bytesToBase32(cidBytes) };
  }
  return { protocol: 'unknown', raw: hex };
}
