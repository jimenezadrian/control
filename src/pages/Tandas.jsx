import React, { useState } from 'react';
import { supabase } from '../supabase.js';
import { useData } from '../data.jsx';
import { Empty, Field, Modal, MoneyInput, check, confirmar, parseAmount, useAction } from '../ui.jsx';
import { fmtDate, money, r2, today } from '../utils.js';
import { NewSaleModal, SaleCard } from './Ventas.jsx';

const FREQS = ['Semanal', 'Quincenal', 'Mensual'];

// ---------- Crear tanda ----------
function NewGroupModal({ onClose }) {
  const { reload } = useData();
  const { busy, run } = useAction();
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [nPart, setNPart] = useState('');
  const [periods, setPeriods] = useState('');
  const [periodsTouched, setPeriodsTouched] = useState(false);
  const [freq, setFreq] = useState('Semanal');
  const [start, setStart] = useState(today());
  const [error, setError] = useState('');

  const bag = Number(amount) * Number(nPart);

  async function save() {
    setError('');
    let a, n, p;
    try {
      if (!name.trim()) throw new Error('Escribe el nombre de la tanda.');
      a = parseAmount(amount, 'el importe de la aportación');
      n = Math.round(Number(nPart));
      if (!n || n < 1) throw new Error('Escribe la cantidad de participantes.');
      p = Math.round(Number(periods));
      if (!p || p < 1) throw new Error('Escribe el número de fechas o periodos.');
      if (!start) throw new Error('Elige la fecha de inicio.');
    } catch (e) { return setError(e.message); }
    const ok = await run(async () => {
      check(await supabase.rpc('create_tanda', {
        p_name: name.trim(), p_amount: a, p_frequency: freq, p_periods: p, p_start: start, p_participants: n,
      }));
      await reload();
    }, 'Tanda creada con todas sus fechas');
    if (ok) onClose();
  }

  return (
    <Modal title="Nueva tanda" onClose={onClose}>
      {error && <div className="err-box">{error}</div>}
      <Field label="Nombre"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Tanda noviembre" autoFocus /></Field>
      <div className="two">
        <Field label="Participantes"><input type="number" inputMode="numeric" min="1" value={nPart}
          onChange={(e) => { setNPart(e.target.value); if (!periodsTouched) setPeriods(e.target.value); }} /></Field>
        <Field label="Aportación por persona"><MoneyInput value={amount} onChange={setAmount} /></Field>
      </div>
      <div className="two">
        <Field label="Número de fechas"><input type="number" inputMode="numeric" min="1" value={periods}
          onChange={(e) => { setPeriods(e.target.value); setPeriodsTouched(true); }} /></Field>
        <Field label="Frecuencia">
          <select value={freq} onChange={(e) => setFreq(e.target.value)}>{FREQS.map((f) => <option key={f}>{f}</option>)}</select>
        </Field>
      </div>
      <Field label="Fecha de inicio"><input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
      {bag > 0 && <div className="help">Bolsa por fecha: <b>{money(bag)}</b>. Se generarán las fechas automáticamente.</div>}
      <button className="btn block" onClick={save} disabled={busy}>{busy ? 'Creando…' : 'Crear tanda'}</button>
    </Modal>
  );
}

