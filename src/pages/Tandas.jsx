import React, { useState } from 'react';
import { supabase } from '../supabase.js';
import { useData } from '../data.jsx';
import { Empty, Field, Modal, MoneyInput, check, confirmar, parseAmount, useAction } from '../ui.jsx';
import { fmtDate, money, r2, today } from '../utils.js';

const FREQS = ['Semanal', 'Quincenal', 'Mensual'];
const isActive = (g) => String(g.status || '').toLowerCase().startsWith('activ');

// ---------- Crear tanda ----------
function NewGroupModal({ onClose }) {
  const { reload } = useData();
  const { busy, run } = useAction();
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [freq, setFreq] = useState('Semanal');
  const [periods, setPeriods] = useState('');
  const [start, setStart] = useState(today());
  const [error, setError] = useState('');

  async function save() {
    setError('');
    let a, p;
    try {
      if (!name.trim()) throw new Error('Escribe el nombre de la tanda.');
      a = parseAmount(amount, 'el importe de la aportación');
      p = Math.round(Number(periods));
      if (!p || p < 1) throw new Error('Escribe el número de periodos (por ejemplo 10).');
      if (!start) throw new Error('Elige la fecha de inicio.');
    } catch (e) { return setError(e.message); }
    const ok = await run(async () => {
      check(await supabase.from('savings_groups').insert({
        name: name.trim(), contribution_amount: a, frequency: freq, periods: p, start_date: start, status: 'Activa',
      }));
      await reload();
    }, 'Tanda creada');
    if (ok) onClose();
  }

  return (
    <Modal title="Nueva tanda" onClose={onClose}>
      {error && <div className="err-box">{error}</div>}
      <Field label="Nombre"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Tanda Noviembre" autoFocus /></Field>
      <div className="two">
        <Field label="Aportación"><MoneyInput value={amount} onChange={setAmount} /></Field>
        <Field label="Frecuencia">
          <select value={freq} onChange={(e) => setFreq(e.target.value)}>{FREQS.map((f) => <option key={f}>{f}</option>)}</select>
        </Field>
      </div>
      <div className="two">
        <Field label="Número de periodos"><input type="number" inputMode="numeric" min="1" value={periods} onChange={(e) => setPeriods(e.target.value)} /></Field>
        <Field label="Fecha de inicio"><input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
      </div>
      <button className="btn block" onClick={save} disabled={busy}>{busy ? 'Guardando…' : 'Crear tanda'}</button>
    </Modal>
  );
}

// ---------- Agregar participante ----------
function NewParticipantModal({ group, nextTurn, onClose }) {
  const { reload } = useData();
  const { busy, run } = useAction();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [turn, setTurn] = useState(String(nextTurn));
  const [error, setError] = useState('');

  async function save() {
    const t = Math.round(Number(turn));
    if (!name.trim()) return setError('Escribe el nombre del participante.');
    if (!t || t < 1) return setError('El turno debe ser un número desde 1.');
    const ok = await run(async () => {
      check(await supabase.from('participants').insert({ group_id: group.id, name: name.trim(), phone: phone.trim() || null, turn_number: t }));
      await reload();
    }, 'Participante agregado');
    if (ok) onClose();
  }

  return (
    <Modal title="Agregar participante" onClose={onClose}>
      {error && <div className="err-box">{error}</div>}
      <Field label="Nombre"><input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
      <div className="two">
        <Field label="Teléfono (opcional)"><input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        <Field label="Turno"><input type="number" inputMode="numeric" min="1" value={turn} onChange={(e) => setTurn(e.target.value)} /></Field>
      </div>
      <button className="btn block" onClick={save} disabled={busy}>{busy ? 'Guardando…' : 'Agregar'}</button>
    </Modal>
  );
}

