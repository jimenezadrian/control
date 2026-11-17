import React, { useState } from 'react';
import { supabase } from '../supabase.js';
import { useData } from '../data.jsx';
import { Empty, Field, Modal, MoneyInput, check, confirmar, parseAmount, useAction } from '../ui.jsx';
import { fmtDate, money, r2, today } from '../utils.js';

// ---------- Registrar abono ----------
export function PayModal({ sale, onClose }) {
  const { reload } = useData();
  const { busy, run } = useAction();
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today());
  const [error, setError] = useState('');

  async function save() {
    setError('');
    let n;
    try {
      n = parseAmount(amount, 'el monto del abono');
      if (!date) throw new Error('Elige la fecha del abono.');
      if (n > sale.balance + 0.005) throw new Error(`El abono no puede ser mayor a lo que debe (${money(sale.balance)}).`);
    } catch (e) { return setError(e.message); }
    const ok = await run(async () => {
      check(await supabase.from('payments').insert({ sale_id: sale.id, amount: n, payment_date: date }));
      await reload();
    }, 'Abono registrado');
    if (ok) onClose();
  }

  return (
    <Modal title="Registrar abono" onClose={onClose}>
      <p className="muted" style={{ marginTop: 0 }}>
        {sale.customer?.name} · {sale.description}<br />Debe: <b>{money(sale.balance)}</b>
      </p>
      {error && <div className="err-box">{error}</div>}
      <Field label="Monto del abono"><MoneyInput value={amount} onChange={setAmount} autoFocus /></Field>
      <div className="actions" style={{ marginTop: 0, marginBottom: '.8rem' }}>
        <button type="button" className="btn sm sec" onClick={() => setAmount(String(sale.balance))}>Liquidar todo</button>
      </div>
      <Field label="Fecha"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <button className="btn block" onClick={save} disabled={busy}>{busy ? 'Guardando…' : 'Guardar abono'}</button>
    </Modal>
  );
}

// ---------- Nueva venta ----------
export function NewSaleModal({ onClose, presetCustomerId }) {
  const { customers, reload } = useData();
  const { busy, run } = useAction();
  const [customerId, setCustomerId] = useState(presetCustomerId || (customers.length ? '' : 'new'));
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [description, setDescription] = useState('');
  const [cost, setCost] = useState('');
  const [price, setPrice] = useState('');
  const [deposit, setDeposit] = useState('');
  const [date, setDate] = useState(today());
  const [error, setError] = useState('');

  const priceN = Number(price) || 0;
  const costN = Number(cost) || 0;
  const profit = r2(priceN - costN);

  async function save() {
    setError('');
    let c, p, dep;
    try {
      if (!customerId) throw new Error('Elige un cliente.');
      if (customerId === 'new' && !newName.trim()) throw new Error('Escribe el nombre del cliente nuevo.');
      if (!description.trim()) throw new Error('Escribe qué pidió el cliente.');
      c = parseAmount(cost, 'el costo ADI', { allowZero: true });
      p = parseAmount(price, 'el precio de venta');
      dep = parseAmount(deposit === '' ? '0' : deposit, 'el anticipo', { allowZero: true });
      if (dep > p + 0.005) throw new Error('El anticipo no puede ser mayor al precio de venta.');
      if (!date) throw new Error('Elige la fecha de la venta.');
    } catch (e) { return setError(e.message); }

    const ok = await run(async () => {
      let cid = customerId;
      if (cid === 'new') {
        const cust = check(await supabase.from('customers').insert({ name: newName.trim(), phone: newPhone.trim() || null }).select().single());
        cid = cust.id;
      }
      const sale = check(
        await supabase.from('sales')
          .insert({ customer_id: cid, description: description.trim(), adi_cost: c, sale_price: p, deposit: dep, sale_date: date })
          .select().single()
      );
      if (dep > 0) {
        // El anticipo se guarda en sales.deposit y como pago en payments (solo payments se suma).
        const { error: e } = await supabase.from('payments').insert({ sale_id: sale.id, amount: dep, payment_date: date });
        if (e) {
          await supabase.from('sales').delete().eq('id', sale.id);
          throw e;
        }
      }
      await reload();
    }, 'Venta guardada');
    if (ok) onClose();
  }

  return (
    <Modal title="Nueva venta" onClose={onClose}>
      {error && <div className="err-box">{error}</div>}
      <Field label="Cliente">
        <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
          <option value="">Elige un cliente…</option>
          {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          <option value="new">+ Cliente nuevo</option>
        </select>
      </Field>
      {customerId === 'new' && (
        <div className="two">
          <Field label="Nombre"><input value={newName} onChange={(e) => setNewName(e.target.value)} /></Field>
          <Field label="Teléfono (opcional)"><input type="tel" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} /></Field>
        </div>
      )}
      <Field label="¿Qué pidió?"><input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ej. Perfume, crema y labial" /></Field>
      <div className="two">
        <Field label="Costo ADI (lo que pagamos)"><MoneyInput value={cost} onChange={setCost} /></Field>
        <Field label="Precio de venta"><MoneyInput value={price} onChange={setPrice} /></Field>
      </div>
      <Field label="Anticipo">
        <MoneyInput value={deposit} onChange={setDeposit} />
      </Field>
      <div className="actions" style={{ marginTop: 0, marginBottom: '.8rem' }}>
        <button type="button" className="btn sm sec" disabled={!priceN} onClick={() => setDeposit(String(r2(priceN / 2)))}>50% del precio</button>
      </div>
      <Field label="Fecha de la venta"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      {priceN > 0 && (
        <div className="help">
          Utilidad esperada: <b>{money(profit)}</b> · Quedaría debiendo: <b>{money(Math.max(0, priceN - (Number(deposit) || 0)))}</b>
        </div>
      )}
      <button className="btn block" onClick={save} disabled={busy}>{busy ? 'Guardando…' : 'Guardar venta'}</button>
    </Modal>
  );
}