// ---------- Agregar participante ----------
function NewParticipantModal({ tanda, onClose }) {
  const { reload } = useData();
  const { busy, run } = useAction();
  const used = new Set(tanda.participants.map((p) => Number(p.turn_number)));
  let first = 1;
  while (used.has(first)) first++;
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [turn, setTurn] = useState(String(first));
  const [error, setError] = useState('');

  async function save() {
    const t = Math.round(Number(turn));
    if (!name.trim()) return setError('Escribe el nombre del participante.');
    if (!t || t < 1) return setError('El turno debe ser un número desde 1.');
    if (used.has(t)) return setError(`El turno ${t} ya está asignado a otra persona.`);
    if (tanda.participants.length >= tanda.nPart) return setError(`Esta tanda ya tiene sus ${tanda.nPart} participantes.`);
    const ok = await run(async () => {
      check(await supabase.from('participants').insert({ group_id: tanda.id, name: name.trim(), phone: phone.trim() || null, turn_number: t }));
      await reload();
    }, 'Participante agregado');
    if (ok) onClose();
  }

  return (
    <Modal title="Agregar participante" onClose={onClose}>
      {error && <div className="err-box">{error}</div>}
      <p className="muted" style={{ marginTop: 0 }}>Van {tanda.participants.length} de {tanda.nPart}.</p>
      <Field label="Nombre"><input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
      <div className="two">
        <Field label="Teléfono (opcional)"><input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        <Field label="Turno"><input type="number" inputMode="numeric" min="1" value={turn} onChange={(e) => setTurn(e.target.value)} /></Field>
      </div>
      <button className="btn block" onClick={save} disabled={busy}>{busy ? 'Guardando…' : 'Agregar'}</button>
    </Modal>
  );
}

// ---------- Historial de un participante ----------
function HistoryModal({ tanda, p, onClose }) {
  const rows = tanda.periods.map((per) => ({ per, c: per.byPart[p.id] }));
  const total = r2(rows.reduce((t, r) => t + (r.c ? Number(r.c.amount) : 0), 0));
  return (
    <Modal title={`Pagos de ${p.name}`} onClose={onClose}>
      <p className="muted" style={{ marginTop: 0 }}>
        Turno {p.turn_number} · {p.paid} de {tanda.periods.length} pagados · Aportado {money(total)}
        {p.received ? ' · Ya recibió su pedido' : ''}
      </p>
      {rows.map(({ per, c }) => (
        <div key={per.id} className="pay-row small">
          <div>
            Fecha {per.period_number} · {fmtDate(per.scheduled_date)}
            {c && <div className="muted">Pagó el {fmtDate(c.contribution_date)}</div>}
            {per.beneficiary_participant_id === p.id && per.financed && <div className="muted">Su pedido se financió en esta fecha</div>}
          </div>
          <span className={`badge ${c ? 'ok' : 'warn'}`}>{c ? 'Pagado' : 'Pendiente'}</span>
        </div>
      ))}
    </Modal>
  );
}