// ---------- Registrar aportación ----------
function ContributionModal({ group, p, onClose }) {
  const { reload } = useData();
  const { busy, run } = useAction();
  const [amount, setAmount] = useState(String(group.contribution_amount ?? ''));
  const [date, setDate] = useState(today());
  const [label, setLabel] = useState(`${p.contribs.length + 1}`);
  const [error, setError] = useState('');

  async function save() {
    let a;
    try {
      a = parseAmount(amount, 'el monto de la aportación');
      if (!date) throw new Error('Elige la fecha.');
    } catch (e) { return setError(e.message); }
    const ok = await run(async () => {
      check(await supabase.from('contributions').insert({
        participant_id: p.id, amount: a, contribution_date: date,
        period_label: label.trim() ? `${group.frequency === 'Semanal' ? 'Semana' : 'Periodo'} ${label.trim()}` : null,
      }));
      await reload();
    }, 'Aportación registrada');
    if (ok) onClose();
  }

  return (
    <Modal title={`Aportación de ${p.name}`} onClose={onClose}>
      {error && <div className="err-box">{error}</div>}
      <p className="muted" style={{ marginTop: 0 }}>Lleva aportado {money(p.contributed)} · Saldo {money(p.saldo)}</p>
      <Field label="Monto"><MoneyInput value={amount} onChange={setAmount} autoFocus /></Field>
      <div className="two">
        <Field label="Fecha"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Número de periodo"><input value={label} onChange={(e) => setLabel(e.target.value)} /></Field>
      </div>
      <button className="btn block" onClick={save} disabled={busy}>{busy ? 'Guardando…' : 'Guardar aportación'}</button>
    </Modal>
  );
}

// ---------- Compra con saldo de tanda ----------
function PurchaseModal({ p, onClose }) {
  const { reload } = useData();
  const { busy, run } = useAction();
  const [desc, setDesc] = useState('');
  const [total, setTotal] = useState('');
  const [used, setUsed] = useState('');
  const [date, setDate] = useState(today());
  const [error, setError] = useState('');

  const totalN = Number(total) || 0;
  // Si el usuario no escribe cuánto saldo usar, se propone el máximo posible.
  const usedN = used === '' ? Math.min(p.saldo, totalN) : Number(used) || 0;
  const extra = r2(totalN - usedN);

  async function save() {
    setError('');
    let t, u;
    try {
      if (!desc.trim()) throw new Error('Escribe qué compró.');
      t = parseAmount(total, 'el total de la compra');
      u = parseAmount(used === '' ? String(Math.min(p.saldo, t)) : used, 'el saldo a usar', { allowZero: true });
      if (u > p.saldo + 0.005) throw new Error(`Solo tiene ${money(p.saldo)} de saldo disponible.`);
      if (u > t + 0.005) throw new Error('El saldo usado no puede ser mayor al total de la compra.');
      if (!date) throw new Error('Elige la fecha.');
    } catch (e) { return setError(e.message); }
    const ok = await run(async () => {
      check(await supabase.from('participant_purchases').insert({
        participant_id: p.id, description: desc.trim(), balance_used: u, extra_paid: r2(t - u), purchase_date: date,
      }));
      await reload();
    }, 'Compra registrada');
    if (ok) onClose();
  }

  return (
    <Modal title={`Compra de ${p.name}`} onClose={onClose}>
      {error && <div className="err-box">{error}</div>}
      <div className="help">Saldo disponible: <b>{money(p.saldo)}</b></div>
      <Field label="¿Qué compró?"><input value={desc} onChange={(e) => setDesc(e.target.value)} autoFocus /></Field>
      <Field label="Total de la compra"><MoneyInput value={total} onChange={setTotal} /></Field>
      <Field label="Saldo de tanda a usar (déjalo vacío para usar el máximo)">
        <MoneyInput value={used} onChange={setUsed} placeholder={String(Math.min(p.saldo, totalN) || 0)} />
      </Field>
      <Field label="Fecha"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      {totalN > 0 && (
        <div className="help">
          Usa del saldo: <b>{money(usedN)}</b> · Paga aparte: <b>{money(Math.max(0, extra))}</b> · Le queda de saldo: <b>{money(p.saldo - usedN)}</b>
        </div>
      )}
      <button className="btn block" onClick={save} disabled={busy}>{busy ? 'Guardando…' : 'Registrar compra'}</button>
    </Modal>
  );
}

