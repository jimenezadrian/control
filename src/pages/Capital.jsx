import React, { useState } from 'react';
import { supabase } from '../supabase.js';
import { useData } from '../data.jsx';
import { Empty, Field, Modal, MoneyInput, Stat, check, confirmar, parseAmount, useAction } from '../ui.jsx';
import { CAPITAL_TYPES, fmtDate, money, today } from '../utils.js';

function MovementModal({ onClose }) {
  const { reload } = useData();
  const { busy, run } = useAction();
  const [type, setType] = useState(CAPITAL_TYPES[0]);
  const [amount, setAmount] = useState('');
  const [desc, setDesc] = useState('');
  const [date, setDate] = useState(today());
  const [error, setError] = useState('');

  const hints = {
    'Aportación': 'Dinero propio que ponemos para comprar productos.',
    'Recuperación': 'Cuando recuperamos el dinero que pusimos (no es ganancia).',
    'Retiro de utilidad': 'Ganancia que nos llevamos.',
    'Gasto': 'Gastos del negocio (envíos, empaques, etc.).',
  };

  async function save() {
    let a;
    try {
      a = parseAmount(amount, 'el monto');
      if (!date) throw new Error('Elige la fecha.');
    } catch (e) { return setError(e.message); }
    const ok = await run(async () => {
      check(await supabase.from('capital_movements').insert({ movement_type: type, amount: a, description: desc.trim() || null, movement_date: date }));
      await reload();
    }, 'Movimiento guardado');
    if (ok) onClose();
  }

  return (
    <Modal title="Nuevo movimiento" onClose={onClose}>
      {error && <div className="err-box">{error}</div>}
      <Field label="Tipo">
        <select value={type} onChange={(e) => setType(e.target.value)}>{CAPITAL_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
      </Field>
      <div className="help">{hints[type]}</div>
      <Field label="Monto"><MoneyInput value={amount} onChange={setAmount} autoFocus /></Field>
      <Field label="Descripción (opcional)"><input value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
      <Field label="Fecha"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <button className="btn block" onClick={save} disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button>
    </Modal>
  );
}

export default function Capital() {
  const { raw, capital: k, reload } = useData();
  const { run } = useAction();
  const [creating, setCreating] = useState(false);
  const moves = [...raw.capital].sort((a, b) => (a.movement_date + a.created_at < b.movement_date + b.created_at ? 1 : -1));

  async function del(m) {
    if (!confirmar(`¿Eliminar este movimiento (${m.movement_type} de ${money(m.amount)})?`)) return;
    await run(async () => {
      check(await supabase.from('capital_movements').delete().eq('id', m.id));
      await reload();
    }, 'Movimiento eliminado');
  }

  return (
    <>
      <div className="row">
        <h1>Capital</h1>
        <button className="btn" onClick={() => setCreating(true)}>+ Movimiento</button>
      </div>

      <h2 style={{ marginTop: 0 }}>Nuestro dinero</h2>
      <div className="grid">
        <Stat label="Hemos aportado" value={money(k.aportado)} />
        <Stat label="Hemos recuperado" value={money(k.recuperado)} />
        <Stat label="Sigue invertido" value={money(k.invertido)} tone="warn" />
        <Stat label="Pendiente de cobrar" value={money(k.pendiente)} tone="warn" />
      </div>

      <h2>Ganancias</h2>
      <div className="grid">
        <Stat label="Utilidad ganada (ya cobrada)" value={money(k.utilidadGanada)} tone="ok" />
        <Stat label="Hemos retirado" value={money(k.retirado)} />
        <Stat label="Hemos gastado" value={money(k.gastos)} />
        <Stat label="Utilidad disponible" value={money(k.utilidadDisponible)} tone="ok" />
      </div>
      <div className="help" style={{ marginTop: '.8rem' }}>
        Utilidad ganada = de lo que cada cliente ha pagado, lo que pasa del costo ADI de su venta. Utilidad disponible = utilidad ganada − retiros − gastos.
        Utilidad total esperada de todas las ventas: <b>{money(k.utilidadEstimada)}</b>.
      </div>

      <h2>Dinero de tandas</h2>
      <div className="grid">
        <Stat label="Aportaciones recibidas" value={money(k.aportaciones)} />
        <Stat label="Aplicado a pedidos" value={money(k.aplicado)} />
        <Stat label="Devuelto a participantes" value={money(k.devuelto)} />
        <Stat label="En resguardo" value={money(k.resguardo)} tone="warn" />
      </div>
      <div className="help" style={{ marginTop: '.8rem' }}>
        El dinero de las tandas es de los participantes: no es capital propio ni utilidad. Solo se vuelve cobro de una venta cuando la bolsa se aplica a un pedido.
      </div>

      <h2>Movimientos</h2>
      <div className="card">
        {moves.length === 0 && <Empty>Aún no hay movimientos.</Empty>}
        {moves.map((m) => (
          <div key={m.id} className="list-item small">
            <div className="row">
              <div>
                <b>{m.movement_type}</b>
                <div className="muted">{fmtDate(m.movement_date)}{m.description ? ` · ${m.description}` : ''}</div>
              </div>
              <b>{money(m.amount)}</b>
            </div>
            <button className="btn sm danger" style={{ marginTop: 4 }} onClick={() => del(m)}>Eliminar</button>
          </div>
        ))}
      </div>
      {creating && <MovementModal onClose={() => setCreating(false)} />}
    </>
  );
}
