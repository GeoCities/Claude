import { useEffect, useMemo, useState } from 'react';
import { useIdentity } from '../hooks/useIdentity';

// ----------------------------------------------------------------------------
// XMTP integration point.
//
// v1 is intentionally localStorage-backed so the UI shape is testable without
// an XMTP signer ceremony. The integration point is the `setMessages` calls in
// this component — wherever we mutate or seed messages, production should
// instead consume `client.conversations.list()` and live message streams from
// `@xmtp/browser-sdk`.
//
// Production wire-up sketch:
//   1. On identity load, derive a session signer from the smart account
//      (XMTP needs a one-time approval signature; can be passkey-backed via the
//      smart account + an EIP-1271 isValidSignature path).
//   2. `const xmtp = await Client.create(signer, { env: 'production' });`
//   3. `for await (const convo of xmtp.conversations.stream()) { ... }`
//   4. Map XMTP conversations onto the Message type below; drop localStorage.
//
// SMTP-bridged messages are surfaced separately and labelled "plaintext on the
// wire" — those would be relayed by a Postfix → XMTP bridge, not native XMTP.
// ----------------------------------------------------------------------------

type Message = {
  id: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  ts: number;
  bridge?: 'smtp';
  attachedValue?: string; // e.g. "0.05 ETH"
  outbound?: boolean;
};

const STORAGE_KEY = 'geocities.mail.v1';

const SEEDS: Message[] = [
  {
    id: 'seed-1',
    from: 'bob.geocities.eth',
    to: 'me',
    subject: 'webring rotation this Thursday',
    body:
      'hey,\n\nrotating the webring on Thursday — 12 sites this round, you slot in between mira.geocities.eth and pixel.geocities.eth.\n\nlmk if you want to skip a cycle.\n\n— bob',
    ts: Date.now() - 1000 * 60 * 60 * 6,
  },
  {
    id: 'seed-2',
    from: 'carol.geocities.eth',
    to: 'me',
    subject: 'split for the dinner thing',
    body:
      "five-way split came to 0.05 ETH each. Tap the chip to claim with your passkey — it'll route from my smart account to yours, no gas on your end thanks to the paymaster.\n\nThanks for organizing!",
    ts: Date.now() - 1000 * 60 * 60 * 24,
    attachedValue: '0.05 ETH',
  },
  {
    id: 'seed-3',
    from: 'shipment-tracking@amazon.com',
    to: 'me',
    subject: 'Your order has shipped',
    body:
      "Hi — your order #114-2381923-3098213 has shipped and is expected to arrive tomorrow.\n\nTrack at: https://amazon.com/track/...\n\nThis email was relayed via the geocities SMTP bridge (plaintext on the wire — sender is not a geocities user).",
    ts: Date.now() - 1000 * 60 * 60 * 48,
    bridge: 'smtp',
  },
];

function load(): Message[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return SEEDS;
    return JSON.parse(raw);
  } catch {
    return SEEDS;
  }
}