// ---------- Historial ----------
function HistoryModal({ p, onClose }) {
  const { reload } = useData();
  const { run } = useAction();
  const items = [
    ...p.contribs.map((c) => ({ kind: 'c', id: c.id, date: c.contribution_date, at: c.created_at, text: `Aportación${c.period_label ? ` · ${c.period_label}` : ''}`, amount: c.amount, sign: '+' })),
    ...p.purchases.map((c) => ({ kind: 'p', id: c.id, date: c.purchase_date, at: c.created_at, text: `Compra: ${c.description}`, amount: c.balance_used, sign: '−', extra: c.extra_paid })),
  ].sort((a, b) => (a.date + a.at < b.date + b.at ? 1 : -1));

  async function del(it) {
    if (!confirmar('¿Eliminar este registro? Esto cambia el saldo del participante.')) return;
    await run(async () => {
      check(await supabase.from(it.kind === 'c' ? 'contributions' : 'participant_purchases').delete().eq('id', it.id));
      await reload();
    }, 'Registro eliminado');
  }

  return (
    <Modal title={`Historial de ${p.name}`} onClose={onClose}>
      <div className="two small" style={{ marginBottom: '.6rem' }}>
        <div>Aportado: <b>{money(p.contributed)}</b></div>
        <div>Usado: <b>{money(p.used)}</b></div>
        <div>Saldo: <b>{money(p.saldo)}</b></div>
        <div>Pagado aparte: <b>{money(p.extra)}</b></div>
      </div>
      {items.length === 0 && <div className="muted">Sin movimientos todavía.</div>}
      {items.map((it) => (
        <div key={it.kind + it.id} className="list-item small">
          <div className="row">
            <div>{it.text}<div className="muted">{fmtDate(it.date)}</div></div>
            <b>{it.sign}{money(it.amount)}</b>
          </div>
          {it.kind === 'p' && num0(it.extra) > 0 && <div className="muted">Pagó aparte: {money(it.extra)}</div>}
          <button className="btn sm danger" style={{ marginTop: 4 }} onClick={() => del(it)}>Eliminar</button>
        </div>
      ))}
    </Modal>
  );
}
const num0 = (v) => Number(v) || 0;

