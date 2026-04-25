import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Link, NavLink, Route, Routes } from 'react-router-dom';

import { IdentityProvider } from './hooks/useIdentity';
import { Onboarding } from './pages/Onboarding';
import { Browser } from './pages/Browser';
import { Mail } from './pages/Mail';
import { Editor } from './pages/Editor';

function Header() {
  const tabs = [
    { to: '/browser', label: 'browser' },
    { to: '/mail', label: 'mail' },
    { to: '/editor', label: 'editor' },
  ];
  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '14px 0',
        borderBottom: '1px solid var(--border)',
        marginBottom: 24,
      }}
    >
      <Link
        to="/"
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 16,
          color: 'var(--text)',
          fontWeight: 600,
        }}
      >
        geocities.eth
      </Link>
      <nav style={{ display: 'flex', gap: 8 }}>
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            style={({ isActive }) => ({
              padding: '6px 14px',
              borderRadius: 999,
              fontSize: 14,
              color: isActive ? 'var(--accent)' : 'var(--muted)',
              background: isActive ? 'var(--accent-bg)' : 'transparent',
              border: '1px solid',
              borderColor: isActive ? 'transparent' : 'var(--border)',
              textDecoration: 'none',
            })}
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
    </header>
  );
}

function App() {
  return (
    <div style={{ maxWidth: 980, margin: '0 auto', padding: '24px 20px 80px' }}>
      <Header />
      <Routes>
        <Route path="/" element={<Onboarding />} />
        <Route path="/browser" element={<Browser />} />
        <Route path="/browser/:name" element={<Browser />} />
        <Route path="/mail" element={<Mail />} />
        <Route path="/editor" element={<Editor />} />
      </Routes>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <IdentityProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </IdentityProvider>
  </React.StrictMode>,
);
