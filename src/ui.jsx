import React, { createContext, useCallback, useContext, useState } from 'react';
import { friendlyError } from './utils.js';

// ---------- Avisos (toast) ----------
const ToastCtx = createContext(null);
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  const [t, setT] = useState(null);
  const show = useCallback((kind, text) => {
    setT({ kind, text });
    setTimeout(() => setT(null), kind === 'err' ? 5000 : 2500);
  }, []);
  const api = {
    ok: (m) => show('ok', m),
    err: (e) => show('err', friendlyError(e)),
  };
  return (
    <ToastCtx.Provider value={api}>
      {children}
      {t && <div className={`toast ${t.kind}`} role="status">{t.text}</div>}
    </ToastCtx.Provider>
  );
}

// ---------- Ventana emergente ----------
export function Modal({ title, onClose, children }) {
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true">
        <div className="modal-head">
          <h1 style={{ margin: 0 }}>{title}</h1>
          <button onClick={onClose} aria-label="Cerrar">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function MoneyInput({ value, onChange, ...rest }) {
  return (
    <input
      type="number"
      inputMode="decimal"
      step="0.01"
      min="0"
      placeholder="0.00"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      {...rest}
    />
  );
}

export function Stat({ label, value, tone }) {
  return (
    <div className={`stat ${tone || ''}`}>
      <div className="l">{label}</div>
      <div className="v">{value}</div>
    </div>
  );
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>;
}

export function confirmar(texto) {
  return window.confirm(texto);
}

// Ejecuta una acción async mostrando errores comprensibles.
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async (fn, okMsg) => {
    setBusy(true);
    try {
      const res = await fn();
      if (okMsg) toast.ok(okMsg);
      return res === undefined ? true : res;
    } catch (e) {
      console.error(e);
      toast.err(e);
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

// Lanza el error de Supabase si lo hay
export function check({ data, error }) {
  if (error) throw error;
  return data;
}

// Valida un monto capturado; devuelve número o lanza un Error con mensaje claro
export function parseAmount(v, nombre, { allowZero = false } = {}) {
  const n = Number(v);
  if (v === '' || Number.isNaN(n)) throw new Error(`Escribe ${nombre}.`);
  if (n < 0) throw new Error(`${nombre[0].toUpperCase() + nombre.slice(1)} no puede ser negativo.`);
  if (!allowZero && n === 0) throw new Error(`${nombre[0].toUpperCase() + nombre.slice(1)} debe ser mayor a cero.`);
  return Math.round(n * 100) / 100;
}