// ---------- Detalle de tanda ----------
function GroupDetail({ id, onBack }) {
  const { raw, participants, reload } = useData();
  const { run } = useAction();
  const g = raw.groups.find((x) => x.id === id);
  const [modal, setModal] = useState(null); // {type, p}
  if (!g) return <Empty>Tanda no encontrada.</Empty>;

  const mine = participants.filter((p) => p.group_id === g.id).sort((a, b) => a.turn_number - b.turn_number);
  const nextTurn = mine.length ? Math.max(...mine.map((p) => p.turn_number || 0)) + 1 : 1;
  const totalSaldo = r2(mine.reduce((t, p) => t + p.saldo, 0));
  const totalAport = r2(mine.reduce((t, p) => t + p.contributed, 0));

  async function toggleStatus() {
    const next = isActive(g) ? 'Finalizada' : 'Activa';
    await run(async () => {
      check(await supabase.from('savings_groups').update({ status: next }).eq('id', g.id));
      await reload();
    }, `Tanda marcada como ${next.toLowerCase()}`);
  }
  async function delGroup() {
    if (mine.length > 0) return alert('Esta tanda tiene participantes. Elimina primero a los participantes (y sus movimientos).');
    if (!confirmar(`¿Eliminar la tanda "${g.name}"?`)) return;
    const ok = await run(async () => {
      check(await supabase.from('savings_groups').delete().eq('id', g.id));
      await reload();
    }, 'Tanda eliminada');
    if (ok) onBack();
  }
  async function delParticipant(p) {
    if (!confirmar(`¿Eliminar a ${p.name} y todo su historial de aportaciones y compras?`)) return;
    await run(async () => {
      check(await supabase.from('contributions').delete().eq('participant_id', p.id));
      check(await supabase.from('participant_purchases').delete().eq('participant_id', p.id));
      check(await supabase.from('participants').delete().eq('id', p.id));
      await reload();
    }, 'Participante eliminado');
  }

  return (
    <>
      <button className="btn sm sec" onClick={onBack}>← Tandas</button>
      <div className="row" style={{ marginTop: '.8rem' }}>
        <h1 style={{ margin: 0 }}>{g.name}</h1>
        <span className={`badge ${isActive(g) ? 'ok' : ''}`}>{g.status}</span>
      </div>
      <div className="card" style={{ marginTop: '.8rem' }}>
        <div className="two small">
          <div>Aportación: <b>{money(g.contribution_amount)}</b></div>
          <div>{g.frequency} · {g.periods} periodos</div>
          <div>Inicio: <b>{fmtDate(g.start_date)}</b></div>
          <div>Participantes: <b>{mine.length}</b></div>
          <div>Total aportado: <b>{money(totalAport)}</b></div>
          <div>Saldos disponibles: <b>{money(totalSaldo)}</b></div>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => setModal({ type: 'newp' })}>+ Participante</button>
          <button className="btn sm sec" onClick={toggleStatus}>{isActive(g) ? 'Marcar finalizada' : 'Reactivar'}</button>
          <button className="btn sm danger" onClick={delGroup}>Eliminar tanda</button>
        </div>
      </div>

      <h2>Participantes por turno</h2>
      {mine.length === 0 && <Empty>Agrega al primer participante.</Empty>}
      {mine.map((p) => (
        <div key={p.id} className="card">
          <div className="row">
            <h3>Turno {p.turn_number} · {p.name}</h3>
            <b style={{ color: 'var(--brand-dark)' }}>{money(p.saldo)}</b>
          </div>
          <div className="muted small">
            Aportado {money(p.contributed)} · Usado {money(p.used)} {p.phone ? `· ${p.phone}` : ''}
          </div>
          <div className="actions">
            <button className="btn sm" onClick={() => setModal({ type: 'contrib', p })}>+ Aportación</button>
            <button className="btn sm sec" onClick={() => setModal({ type: 'buy', p })}>Registrar compra</button>
            <button className="btn sm sec" onClick={() => setModal({ type: 'hist', p })}>Historial</button>
            <button className="btn sm danger" onClick={() => delParticipant(p)}>Quitar</button>
          </div>
        </div>
      ))}

      {modal?.type === 'newp' && <NewParticipantModal group={g} nextTurn={nextTurn} onClose={() => setModal(null)} />}
      {modal?.type === 'contrib' && <ContributionModal group={g} p={participants.find((x) => x.id === modal.p.id)} onClose={() => setModal(null)} />}
      {modal?.type === 'buy' && <PurchaseModal p={participants.find((x) => x.id === modal.p.id)} onClose={() => setModal(null)} />}
      {modal?.type === 'hist' && <HistoryModal p={participants.find((x) => x.id === modal.p.id)} onClose={() => setModal(null)} />}
    </>
  );
}

export default function Tandas() {
  const { raw, participants } = useData();
  const [creating, setCreating] = useState(false);
  const [sel, setSel] = useState(null);

  if (sel) return <GroupDetail id={sel} onBack={() => setSel(null)} />;

  const groups = [...raw.groups].sort((a, b) => (a.start_date < b.start_date ? 1 : -1));

  return (
    <>
      <div className="row">
        <h1>Tandas</h1>
        <button className="btn" onClick={() => setCreating(true)}>+ Nueva tanda</button>
      </div>
      {groups.length === 0 ? <Empty>Todavía no hay tandas.</Empty> : groups.map((g) => {
        const mine = participants.filter((p) => p.group_id === g.id);
        return (
          <div key={g.id} className="card" style={{ cursor: 'pointer' }} onClick={() => setSel(g.id)}>
            <div className="row">
              <h3>{g.name}</h3>
              <span className={`badge ${isActive(g) ? 'ok' : ''}`}>{g.status}</span>
            </div>
            <div className="muted small">
              {money(g.contribution_amount)} {String(g.frequency || '').toLowerCase()} · {mine.length} participante(s) · Saldos: {money(mine.reduce((t, p) => t + p.saldo, 0))}
            </div>
          </div>
        );
      })}
      {creating && <NewGroupModal onClose={() => setCreating(false)} />}
    </>
  );
}
