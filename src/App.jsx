import React, { useEffect, useState } from 'react';
import { configOk, supabase } from './supabase.js';
import { DataProvider, useData } from './data.jsx';
import { ToastProvider } from './ui.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Clientes from './pages/Clientes.jsx';
import Ventas from './pages/Ventas.jsx';
import Tandas from './pages/Tandas.jsx';
import Capital from './pages/Capital.jsx';

const PAGES = [
  { id: 'inicio', label: 'Inicio', icon: '🏠' },
  { id: 'ventas', label: 'Ventas', icon: '🛍️' },
  { id: 'clientes', label: 'Clientes', icon: '👥' },
  { id: 'tandas', label: 'Tandas', icon: '🔄' },
  { id: 'capital', label: 'Capital', icon: '💰' },
];

export default function App() {
  const [session, setSession] = useState(undefined);

  useEffect(() => {
    if (!configOk) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!configOk) {
    return (
      <div className="center">
        <div className="card">
          Falta la configuración de Supabase. Crea un archivo <b>.env</b> con VITE_SUPABASE_URL y
          VITE_SUPABASE_PUBLISHABLE_KEY (ver .env.example).
        </div>
      </div>
    );
  }
  if (session === undefined) return <div className="center">Cargando…</div>;

  return (
    <ToastProvider>
      {!session ? (
        <Login />
      ) : (
        <DataProvider>
          <Shell email={session.user.email} />
        </DataProvider>
      )}
    </ToastProvider>
  );
}

function Shell({ email }) {
  const [page, setPage] = useState('inicio');
  const { loading, error, reload } = useData();

  return (
    <div className="shell">
      <div className="topbar">
        <b>Control Vianney</b>
        <button onClick={() => supabase.auth.signOut()} title={email}>Cerrar sesión</button>
      </div>
      <nav className="nav">
        {PAGES.map((p) => (
          <button key={p.id} className={page === p.id ? 'active' : ''} onClick={() => setPage(p.id)}>
            <span className="ic">{p.icon}</span>
            {p.label}
          </button>
        ))}
      </nav>
      <main className="content">
        {error && (
          <div className="err-box">
            {error} <button className="btn sm sec" onClick={reload}>Reintentar</button>
          </div>
        )}
        {loading ? (
          <div className="empty">Cargando datos…</div>
        ) : (
          <>
            {page === 'inicio' && <Dashboard go={setPage} />}
            {page === 'ventas' && <Ventas />}
            {page === 'clientes' && <Clientes />}
            {page === 'tandas' && <Tandas />}
            {page === 'capital' && <Capital />}
          </>
        )}
      </main>
    </div>
  );
}
