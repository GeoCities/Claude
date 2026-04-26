import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { deriveSmartAccountAddress } from '../lib/smartAccount';

export type Identity = {
  label: string;
  credentialId: string;
  publicKey: `0x${string}`;
  address: `0x${string}`;
};

const STORAGE_KEY = 'geocities.identity.v1';

type Ctx = {
  identity: Identity | null;
  ensName: string | null;
  setIdentity: (id: Identity | null) => void;
};

const IdentityContext = createContext<Ctx | null>(null);

function load(): Identity | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.label || !parsed?.address) return null;
    return parsed as Identity;
  } catch {
    return null;
  }
}

export function IdentityProvider({ children }: { children: ReactNode }) {
  const [identity, setIdentityState] = useState<Identity | null>(() => load());

  const setIdentity = useCallback((next: Identity | null) => {
    setIdentityState(next);
    if (next) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  // Cross-tab sync.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setIdentityState(load());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      identity,
      ensName: identity ? `${identity.label}.geocities.eth` : null,
      setIdentity,
    }),
    [identity, setIdentity],
  );

  return <IdentityContext.Provider value={value}>{children}</IdentityContext.Provider>;
}

export function useIdentity(): Ctx {
  const ctx = useContext(IdentityContext);
  if (!ctx) throw new Error('useIdentity must be used inside <IdentityProvider>');
  return ctx;
}

export function deriveIdentity(
  label: string,
  credentialId: string,
  publicKey: `0x${string}`,
): Identity {
  const address = deriveSmartAccountAddress(publicKey);
  return { label, credentialId, publicKey, address };
}
