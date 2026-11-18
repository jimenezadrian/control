import React, { useEffect, useRef, useState } from 'react';
import { supabase } from './supabase.js';
import { DEBOUNCE_MS, SEARCH_LIMIT, hasExactName, likePattern } from './search.js';
import { friendlyError } from './utils.js';

// Buscador de clientes con autocompletado.
//   value:    null | { id, name }                    cliente existente
//           | { isNew: true, name, phone }           cliente por registrar junto con la venta
//   onChange: recibe el nuevo value (o null para cambiar la selección)
// Consulta Supabase con búsqueda parcial (ilike) y un máximo de resultados, con debounce.
// El id interno nunca se muestra.
export default function CustomerPicker({ value, onChange }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [active, setActive] = useState(0);
  const box = useRef(null);
  const input = useRef(null);
  const seq = useRef(0); // descarta respuestas viejas si el usuario sigue escribiendo

  // Búsqueda con debounce
  useEffect(() => {
    if (!open) return undefined;
    const mine = ++seq.current;
    setLoading(true);
    const t = setTimeout(async () => {
      let q = supabase.from('customers').select('id, name, phone').order('name', { ascending: true }).limit(SEARCH_LIMIT);
      if (query.trim()) q = q.ilike('name', likePattern(query));
      const { data, error: err } = await q;
      if (mine !== seq.current) return;
      setLoading(false);
      if (err) { setError(friendlyError(err)); setResults([]); return; }
      setError('');
      setResults(data || []);
      setActive(0);
    }, query ? DEBOUNCE_MS : 0);
    return () => clearTimeout(t);
  }, [query, open]);

  // Cerrar al tocar fuera
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const trimmed = query.trim();
  const canCreate = trimmed.length > 0 && !hasExactName(results, trimmed);
  // Opciones navegables con teclado: resultados + (si aplica) "registrar nuevo"
  const options = [...results.map((c) => ({ type: 'c', c })), ...(canCreate ? [{ type: 'new' }] : [])];

  function pick(opt) {
    if (opt.type === 'c') onChange({ id: opt.c.id, name: opt.c.name });
    else onChange({ isNew: true, name: trimmed, phone: '' });
    setOpen(false);
    setQuery('');
  }
  function onKey(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, options.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter' && open && options[active]) { e.preventDefault(); pick(options[active]); }
    else if (e.key === 'Escape') setOpen(false);
  }

  // ----- Ya hay un cliente elegido
  if (value) {
    return (
      <div className="field">
        <span>Cliente</span>
        <div className="picker-selected">
          <div style={{ minWidth: 0 }}>
            <b>{value.name}</b>
            {value.isNew && <span className="badge" style={{ marginLeft: '.5rem' }}>Nuevo</span>}
          </div>
          <button type="button" className="btn sm sec" onClick={() => { onChange(null); setTimeout(() => input.current?.focus(), 0); }}>Cambiar</button>
        </div>
        {value.isNew && (
          <div style={{ marginTop: '.6rem' }}>
            <label className="field" style={{ marginBottom: 0 }}>
              <span>Nombre</span>
              <input value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} />
            </label>
            <label className="field" style={{ margin: '.6rem 0 0' }}>
              <span>Teléfono (opcional)</span>
              <input type="tel" value={value.phone || ''} onChange={(e) => onChange({ ...value, phone: e.target.value })} />
            </label>
            <div className="muted small" style={{ marginTop: '.4rem' }}>Se registrará como cliente al guardar la venta.</div>
          </div>
        )}
      </div>
    );
  }

  // ----- Buscador
  return (
    <div className="field picker" ref={box}>
      <span>Cliente</span>
      <input
        ref={input}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        autoComplete="off"
        placeholder="Escribe para buscar un cliente…"
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onKeyDown={onKey}
      />
      {open && (
        <div className="picker-list" role="listbox">
          {loading && results.length === 0 && <div className="picker-msg">Buscando…</div>}
          {error && <div className="picker-msg" style={{ color: 'var(--danger)' }}>{error}</div>}
          {!loading && !error && results.length === 0 && (
            <div className="picker-msg">{trimmed ? `No hay clientes que coincidan con “${trimmed}”.` : 'Todavía no hay clientes registrados.'}</div>
          )}
          {results.map((c, i) => (
            <button
              type="button" role="option" aria-selected={i === active} key={c.id}
              className={`picker-opt${i === active ? ' active' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick({ type: 'c', c })}
            >
              <span>{c.name}</span>
              {c.phone && <span className="muted small">{c.phone}</span>}
            </button>
          ))}
          {canCreate && (
            <button
              type="button" role="option" aria-selected={active === results.length}
              className={`picker-opt new${active === results.length ? ' active' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick({ type: 'new' })}
            >
              + Registrar “{trimmed}” como cliente nuevo
            </button>
          )}
          {!trimmed && results.length >= SEARCH_LIMIT && <div className="picker-msg">Escribe para buscar entre todos los clientes.</div>}
        </div>
      )}
    </div>
  );
}