// ---------- Tarjeta de venta ----------
export function SaleCard({ s, showCustomer = true }) {
  const { reload } = useData();
  const { run } = useAction();
  const [open, setOpen] = useState(false);
  const [paying, setPaying] = useState(false);

  async function delPayment(p) {
    if (!confirmar(`¿Eliminar el pago de ${money(p.amount)} del ${fmtDate(p.payment_date)}?`)) return;
    await run(async () => {
      check(await supabase.from('payments').delete().eq('id', p.id));
      await reload();
    }, 'Pago eliminado');
  }
  async function delSale() {
    if (!confirmar('¿Eliminar esta venta y todos sus pagos? Esto no se puede deshacer.')) return;
    await run(async () => {
      check(await supabase.from('payments').delete().eq('sale_id', s.id));
      check(await supabase.from('sales').delete().eq('id', s.id));
      await reload();
    }, 'Venta eliminada');
  }

  const status = s.liquidada ? <span className="badge ok">Liquidada</span> : s.paid > 0 ? <span className="badge warn">Con abonos</span> : <span className="badge bad">Sin pagos</span>;

  return (
    <div className="card">
      <div className="row wrap" style={{ alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <h3>{showCustomer ? s.customer?.name || 'Cliente' : s.description}</h3>
          <div className="muted small">{showCustomer ? s.description : ''} · {fmtDate(s.sale_date)}</div>
        </div>
        {status}
      </div>
      <div className="two small" style={{ marginTop: '.6rem' }}>
        <div>Precio: <b>{money(s.price)}</b></div>
        <div>Pagado: <b>{money(s.paid)}</b></div>
        <div>Debe: <b style={{ color: s.liquidada ? 'var(--ok)' : 'var(--danger)' }}>{money(Math.max(0, s.balance))}</b></div>
        <div>Utilidad esperada: <b>{money(s.profit)}</b></div>
      </div>
      <div className="actions">
        {!s.liquidada && <button className="btn sm" onClick={() => setPaying(true)}>+ Abono</button>}
        <button className="btn sm sec" onClick={() => setOpen(!open)}>{open ? 'Ocultar pagos' : `Ver pagos (${s.pays.length})`}</button>
      </div>
      {open && (
        <div style={{ marginTop: '.6rem' }}>
          <div className="muted small">Costo ADI: {money(s.cost)}</div>
          {s.pays.length === 0 && <div className="muted small">Aún no hay pagos.</div>}
          {s.pays.map((p) => (
            <div key={p.id} className="list-item row small">
              <span>{fmtDate(p.payment_date)}</span>
              <b>{money(p.amount)}</b>
              <button className="btn sm danger" onClick={() => delPayment(p)}>Eliminar</button>
            </div>
          ))}
          <div className="actions"><button className="btn sm danger" onClick={delSale}>Eliminar venta</button></div>
        </div>
      )}
      {paying && <PayModal sale={s} onClose={() => setPaying(false)} />}
    </div>
  );
}

// ---------- Pantalla Ventas ----------
export default function Ventas() {
  const { sales } = useData();
  const [filter, setFilter] = useState('pendientes');
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);

  const list = sales
    .filter((s) => (filter === 'pendientes' ? !s.liquidada : filter === 'liquidadas' ? s.liquidada : true))
    .filter((s) => !q.trim() || `${s.customer?.name || ''} ${s.description}`.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => (a.sale_date < b.sale_date ? 1 : -1));

  return (
    <>
      <div className="row">
        <h1>Ventas</h1>
        <button className="btn" onClick={() => setCreating(true)}>+ Nueva venta</button>
      </div>
      <div className="tabs">
        {[['pendientes', 'Pendientes'], ['liquidadas', 'Liquidadas'], ['todas', 'Todas']].map(([id, l]) => (
          <button key={id} className={filter === id ? 'active' : ''} onClick={() => setFilter(id)}>{l}</button>
        ))}
      </div>
      <input placeholder="Buscar por cliente o pedido…" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: '.8rem' }} />
      {list.length === 0 ? <Empty>No hay ventas en esta lista.</Empty> : list.map((s) => <SaleCard key={s.id} s={s} />)}
      {creating && <NewSaleModal onClose={() => setCreating(false)} />}
    </>
  );
}