// ---------- Detalle de un periodo (pagos de un clic) ----------
function PeriodDetail({ tanda, periodId, onBack }) {
  const { reload } = useData();
  const { run } = useAction();
  const [selling, setSelling] = useState(false);
  const per = tanda.periods.find((p) => p.id === periodId);
  if (!per) return <Empty>Periodo no encontrado.</Empty>;

  const total = tanda.participants.length;
  const pct = tanda.nPart ? Math.min(100, Math.round((per.paidCount / tanda.nPart) * 100)) : 0;
  // El excedente solo puede "pasar" si existe un periodo siguiente que aún no tiene pedido.
  const nextPer = tanda.periods.find((p) => p.period_number === per.period_number + 1);
  const isLast = !nextPer || nextPer.financed;
  const sale = per.sale;
  const beneficiary = tanda.participants.find((p) => p.id === per.beneficiary_participant_id);
  const sinAplicar = sale ? r2(per.bag - sale.paidTanda - num0(per.surplus_amount)) : 0;

  const pay = (p) => run(async () => {
    check(await supabase.rpc('pay_contribution', { p_participant_id: p.id, p_period_id: per.id, p_date: today() }));
    await reload();
  }, `${p.name}: pago registrado`);

  const unpay = async (p) => {
    if (!confirmar(`¿Quitar el pago de ${p.name} en la fecha ${per.period_number}? (Se usa para corregir un error)`)) return;
    await run(async () => {
      check(await supabase.rpc('unpay_contribution', { p_participant_id: p.id, p_period_id: per.id }));
      await reload();
    }, 'Pago corregido');
  };

  return (
    <>
      <button className="btn sm sec" onClick={onBack}>← {tanda.name}</button>
      <div className="row" style={{ marginTop: '.8rem' }}>
        <h1 style={{ margin: 0 }}>Fecha {per.period_number} de {tanda.periods.length}</h1>
        <span className={`badge ${per.financed ? 'ok' : ''}`}>{per.financed ? 'Pedido registrado' : 'Abierto'}</span>
      </div>
      <div className="muted">{tanda.name} · programada para el {fmtDate(per.scheduled_date)}</div>

      <div className="card" style={{ marginTop: '.8rem' }}>
        <b>{per.paidCount} de {tanda.nPart} participantes han pagado</b>
        <div className="progress"><div style={{ width: `${pct}%` }} /></div>
        <div className="two small">
          <div>Recaudado: <b>{money(per.collected)}</b></div>
          <div>Falta para la bolsa: <b>{money(per.missing)}</b></div>
          {per.carryIn > 0 && <div>Viene del periodo anterior: <b>{money(per.carryIn)}</b></div>}
          <div>Bolsa disponible: <b>{money(per.bag)}</b></div>
        </div>
      </div>

      <h2>Le toca el pedido a</h2>
      {!sale ? (
        <div className="card">
          <div className="row">
            <b>{per.turnHolder ? `Turno ${per.turnHolder.turn_number} · ${per.turnHolder.name}` : 'Nadie tiene asignado este turno'}</b>
          </div>
          {per.bag <= 0 && <div className="muted small" style={{ marginTop: 4 }}>Registra primero las aportaciones para tener bolsa.</div>}
          {per.bag > 0 && per.missing > 0.005 && <div className="muted small" style={{ marginTop: 4 }}>Todavía faltan {money(per.missing)} por reunir.</div>}
          <div className="actions">
            <button className="btn" disabled={per.bag <= 0 || total === 0} onClick={() => setSelling(true)}>Registrar pedido del turno</button>
          </div>
        </div>
      ) : (
        <>
          <div className="card">
            <div className="row"><h3>{beneficiary?.name || sale.customer?.name}</h3><span className="badge ok">Turno {beneficiary?.turn_number}</span></div>
            <table style={{ width: '100%', marginTop: '.5rem' }} className="small">
              <tbody>
                <tr><td>Bolsa reunida</td><td className="right"><b>{money(per.bag)}</b></td></tr>
                <tr><td>Costo ADI</td><td className="right">{money(sale.cost)}</td></tr>
                <tr><td>Precio de venta</td><td className="right">{money(sale.price)}</td></tr>
                <tr><td>Utilidad esperada</td><td className="right"><b>{money(sale.profit)}</b></td></tr>
                <tr><td>Bolsa aplicada al pedido</td><td className="right">{money(sale.paidTanda)}</td></tr>
                {sale.balance > 0.005 && <tr><td>Diferencia a cargo del participante</td><td className="right"><b style={{ color: 'var(--danger)' }}>{money(sale.balance)}</b></td></tr>}
                {num0(per.surplus_amount) > 0 && <tr><td>Excedente de la bolsa ({per.surplus_action === 'Devuelto' ? 'devuelto al participante' : 'pasó al siguiente periodo'})</td><td className="right">{money(per.surplus_amount)}</td></tr>}
                {sinAplicar > 0.005 && <tr><td>Pagado después, en resguardo sin aplicar</td><td className="right">{money(sinAplicar)}</td></tr>}
              </tbody>
            </table>
          </div>
          <SaleCard s={sale} />
        </>
      )}

      <h2>Pagos de esta fecha</h2>
      {total === 0 && <Empty>Primero agrega participantes a la tanda.</Empty>}
      <div className="card">
        {tanda.participants.map((p) => {
          const c = per.byPart[p.id];
          return (
            <div key={p.id} className="pay-row">
              <div style={{ minWidth: 0 }}>
                <b>{p.name}</b>
                <div className="muted small">
                  Turno {p.turn_number}{c ? ` · pagó el ${fmtDate(c.contribution_date)}` : ''}
                </div>
              </div>
              <div className="row" style={{ gap: '.4rem' }}>
                <span className={`badge ${c ? 'ok' : 'warn'}`}>{c ? 'Pagado' : 'Pendiente'}</span>
                {c
                  ? <button className="btn sm sec" onClick={() => unpay(p)} disabled={per.financed}>Corregir</button>
                  : <button className="btn sm" onClick={() => pay(p)}>Marcar pagado</button>}
              </div>
            </div>
          );
        })}
        {per.financed && total > 0 && <div className="muted small" style={{ marginTop: 6 }}>Para corregir un pago de una fecha con pedido registrado, elimina primero la venta de esa fecha.</div>}
      </div>
      <div className="muted small">Cada pago registra automáticamente {money(tanda.amount)}, la aportación configurada de la tanda.</div>

      {selling && (
        <NewSaleModal
          onClose={() => setSelling(false)}
          period={{
            id: per.id, number: per.period_number, total: tanda.periods.length, bag: per.bag, missing: per.missing,
            candidates: tanda.participants, defaultBeneficiaryId: per.turnHolder?.id || '', isLast,
          }}
        />
      )}
    </>
  );
}
const num0 = (v) => Number(v) || 0;

