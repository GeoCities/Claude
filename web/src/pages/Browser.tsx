import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { resolveName } from '../lib/ens';
import { fetchIpfsContent, type IpfsContent } from '../lib/ipfs';

const SEED_SITES: Array<{ name: string; desc: string }> = [
  { name: 'vitalik.eth', desc: 'Vitalik Buterin — co-founder of Ethereum' },
  { name: 'ens.eth', desc: 'Ethereum Name Service' },
  { name: 'brantly.eth', desc: 'ENS lead, brantly.xyz' },
  { name: 'jefflau.eth', desc: 'ENS engineer' },
];

type Loaded = {
  url: string;
  protocol: 'ipfs' | 'ipns';
  content: IpfsContent;
  resolvedAddress?: string | null;
};

function isAllowedTarget(input: string): boolean {
  if (input.startsWith('ipfs://') || input.startsWith('ipns://')) return true;
  if (input.endsWith('.eth')) return true;
  return false;
}

export function Browser() {
  const { name: routeName } = useParams<{ name?: string }>();
  const navigate = useNavigate();
  const [input, setInput] = useState(routeName || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolvedAddress, setResolvedAddress] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  async function go(target: string) {
    setError(null);
    setLoaded(null);
    setResolvedAddress(null);
    if (!target) return;
    if (!isAllowedTarget(target)) {
      setError('Restricted browser: only .eth names and ipfs:// / ipns:// URLs are allowed.');
      return;
    }
    setLoading(true);
    try {
      if (target.startsWith('ipfs://') || target.startsWith('ipns://')) {
        const protocol = target.startsWith('ipfs://') ? 'ipfs' : 'ipns';
        const cid = target.replace(/^ipfs:\/\//, '').replace(/^ipns:\/\//, '');
        const content = await fetchIpfsContent(cid);
        setLoaded({ url: target, protocol, content });
      } else {
        const resolved = await resolveName(target);
        setResolvedAddress(resolved.address);
        if (!resolved.contenthash || resolved.contenthash.protocol === 'unknown') {
          throw new Error(
            resolved.contenthash
              ? `unsupported contenthash protocol: ${(resolved.contenthash as any).protocol}`
              : 'no contenthash set for this name',
          );
        }
        const content = await fetchIpfsContent(resolved.contenthash.cid);
        setLoaded({
          url: target,
          protocol: resolved.contenthash.protocol,
          content,
          resolvedAddress: resolved.address,
        });
      }
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }

  // Auto-load when navigated via /browser/:name.
  useEffect(() => {
    if (routeName && !loaded && !loading) {
      go(routeName);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeName]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    go(input.trim());
  }

  return (
    <div>
      <form
        onSubmit={onSubmit}
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          padding: 8,
        }}
      >
        <button
          type="button"
          onClick={() => navigate(-1)}
          style={{
            padding: '6px 10px',
            background: 'transparent',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            color: 'var(--muted)',
          }}
          aria-label="back"
        >
          ←
        </button>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="vitalik.eth or ipfs://bafy..."
          style={{
            flex: 1,
            padding: '8px 10px',
            border: 'none',
            outline: 'none',
            fontFamily: 'var(--font-mono)',
            fontSize: 14,
            background: 'transparent',
            color: 'var(--text)',
          }}
        />
        {loaded && (
          <span
            style={{
              fontSize: 12,
              padding: '4px 10px',
              borderRadius: 999,
              background: 'var(--success-bg)',
              color: 'var(--success)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            ● {loaded.protocol}
          </span>
        )}
        <button
          type="submit"
          disabled={loading}
          style={{
            padding: '8px 16px',
            background: 'var(--accent)',
            color: 'white',
            border: 'none',
            borderRadius: 'var(--radius)',
            fontWeight: 600,
          }}
        >
          {loading ? '…' : 'Go'}
        </button>
      </form>

      {error && (
        <div
          style={{
            marginTop: 16,
            padding: 14,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            color: 'var(--danger)',
          }}
        >
          <div>{error}</div>
          {resolvedAddress && (
            <div style={{ marginTop: 6, fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--muted)' }}>
              resolved address: {resolvedAddress}
            </div>
          )}
        </div>
      )}

      {loaded && (
        <div style={{ marginTop: 16 }}>
          <iframe
            title="ipfs"
            sandbox="allow-scripts"
            srcDoc={loaded.content.body}
            style={{
              width: '100%',
              height: '70vh',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)',
              background: 'white',
            }}
          />
          <div
            style={{
              marginTop: 8,
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 12,
              color: 'var(--muted)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }}>
              {loaded.content.cid}
            </span>
            <span>via {loaded.content.gateway}</span>
          </div>
        </div>
      )}

      {!loaded && !loading && !error && (
        <div style={{ marginTop: 24 }}>
          <div style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 12 }}>Try one of these</div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
              gap: 12,
            }}
          >
            {SEED_SITES.map((s) => (
              <button
                key={s.name}
                onClick={() => { setInput(s.name); go(s.name); }}
                style={{
                  textAlign: 'left',
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  padding: 14,
                }}
              >
                <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{s.name}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{s.desc}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
