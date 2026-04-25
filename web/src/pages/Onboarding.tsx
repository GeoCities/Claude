import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createPasskey } from '../lib/passkey';
import { checkLabelAvailable, registerSubdomain } from '../lib/gateway';
import { deriveIdentity, useIdentity } from '../hooks/useIdentity';

type Step = 'label' | 'passkey' | 'registering' | 'done';
const STEPS: Step[] = ['label', 'passkey', 'registering', 'done'];

const LABEL_RE = /^[a-z0-9-]{3,32}$/;
const ZERO_SIG = ('0x' + '00'.repeat(65)) as `0x${string}`;

function Stepper({ current }: { current: Step }) {
  const idx = STEPS.indexOf(current);
  return (
    <div style={{ display: 'flex', gap: 6, marginBottom: 24 }}>
      {STEPS.map((_, i) => (
        <div
          key={i}
          style={{
            flex: 1,
            height: 4,
            borderRadius: 2,
            background: i <= idx ? 'var(--accent)' : 'var(--border)',
            transition: 'background 200ms',
          }}
        />
      ))}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        maxWidth: 540,
        margin: '24px auto',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: 28,
        boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
      }}
    >
      {children}
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 6 }}>{children}</div>;
}

function MonoValue({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 13,
        background: 'var(--bg)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        padding: '10px 12px',
        wordBreak: 'break-all',
      }}
    >
      {children}
    </div>
  );
}

function Footer() {
  return (
    <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--muted)', marginTop: 24 }}>
      Free subdomains are made possible by ENS CCIP-Read.
    </div>
  );
}