// ---------- Detalle de tanda ----------
function GroupDetail({ id, onBack }) {
  const { tandas, reload } = useData();
  const { run } = useAction();
  const [tab, setTab] = useState('periodos');
  const [modal, setModal] = useState(null);
  const [perId, setPerId] = useState(null);
  const t = tandas.find((x) => x.id === id);
  if (!t) return <Empty>Tanda no encontrada.</Empty>;
  if (perId) return <PeriodDetail tanda={t} periodId={perId} onBack={() => setPerId(null)} />;

  const financed = t.periods.filter((p) => p.financed).length;

  async function toggleStatus() {
    const next = t.active ? 'Finalizada' : 'Activa';
    await run(async () => {
      check(await supabase.from('savings_groups').update({ status: next }).eq('id', t.id));
      await reload();
    }, `Tanda marcada como ${next.toLowerCase()}`);
  }
  async function delGroup() {
    if (t.participants.length > 0) return alert('Esta tanda tiene participantes. Quítalos primero para poder eliminarla.');
    if (!confirmar(`¿Eliminar la tanda "${t.name}" y sus fechas?`)) return;
    const ok = await run(async () => {
      check(await supabase.from('savings_groups').delete().eq('id', t.id));
      await reload();
    }, 'Tanda eliminada');
    if (ok) onBack();
  }
  async function genPeriods() {
    await run(async () => {
      check(await supabase.rpc('generate_periods', { p_group_id: t.id }));
      await reload();
    }, 'Fechas generadas');
  }
  async function delParticipant(p) {
    const blocked = t.periods.some((per) => (per.financed && per.byPart[p.id]) || per.beneficiary_participant_id === p.id);
    if (blocked) return alert('No se puede quitar a esta persona porque participó en una fecha que ya financió un pedido.');
    if (!confirmar(`¿Quitar a ${p.name} y sus pagos registrados?`)) return;
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
        <h1 style={{ margin: 0 }}>{t.name}</h1>
        <span className={`badge ${t.active ? 'ok' : ''}`}>{t.status}</span>
      </div>
      <div className="card" style={{ marginTop: '.8rem' }}>
        <div className="two small">
          <div>Aportación: <b>{money(t.amount)}</b> por persona</div>
          <div>{t.frequency} · {t.periods.length} fechas</div>
          <div>Participantes: <b>{t.participants.length} de {t.nPart}</b></div>
          <div>Bolsa por fecha: <b>{money(t.nPart * t.amount)}</b></div>
          <div>Total recaudado: <b>{money(t.collected)}</b></div>
          <div>Pedidos financiados: <b>{financed} de {t.periods.length}</b></div>
        </div>
        <div className="actions">
          <button className="btn sm sec" onClick={toggleStatus}>{t.active ? 'Marcar finalizada' : 'Reactivar'}</button>
          <button className="btn sm danger" onClick={delGroup}>Eliminar tanda</button>
        </div>
      </div>

      <div className="tabs">
        <button className={tab === 'periodos' ? 'active' : ''} onClick={() => setTab('periodos')}>Fechas</button>
        <button className={tab === 'participantes' ? 'active' : ''} onClick={() => setTab('participantes')}>Participantes</button>
      </div>

      {tab === 'periodos' && (
        t.periods.length === 0 ? (
          <div className="card">
            <p style={{ marginTop: 0 }}>Esta tanda todavía no tiene fechas generadas.</p>
            <button className="btn" onClick={genPeriods}>Generar fechas</button>
          </div>
        ) : t.periods.map((per) => (
          <div key={per.id} className="card" style={{ cursor: 'pointer' }} onClick={() => setPerId(per.id)}>
            <div className="row">
              <h3>Fecha {per.period_number} de {t.periods.length} · {fmtDate(per.scheduled_date)}</h3>
              <span className={`badge ${per.financed ? 'ok' : per.complete ? '' : 'warn'}`}>
                {per.financed ? 'Pedido registrado' : per.complete ? 'Bolsa completa' : 'Reuniendo'}
              </span>
            </div>
            <div className="muted small">
              {per.paidCount} de {t.nPart} pagaron · {money(per.collected)} · Turno: {per.financed
                ? (t.participants.find((p) => p.id === per.beneficiary_participant_id)?.name || '—')
                : (per.turnHolder?.name || 'sin asignar')}
            </div>
          </div>
        ))
      )}

      {tab === 'participantes' && (
        <>
          <div className="actions" style={{ marginTop: 0, marginBottom: '.8rem' }}>
            <button className="btn" onClick={() => setModal({ type: 'newp' })} disabled={t.participants.length >= t.nPart}>+ Participante</button>
          </div>
          {t.participants.length === 0 && <Empty>Agrega al primer participante.</Empty>}
          {t.participants.map((p) => (
            <div key={p.id} className="card">
              <div className="row">
                <h3>Turno {p.turn_number} · {p.name}</h3>
                {p.received && <span className="badge ok">Ya recibió su pedido</span>}
              </div>
              <div className="muted small">{p.paid} de {t.periods.length} pagos{p.phone ? ` · ${p.phone}` : ''}</div>
              <div className="actions">
                <button className="btn sm sec" onClick={() => setModal({ type: 'hist', id: p.id })}>Historial de pagos</button>
                <button className="btn sm danger" onClick={() => delParticipant(p)}>Quitar</button>
              </div>
            </div>
          ))}
        </>
      )}

      {modal?.type === 'newp' && <NewParticipantModal tanda={t} onClose={() => setModal(null)} />}
      {modal?.type === 'hist' && <HistoryModal tanda={t} p={t.participants.find((x) => x.id === modal.id)} onClose={() => setModal(null)} />}
    </>
  );
}

