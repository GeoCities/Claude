import { createPublicClient, http, namehash } from 'viem';
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

// viem 2.x doesn't ship a getEnsContenthash action, so we resolve it manually:
//   1. find the resolver for the name
//   2. call resolver.contenthash(namehash(name))
//   3. ENSIP-10 wildcard / CCIP-Read resolvers are handled by viem's
//      universalResolverAddress + ccipRead path.
const RESOLVER_ABI = [
  {
    name: 'contenthash',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bytes' }],
  },
] as const;

async function fetchContenthash(name: string): Promise<string | null> {
  try {
    const resolver = await publicClient.getEnsResolver({ name });
    if (!resolver) return null;
    const node = namehash(name);
    const raw = await publicClient.readContract({
      address: resolver,
      abi: RESOLVER_ABI,
      functionName: 'contenthash',
      args: [node],
    });
    return raw as string;
  } catch (err) {
    console.warn('[ens] contenthash fetch failed for', name, err);
    return null;
  }
}

export async function resolveName(name: string): Promise<ResolvedName> {
  const [address, description, avatar, url, contenthashRaw] = await Promise.all([
    publicClient.getEnsAddress({ name }).catch(() => null),
    publicClient.getEnsText({ name, key: TEXT_KEYS[0] }).catch(() => null),
    publicClient.getEnsText({ name, key: TEXT_KEYS[1] }).catch(() => null),
    publicClient.getEnsText({ name, key: TEXT_KEYS[2] }).catch(() => null),
    fetchContenthash(name),
  ]);

  return {
    name,
    address: (address as `0x${string}` | null) ?? null,
    contenthash: contenthashRaw && contenthashRaw !== '0x' ? decodeContenthash(contenthashRaw) : null,
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
