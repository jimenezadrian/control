import React, { useState } from 'react';
import { supabase } from '../supabase.js';
import { Field } from '../ui.jsx';
import { friendlyError } from '../utils.js';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (!email.trim() || !password) return setError('Escribe tu correo y tu contraseña.');
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setError(friendlyError(error));
  }

  return (
    <div className="login">
      <h1 style={{ textAlign: 'center', marginBottom: '1rem' }}>Control Vianney y Tandas</h1>
      <form className="card" onSubmit={submit}>
        {error && <div className="err-box">{error}</div>}
        <Field label="Correo">
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Contraseña">
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <button className="btn block" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
      </form>
    </div>
  );
}