export default function Tandas() {
  const { tandas } = useData();
  const [creating, setCreating] = useState(false);
  const [sel, setSel] = useState(null);

  if (sel) return <GroupDetail id={sel} onBack={() => setSel(null)} />;

  const groups = [...tandas].sort((a, b) => (a.start_date < b.start_date ? 1 : -1));

  return (
    <>
      <div className="row">
        <h1>Tandas</h1>
        <button className="btn" onClick={() => setCreating(true)}>+ Nueva tanda</button>
      </div>
      {groups.length === 0 ? <Empty>Todavía no hay tandas.</Empty> : groups.map((g) => {
        const next = g.periods.find((p) => !p.financed);
        return (
          <div key={g.id} className="card" style={{ cursor: 'pointer' }} onClick={() => setSel(g.id)}>
            <div className="row">
              <h3>{g.name}</h3>
              <span className={`badge ${g.active ? 'ok' : ''}`}>{g.status}</span>
            </div>
            <div className="muted small">
              {money(g.amount)} {String(g.frequency || '').toLowerCase()} · {g.participants.length} de {g.nPart} participantes · Recaudado {money(g.collected)}
              {g.active && next && <><br />Próximo turno: fecha {next.period_number} · {next.turnHolder?.name || 'sin asignar'}</>}
            </div>
          </div>
        );
      })}
      {creating && <NewGroupModal onClose={() => setCreating(false)} />}
    </>
  );
}