export function Onboarding() {
  const { identity, ensName, setIdentity } = useIdentity();
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>('label');
  const [label, setLabel] = useState('');
  const [availability, setAvailability] = useState<null | 'checking' | 'available' | 'taken' | 'invalid'>(null);
  const [error, setError] = useState<string | null>(null);

  // Debounced availability check.
  useEffect(() => {
    if (!label) { setAvailability(null); return; }
    if (!LABEL_RE.test(label)) { setAvailability('invalid'); return; }
    setAvailability('checking');
    const t = setTimeout(async () => {
      try {
        const ok = await checkLabelAvailable(label);
        setAvailability(ok ? 'available' : 'taken');
      } catch {
        setAvailability('available');
      }
    }, 300);
    return () => clearTimeout(t);
  }, [label]);

  const canProceed = useMemo(() => availability === 'available' && LABEL_RE.test(label), [availability, label]);

  if (identity && step === 'label') {
    // Already onboarded view.
    return (
      <Card>
        <h1 style={{ margin: 0, fontSize: 22 }}>Welcome back, {ensName}</h1>
        <p style={{ color: 'var(--muted)', marginTop: 6 }}>
          Your passkey is on this device. Your smart account is below.
        </p>
        <div style={{ marginTop: 18 }}>
          <FieldLabel>ENS name</FieldLabel>
          <MonoValue>{ensName}</MonoValue>
        </div>
        <div style={{ marginTop: 12 }}>
          <FieldLabel>Smart account</FieldLabel>
          <MonoValue>{identity.address}</MonoValue>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
          <Link
            to="/browser"
            style={{
              flex: 1,
              textAlign: 'center',
              padding: '10px 14px',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              color: 'var(--text)',
              textDecoration: 'none',
            }}
          >
            Browse
          </Link>
          <Link
            to="/editor"
            style={{
              flex: 1,
              textAlign: 'center',
              padding: '10px 14px',
              background: 'var(--accent)',
              borderRadius: 'var(--radius)',
              color: 'white',
              textDecoration: 'none',
            }}
          >
            Edit site
          </Link>
          <button
            onClick={() => { setIdentity(null); setStep('label'); setLabel(''); }}
            style={{
              padding: '10px 14px',
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              color: 'var(--muted)',
            }}
          >
            Sign out
          </button>
        </div>
        <Footer />
      </Card>
    );
  }

  async function onContinueLabel() {
    setError(null);
    setStep('passkey');
    try {
      const passkey = await createPasskey(label);
      setStep('registering');
      const id = deriveIdentity(label, passkey.credentialId, passkey.publicKey);
      const message = `I am claiming ${label}.geocities.eth for ${id.address}`;
      try {
        await registerSubdomain({
          label,
          address: id.address,
          signature: ZERO_SIG, // v1 dev: gateway accepts; production needs EIP-1271
          message,
        });
      } catch (err: any) {
        // Don't block local identity if the gateway is down — explore mode.
        console.warn('gateway register failed:', err.message);
      }
      setIdentity(id);
      setStep('done');
    } catch (err: any) {
      setError(err.message || String(err));
      setStep('label');
    }
  }

  return (
    <Card>
      <Stepper current={step} />
      <h1 style={{ margin: 0, fontSize: 22 }}>Claim your geocities.eth</h1>
      <p style={{ color: 'var(--muted)', marginTop: 6, marginBottom: 18 }}>
        One subdomain. Wallet, browser, mail, and a publishable site.
      </p>

      {step === 'label' && (
        <>
          <FieldLabel>Pick a label</FieldLabel>
          <div style={{ display: 'flex', alignItems: 'stretch' }}>
            <input
              autoFocus
              value={label}
              onChange={(e) => setLabel(e.target.value.toLowerCase().trim())}
              placeholder="alice"
              style={{
                flex: 1,
                padding: '10px 12px',
                fontFamily: 'var(--font-mono)',
                fontSize: 15,
                border: '1px solid var(--border)',
                borderRight: 'none',
                borderTopLeftRadius: 'var(--radius)',
                borderBottomLeftRadius: 'var(--radius)',
                outline: 'none',
              }}
            />
            <div
              style={{
                padding: '10px 12px',
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                borderTopRightRadius: 'var(--radius)',
                borderBottomRightRadius: 'var(--radius)',
                color: 'var(--muted)',
                fontFamily: 'var(--font-mono)',
                fontSize: 14,
                display: 'flex',
                alignItems: 'center',
              }}
            >
              .geocities.eth
            </div>
          </div>
          <div style={{ minHeight: 24, marginTop: 8, fontSize: 13 }}>
            {availability === 'checking' && <span style={{ color: 'var(--muted)' }}>Checking…</span>}
            {availability === 'available' && <span style={{ color: 'var(--success)' }}>✓ Available</span>}
            {availability === 'taken' && <span style={{ color: 'var(--danger)' }}>Taken</span>}
            {availability === 'invalid' && (
              <span style={{ color: 'var(--danger)' }}>3–32 chars, lowercase letters / digits / hyphens</span>
            )}
          </div>
          {error && (
            <div style={{ color: 'var(--danger)', fontSize: 13, marginTop: 8 }}>{error}</div>
          )}
          <button
            disabled={!canProceed}
            onClick={onContinueLabel}
            style={{
              width: '100%',
              marginTop: 16,
              padding: '12px 14px',
              background: canProceed ? 'var(--accent)' : 'var(--border)',
              color: 'white',
              border: 'none',
              borderRadius: 'var(--radius)',
              fontWeight: 600,
            }}
          >
            Continue →
          </button>
        </>
      )}

      {step === 'passkey' && (
        <div style={{ textAlign: 'center', padding: '24px 0' }}>
          <div style={{ fontSize: 48 }}>🔒</div>
          <div style={{ marginTop: 12, fontSize: 16 }}>Authorize with your device</div>
          <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 6 }}>
            Use Face ID, Touch ID, Windows Hello, or your security key.
          </div>
        </div>
      )}

      {step === 'registering' && (
        <div style={{ textAlign: 'center', padding: '24px 0' }}>
          <div className="spin" style={{ fontSize: 32, animation: 'spin 1s linear infinite' }}>◌</div>
          <div style={{ marginTop: 12 }}>Registering {label}.geocities.eth…</div>
          <style>{`@keyframes spin { from{transform:rotate(0)} to{transform:rotate(360deg)} }`}</style>
        </div>
      )}

      {step === 'done' && identity && (
        <>
          <div style={{ textAlign: 'center', color: 'var(--success)', fontSize: 28 }}>✓</div>
          <h2 style={{ margin: '8px 0 18px', textAlign: 'center', fontSize: 18 }}>
            {ensName} is yours
          </h2>
          <FieldLabel>ENS name</FieldLabel>
          <MonoValue>{ensName}</MonoValue>
          <div style={{ marginTop: 12 }}>
            <FieldLabel>Smart account</FieldLabel>
            <MonoValue>{identity.address}</MonoValue>
          </div>
          <button
            onClick={() => navigate('/editor')}
            style={{
              width: '100%',
              marginTop: 18,
              padding: '12px 14px',
              background: 'var(--accent)',
              color: 'white',
              border: 'none',
              borderRadius: 'var(--radius)',
              fontWeight: 600,
            }}
          >
            Build your site →
          </button>
        </>
      )}

      <Footer />
    </Card>
  );
}
