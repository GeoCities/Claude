import { useEffect, useMemo, useState } from 'react';
import { useIdentity } from '../hooks/useIdentity';
import { encodeIpfsContenthash, updateContenthash } from '../lib/gateway';
import { pinSite } from '../lib/ipfs';

type ThemeKey = 'dusk' | 'neon' | 'vhs';

const THEMES: Record<ThemeKey, { bg: string; fg: string; accent: string }> = {
  dusk: { bg: '#1e1b4b', fg: '#e0e7ff', accent: '#a5b4fc' },
  neon: { bg: '#0a0a0a', fg: '#22ff88', accent: '#88ffaa' },
  vhs:  { bg: '#1a0033', fg: '#ff77dd', accent: '#ffaaff' },
};

type Site = {
  title: string;
  bio: string;
  theme: ThemeKey;
  guestbook: boolean;
};

const STORAGE_KEY = 'geocities.site.v1';
const DEFAULT_SITE: Site = {
  title: 'home',
  bio: 'just another corner of the internet',
  theme: 'dusk',
  guestbook: true,
};

const ZERO_SIG = ('0x' + '00'.repeat(65)) as `0x${string}`;

function load(): Site {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SITE;
    return { ...DEFAULT_SITE, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SITE;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderSiteHtml(site: Site, ensName: string | null): string {
  const t = THEMES[site.theme];
  const meta = site.guestbook ? 'guestbook · webring · 1,247 visits' : 'webring · 1,247 visits';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(site.title)}</title>
<style>
  body { margin: 0; padding: 32px; background: ${t.bg}; color: ${t.fg}; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; line-height: 1.6; }
  h1 { color: ${t.accent}; margin: 0 0 16px; font-size: 22px; }
  .bio { white-space: pre-wrap; }
  hr { border: none; border-top: 1px dashed ${t.fg}; opacity: 0.4; margin: 32px 0 16px; }
  .meta { font-size: 12px; opacity: 0.6; }
  .ens { font-size: 12px; opacity: 0.5; margin-top: 24px; }
</style>
</head>
<body>
  <h1>${escapeHtml(site.title)}</h1>
  <div class="bio">${escapeHtml(site.bio)}</div>
  <hr />
  <div class="meta">${meta}</div>
  <div class="ens">${escapeHtml(ensName || '')}</div>
</body>
</html>`;
}

type StepStatus = 'pending' | 'active' | 'done' | 'error';
type Pipeline = {
  steps: { label: string; status: StepStatus; detail?: string }[];
  cid?: string;
  error?: string;
};

const PIPELINE_LABELS = [
  'Bundle site as HTML',
  'Upload to pinning service',
  'Receive CIDv1',
  'Encode ENSIP-7 contenthash',
  'Update gateway record',
];

function initialPipeline(): Pipeline {
  return { steps: PIPELINE_LABELS.map((label) => ({ label, status: 'pending' })) };
}

export function Editor() {
  const { identity, ensName } = useIdentity();
  const [site, setSite] = useState<Site>(() => load());
  const [pipeline, setPipeline] = useState<Pipeline | null>(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(site));
  }, [site]);

  const previewHtml = useMemo(() => renderSiteHtml(site, ensName), [site, ensName]);

  if (!identity) {
    return (
      <div style={{ textAlign: 'center', padding: '64px 0' }}>
        <div style={{ color: 'var(--muted)' }}>You need an identity to publish</div>
        <div style={{ marginTop: 8 }}>
          <a href="/">Onboard from the home page first</a>
        </div>
      </div>
    );
  }

  async function publish() {
    if (!identity) return;
    const p: Pipeline = initialPipeline();
    const advance = (idx: number, status: StepStatus, detail?: string) => {
      setPipeline((prev) => {
        const base = prev ? { ...prev, steps: [...prev.steps] } : { steps: [...p.steps] };
        base.steps[idx] = { ...base.steps[idx], status, detail };
        return base;
      });
    };

    setPipeline(p);
    try {
      // 1. Bundle
      advance(0, 'active');
      const html = renderSiteHtml(site, ensName);
      advance(0, 'done');

      // 2. Upload
      advance(1, 'active');
      const { cid } = await pinSite(html);
      advance(1, 'done');

      // 3. Receive (cosmetic — happens with step 2)
      advance(2, 'active');
      advance(2, 'done', cid);

      // 4. Encode
      advance(3, 'active');
      const contenthash = await encodeIpfsContenthash(cid);
      advance(3, 'done');

      // 5. Update gateway record
      advance(4, 'active');
      const message = `I am updating contenthash for ${identity.label}.geocities.eth to ${contenthash}`;
      await updateContenthash({
        label: identity.label,
        address: identity.address,
        contenthash,
        signature: ZERO_SIG, // v1 dev placeholder; production: EIP-1271 via passkey
        message,
      });
      advance(4, 'done');

      setPipeline((prev) => (prev ? { ...prev, cid } : prev));
    } catch (err: any) {
      setPipeline((prev) => {
        if (!prev) return prev;
        const idx = prev.steps.findIndex((s) => s.status === 'active');
        const next = { ...prev, steps: [...prev.steps], error: err.message || String(err) };
        if (idx >= 0) next.steps[idx] = { ...next.steps[idx], status: 'error' };
        return next;
      });
    }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
      <section
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          padding: 20,
        }}
      >
        <h2 style={{ marginTop: 0 }}>Edit</h2>
        <div style={{ marginBottom: 12 }}>
          <div style={fieldLabelStyle}>Title</div>
          <input
            value={site.title}
            onChange={(e) => setSite({ ...site, title: e.target.value })}
            style={inputStyle}
          />
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={fieldLabelStyle}>Bio</div>
          <textarea
            value={site.bio}
            onChange={(e) => setSite({ ...site, bio: e.target.value })}
            rows={6}
            style={{ ...inputStyle, resize: 'vertical' }}
          />
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={fieldLabelStyle}>Theme</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {(Object.keys(THEMES) as ThemeKey[]).map((k) => {
              const sel = site.theme === k;
              const t = THEMES[k];
              return (
                <button
                  key={k}
                  onClick={() => setSite({ ...site, theme: k })}
                  style={{
                    flex: 1,
                    padding: '10px 12px',
                    background: sel ? t.bg : 'var(--surface)',
                    color: sel ? t.fg : 'var(--text)',
                    border: '2px solid',
                    borderColor: sel ? t.accent : 'var(--border)',
                    borderRadius: 'var(--radius)',
                    fontFamily: 'var(--font-mono)',
                    textTransform: 'lowercase',
                  }}
                >
                  {k}
                </button>
              );
            })}
          </div>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
          <input
            type="checkbox"
            checked={site.guestbook}
            onChange={(e) => setSite({ ...site, guestbook: e.target.checked })}
          />
          Guestbook
        </label>

        <button
          onClick={publish}
          style={{
            width: '100%',
            marginTop: 18,
            padding: '12px 16px',
            background: 'var(--accent)',
            color: 'white',
            border: 'none',
            borderRadius: 'var(--radius)',
            fontWeight: 600,
          }}
        >
          Publish to IPFS
        </button>

        {pipeline && (
          <div
            style={{
              marginTop: 18,
              padding: 14,
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              fontFamily: 'var(--font-mono)',
              fontSize: 13,
            }}
          >
            {pipeline.steps.map((s, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}>
                <span style={{ width: 16, color: glyphColor(s.status) }}>{glyph(s.status)}</span>
                <span style={{ color: s.status === 'pending' ? 'var(--muted)' : 'var(--text)' }}>{s.label}</span>
                {s.detail && (
                  <span style={{ marginLeft: 'auto', color: 'var(--muted)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>
                    {s.detail}
                  </span>
                )}
              </div>
            ))}
            {pipeline.error && (
              <div style={{ marginTop: 8, color: 'var(--danger)' }}>{pipeline.error}</div>
            )}
            {pipeline.cid && !pipeline.error && (
              <div
                style={{
                  marginTop: 12,
                  padding: 12,
                  background: 'var(--success-bg)',
                  color: 'var(--success)',
                  borderRadius: 'var(--radius)',
                }}
              >
                <div>✓ Live at {ensName}</div>
                <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text)', wordBreak: 'break-all' }}>
                  {pipeline.cid}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      <section
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          padding: 20,
        }}
      >
        <h2 style={{ marginTop: 0 }}>Preview</h2>
        <Preview site={site} ensName={ensName} />
        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--muted)' }}>raw HTML</summary>
          <pre
            style={{
              fontSize: 11,
              background: 'var(--bg)',
              padding: 10,
              borderRadius: 'var(--radius)',
              overflow: 'auto',
              maxHeight: 240,
            }}
          >{previewHtml}</pre>
        </details>
      </section>
    </div>
  );
}

function Preview({ site, ensName }: { site: Site; ensName: string | null }) {
  const t = THEMES[site.theme];
  const meta = site.guestbook ? 'guestbook · webring · 1,247 visits' : 'webring · 1,247 visits';
  return (
    <div
      style={{
        background: t.bg,
        color: t.fg,
        padding: 24,
        borderRadius: 'var(--radius)',
        fontFamily: 'var(--font-mono)',
        minHeight: 320,
      }}
    >
      <div style={{ color: t.accent, fontSize: 18, marginBottom: 12 }}>{site.title}</div>
      <div style={{ whiteSpace: 'pre-wrap' }}>{site.bio}</div>
      <hr style={{ border: 'none', borderTop: `1px dashed ${t.fg}`, opacity: 0.4, margin: '24px 0 12px' }} />
      <div style={{ fontSize: 12, opacity: 0.6 }}>{meta}</div>
      <div style={{ fontSize: 12, opacity: 0.5, marginTop: 18 }}>{ensName || ''}</div>
    </div>
  );
}

function glyph(s: StepStatus) {
  switch (s) {
    case 'pending': return '○';
    case 'active': return '●';
    case 'done': return '✓';
    case 'error': return '✗';
  }
}
function glyphColor(s: StepStatus) {
  switch (s) {
    case 'pending': return 'var(--muted)';
    case 'active': return 'var(--accent)';
    case 'done': return 'var(--success)';
    case 'error': return 'var(--danger)';
  }
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  outline: 'none',
};
const fieldLabelStyle: React.CSSProperties = {
  fontSize: 13,
  color: 'var(--muted)',
  marginBottom: 6,
};