function save(messages: Message[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
}

function Badge({ message }: { message: Message }) {
  if (message.bridge === 'smtp') {
    return <Pill color="warning">● SMTP</Pill>;
  }
  if (message.attachedValue) {
    return <Pill color="success">● E2E + {message.attachedValue}</Pill>;
  }
  return <Pill color="success">● E2E</Pill>;
}

function Pill({ color, children }: { color: 'success' | 'warning'; children: React.ReactNode }) {
  const palette =
    color === 'success'
      ? { bg: 'var(--success-bg)', fg: 'var(--success)' }
      : { bg: '#fef3c7', fg: 'var(--warning)' };
  return (
    <span
      style={{
        fontSize: 11,
        padding: '2px 8px',
        borderRadius: 999,
        background: palette.bg,
        color: palette.fg,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

export function Mail() {
  const { identity, ensName } = useIdentity();
  const [messages, setMessages] = useState<Message[]>(() => load());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState({ to: '', subject: '', body: '' });

  useEffect(() => save(messages), [messages]);
  useEffect(() => { if (!selectedId && messages.length) setSelectedId(messages[0].id); }, [messages, selectedId]);

  const sorted = useMemo(() => [...messages].sort((a, b) => b.ts - a.ts), [messages]);
  const selected = useMemo(() => messages.find((m) => m.id === selectedId) || null, [messages, selectedId]);
  const isE2EToRecipient = draft.to.endsWith('.geocities.eth');

  if (!identity) {
    return (
      <div style={{ textAlign: 'center', padding: '64px 0', color: 'var(--muted)' }}>
        Sign in to read mail.
      </div>
    );
  }

  function send() {
    if (!draft.to || !draft.subject) return;
    const msg: Message = {
      id: `out-${Date.now()}`,
      from: ensName || 'me',
      to: draft.to,
      subject: draft.subject,
      body: draft.body,
      ts: Date.now(),
      outbound: true,
      bridge: isE2EToRecipient ? undefined : 'smtp',
    };
    setMessages((prev) => [msg, ...prev]);
    setDraft({ to: '', subject: '', body: '' });
    setComposing(false);
    setSelectedId(msg.id);
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 16, minHeight: '70vh' }}>
      <aside
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: 12,
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <div style={{ fontSize: 13, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)', fontSize: 13 }}>{ensName}</div>
          </div>
          <button
            onClick={() => { setComposing(true); setSelectedId(null); }}
            style={{
              padding: '6px 12px',
              background: 'var(--accent)',
              color: 'white',
              border: 'none',
              borderRadius: 'var(--radius)',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            Compose
          </button>
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {sorted.map((m) => {
            const senderLabel = m.outbound ? `→ ${m.to}` : m.from;
            const isSel = m.id === selectedId;
            return (
              <button
                key={m.id}
                onClick={() => { setSelectedId(m.id); setComposing(false); }}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: 12,
                  borderBottom: '1px solid var(--border)',
                  background: isSel ? 'var(--accent-bg)' : 'transparent',
                  border: 'none',
                  display: 'block',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 8,
                    alignItems: 'center',
                  }}
                >
                  <div
                    style={{
                      fontSize: 13,
                      fontFamily: 'var(--font-mono)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      flex: 1,
                    }}
                  >
                    {senderLabel}
                  </div>
                  <Badge message={m} />
                </div>
                <div style={{ marginTop: 4, fontSize: 13, fontWeight: 500 }}>{m.subject}</div>
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--muted)',
                    marginTop: 2,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {m.body.split('\n')[0]}
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      <main
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          padding: 24,
          overflowY: 'auto',
        }}
      >
        {composing ? (
          <div>
            <h2 style={{ marginTop: 0 }}>New message</h2>
            <input
              placeholder="to: alice.geocities.eth or you@example.com"
              value={draft.to}
              onChange={(e) => setDraft({ ...draft, to: e.target.value })}
              style={inputStyle}
            />
            <input
              placeholder="subject"
              value={draft.subject}
              onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
              style={inputStyle}
            />
            <textarea
              placeholder="message"
              value={draft.body}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              rows={10}
              style={{ ...inputStyle, fontFamily: 'inherit', resize: 'vertical' }}
            />
            <div style={{ marginTop: 8, fontSize: 12 }}>
              {isE2EToRecipient ? (
                <span style={{ color: 'var(--success)' }}>● Will be E2E encrypted</span>
              ) : (
                <span style={{ color: 'var(--warning)' }}>● SMTP bridge — plaintext on the wire</span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button
                onClick={send}
                style={{
                  padding: '10px 16px',
                  background: 'var(--accent)',
                  color: 'white',
                  border: 'none',
                  borderRadius: 'var(--radius)',
                  fontWeight: 600,
                }}
              >
                Send
              </button>
              <button
                onClick={() => { setComposing(false); setDraft({ to: '', subject: '', body: '' }); }}
                style={{
                  padding: '10px 16px',
                  background: 'transparent',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  color: 'var(--muted)',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : selected ? (
          <div>
            <h2 style={{ marginTop: 0 }}>{selected.subject}</h2>
            <div
              style={{
                fontSize: 13,
                color: 'var(--muted)',
                marginBottom: 14,
              }}
            >
              From <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>{selected.from}</span>
            </div>
            {selected.attachedValue && (
              <div
                style={{
                  background: 'var(--accent-bg)',
                  color: 'var(--accent)',
                  padding: '10px 14px',
                  borderRadius: 'var(--radius)',
                  marginBottom: 14,
                  fontSize: 13,
                }}
              >
                {selected.attachedValue} attached — Tap to claim with your passkey
              </div>
            )}
            <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{selected.body}</div>
          </div>
        ) : (
          <div style={{ color: 'var(--muted)' }}>Select a message.</div>
        )}
      </main>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  marginBottom: 8,
  outline: 'none',
};
