import React, { useState } from 'react';
import { supabase } from '../supabase.js';
import { useData } from '../data.jsx';
import { Empty, Field, Modal, MoneyInput, check, confirmar, parseAmount, useAction } from '../ui.jsx';
import { fmtDate, money, num, r2, today } from '../utils.js';

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
      check(await supabase.from('payments').insert({ sale_id: sale.id, amount: n, payment_date: date, source: 'cliente' }));
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

// ---------- Nueva venta (varios productos) ----------
let keySeq = 1;
const newItem = () => ({ key: keySeq++, name: '', sku: '', qty: '1', cost: '', price: '' });

// period (opcional): { id, number, total, bag, missing, candidates, defaultBeneficiaryId, isLast }
// Cuando viene, la venta es el pedido del turno y la bolsa se aplica automáticamente.
export function NewSaleModal({ onClose, presetCustomerId, period }) {
  const { customers, reload } = useData();
  const { busy, run } = useAction();
  const [customerId, setCustomerId] = useState(presetCustomerId || (customers.length ? '' : 'new'));
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [beneficiary, setBeneficiary] = useState(period?.defaultBeneficiaryId || '');
  const [items, setItems] = useState([newItem()]);
  const [deposit, setDeposit] = useState('');
  const [date, setDate] = useState(today());
  const [surplusAction, setSurplusAction] = useState('');
  const [error, setError] = useState('');

  const setItem = (key, patch) => setItems((arr) => arr.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  const price = r2(items.reduce((t, i) => t + num(i.qty) * num(i.price), 0));
  const cost = r2(items.reduce((t, i) => t + num(i.qty) * num(i.cost), 0));
  const profit = r2(price - cost);

  const bag = period ? period.bag : 0;
  const applied = period ? Math.min(bag, price) : 0;
  const surplus = period && bag > price + 0.005 ? r2(bag - price) : 0;
  const difference = period && price > bag + 0.005 ? r2(price - bag) : 0;
  const dep = num(deposit);
  const debe = r2(price - applied - dep);

  async function save() {
    setError('');
    let depN = 0;
    try {
      if (period) {
        if (!beneficiary) throw new Error('Elige quién recibe el pedido de este turno.');
      } else {
        if (!customerId) throw new Error('Elige un cliente.');
        if (customerId === 'new' && !newName.trim()) throw new Error('Escribe el nombre del cliente nuevo.');
      }
      items.forEach((i, n) => {
        const at = `Producto ${n + 1}`;
        if (!i.name.trim()) throw new Error(`${at}: escribe el nombre.`);
        const q = Number(i.qty);
        if (!Number.isInteger(q) || q < 1) throw new Error(`${at}: la cantidad debe ser un número entero desde 1.`);
        if (i.cost === '' || Number(i.cost) < 0) throw new Error(`${at}: escribe el costo ADI (puede ser 0).`);
        if (i.price === '' || Number(i.price) < 0) throw new Error(`${at}: escribe el precio de venta.`);
      });
      if (price <= 0) throw new Error('El precio de venta total debe ser mayor a cero.');
      depN = parseAmount(deposit === '' ? '0' : deposit, period ? 'el pago extra' : 'el anticipo', { allowZero: true });
      if (depN + applied > price + 0.005) throw new Error(period ? 'El pago extra más la bolsa no pueden ser mayores al precio.' : 'El anticipo no puede ser mayor al precio de venta.');
      if (!date) throw new Error('Elige la fecha.');
      if (period && surplus > 0 && !surplusAction) throw new Error('La bolsa es mayor al pedido: elige qué hacer con el excedente.');
    } catch (e) { return setError(e.message); }

    const ok = await run(async () => {
      check(await supabase.rpc('create_sale', {
        p_customer_id: !period && customerId && customerId !== 'new' ? customerId : null,
        p_new_customer_name: !period && customerId === 'new' ? newName.trim() : null,
        p_new_customer_phone: !period && customerId === 'new' ? newPhone.trim() : null,
        p_sale_date: date,
        p_deposit: depN,
        p_items: items.map((i) => ({
          product_name: i.name.trim(), sku: i.sku.trim(), quantity: Number(i.qty),
          adi_cost: Number(i.cost), sale_price: Number(i.price),
        })),
        p_period_id: period ? period.id : null,
        p_beneficiary_id: period ? beneficiary : null,
        p_surplus_action: period && surplus > 0 ? surplusAction : null,
      }));
      await reload();
    }, period ? 'Pedido del turno registrado' : 'Venta guardada');
    if (ok) onClose();
  }

  return (
    <Modal title={period ? `Pedido del turno · Fecha ${period.number} de ${period.total}` : 'Nueva venta'} onClose={onClose}>
      {error && <div className="err-box">{error}</div>}

      {period ? (
        <>
          <div className="help">
            Bolsa del periodo: <b>{money(bag)}</b>
            {period.missing > 0 && <> · Aún faltan <b>{money(period.missing)}</b> por reunir</>}
          </div>
          <Field label="¿Quién recibe el pedido?">
            <select value={beneficiary} onChange={(e) => setBeneficiary(e.target.value)}>
              <option value="">Elige…</option>
              {period.candidates.map((p) => <option key={p.id} value={p.id}>Turno {p.turn_number} · {p.name}</option>)}
            </select>
          </Field>
        </>
      ) : (
        <>
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
        </>
      )}

      <h2 style={{ marginTop: '.4rem' }}>Productos</h2>
      {items.map((i, n) => (
        <div key={i.key} className="item-row">
          <div className="row" style={{ marginBottom: '.4rem' }}>
            <b className="small">Producto {n + 1}</b>
            {items.length > 1 && <button type="button" className="btn sm danger" onClick={() => setItems((a) => a.filter((x) => x.key !== i.key))}>Quitar</button>}
          </div>
          <Field label="Nombre o descripción"><input value={i.name} onChange={(e) => setItem(i.key, { name: e.target.value })} placeholder="Ej. Edredón matrimonial" /></Field>
          <div className="two">
            <Field label="SKU Vianney"><input value={i.sku} onChange={(e) => setItem(i.key, { sku: e.target.value })} inputMode="text" /></Field>
            <Field label="Cantidad"><input type="number" inputMode="numeric" min="1" step="1" value={i.qty} onChange={(e) => setItem(i.key, { qty: e.target.value })} /></Field>
          </div>
          <div className="two">
            <Field label="Costo ADI (unidad)"><MoneyInput value={i.cost} onChange={(v) => setItem(i.key, { cost: v })} /></Field>
            <Field label="Precio venta (unidad)"><MoneyInput value={i.price} onChange={(v) => setItem(i.key, { price: v })} /></Field>
          </div>
          {num(i.qty) > 0 && (num(i.price) > 0 || num(i.cost) > 0) && (
            <div className="muted small">Subtotal venta {money(num(i.qty) * num(i.price))} · utilidad {money(num(i.qty) * (num(i.price) - num(i.cost)))}</div>
          )}
        </div>
      ))}
      <button type="button" className="btn sec block" style={{ marginBottom: '.8rem' }} onClick={() => setItems((a) => [...a, newItem()])}>+ Agregar producto</button>

      <div className="help">
        Costo ADI total: <b>{money(cost)}</b> · Venta total: <b>{money(price)}</b> · Utilidad esperada: <b>{money(profit)}</b>
      </div>

      {period && price > 0 && (
        <div className="help">
          <b>Bolsa aplicada al pedido: {money(applied)}</b>
          {difference > 0 && <><br />El pedido cuesta más que la bolsa: la diferencia de <b>{money(difference)}</b> la paga el participante (queda como saldo con abonos, no es dinero de la tanda).</>}
          {surplus > 0 && <><br />La bolsa es mayor al pedido por <b>{money(surplus)}</b>. Ese excedente no es utilidad. ¿Qué se hace con él?</>}
        </div>
      )}
      {period && surplus > 0 && (
        <Field label="Excedente de la bolsa">
          <select value={surplusAction} onChange={(e) => setSurplusAction(e.target.value)}>
            <option value="">Elige…</option>
            <option value="Devuelto">Devolverlo al participante</option>
            {!period.isLast && <option value="Pasa al siguiente periodo">Pasarlo a la bolsa del siguiente periodo</option>}
          </select>
        </Field>
      )}

      <Field label={period ? 'Pago extra del participante hoy (opcional)' : 'Anticipo'}>
        <MoneyInput value={deposit} onChange={setDeposit} />
      </Field>
      {!period && (
        <div className="actions" style={{ marginTop: 0, marginBottom: '.8rem' }}>
          <button type="button" className="btn sm sec" disabled={!price} onClick={() => setDeposit(String(r2(price / 2)))}>50% del precio</button>
        </div>
      )}
      <Field label="Fecha"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      {price > 0 && <div className="help">Quedaría debiendo: <b>{money(Math.max(0, debe))}</b></div>}
      <button className="btn block" onClick={save} disabled={busy}>{busy ? 'Guardando…' : period ? 'Registrar pedido del turno' : 'Guardar venta'}</button>
    </Modal>
  );
}

// ---------- Marcar entrega ----------
function useDelivery() {
  const { reload } = useData();
  const { run } = useAction();
  return (item, delivered) => run(async () => {
    check(await supabase.from('sale_items').update({ delivered_at: delivered ? today() : null }).eq('id', item.id));
    await reload();
  }, delivered ? 'Marcado como entregado' : 'Entrega deshecha');
}

// ---------- Tarjeta de venta ----------
export function SaleCard({ s, showCustomer = true }) {
  const { reload } = useData();
  const { run } = useAction();
  const deliver = useDelivery();
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
    const extra = s.isTanda ? ' También se liberará el periodo de la tanda para poder registrar otro pedido.' : '';
    if (!confirmar(`¿Eliminar esta venta y todos sus pagos? Esto no se puede deshacer.${extra}`)) return;
    await run(async () => {
      check(await supabase.rpc('delete_sale', { p_sale_id: s.id }));
      await reload();
    }, 'Venta eliminada');
  }

  const status = s.liquidada ? <span className="badge ok">Liquidada</span> : s.paid > 0 ? <span className="badge warn">Con abonos</span> : <span className="badge bad">Sin pagos</span>;
  const nItems = s.items.reduce((t, i) => t + i.quantity, 0);

  return (
    <div className="card">
      <div className="row wrap" style={{ alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <h3>{showCustomer ? s.customer?.name || 'Cliente' : s.description}</h3>
          <div className="muted small">
            {showCustomer ? s.description : ''}{showCustomer ? ' · ' : ''}{fmtDate(s.sale_date)}
            {nItems > 0 ? ` · ${nItems} pieza(s)` : ''}
          </div>
        </div>
        <div>{s.isTanda && <span className="badge" style={{ marginRight: 4 }}>Tanda</span>}{status}</div>
      </div>
      <div className="two small" style={{ marginTop: '.6rem' }}>
        <div>Precio: <b>{money(s.price)}</b></div>
        <div>Pagado: <b>{money(s.paid)}</b></div>
        <div>Debe: <b style={{ color: s.liquidada ? 'var(--ok)' : 'var(--danger)' }}>{money(Math.max(0, s.balance))}</b></div>
        <div>Utilidad esperada: <b>{money(s.profit)}</b></div>
      </div>
      {s.isTanda && (
        <div className="muted small" style={{ marginTop: 4 }}>
          Bolsa de la tanda aplicada: {money(s.paidTanda)}{s.balance > 0.005 ? ` · Diferencia a cargo del participante: ${money(s.balance)}` : ''}
        </div>
      )}
      <div className="actions">
        {!s.liquidada && <button className="btn sm" onClick={() => setPaying(true)}>+ Abono</button>}
        <button className="btn sm sec" onClick={() => setOpen(!open)}>{open ? 'Ocultar detalle' : 'Ver detalle'}</button>
      </div>
      {open && (
        <div style={{ marginTop: '.6rem' }}>
          <h3 className="small">Productos</h3>
          {s.items.length === 0 && <div className="muted small">Sin productos capturados.</div>}
          {s.items.map((i) => (
            <div key={i.id} className="list-item small">
              <div className="row">
                <div style={{ minWidth: 0 }}>
                  <b>{i.quantity}× {i.product_name}</b>
                  <div className="muted">{i.sku ? `SKU ${i.sku}` : 'Sin SKU'} · costo {money(i.unitCost)} · precio {money(i.unitPrice)}</div>
                </div>
                <b>{money(i.subPrice)}</b>
              </div>
              <div className="row" style={{ marginTop: 4 }}>
                <span className={`badge ${i.delivered_at ? 'ok' : 'warn'}`}>{i.delivered_at ? `Entregado ${fmtDate(i.delivered_at)}` : 'Por entregar'}</span>
                <button className="btn sm sec" onClick={() => deliver(i, !i.delivered_at)}>{i.delivered_at ? 'Deshacer' : 'Marcar entregado'}</button>
              </div>
            </div>
          ))}
          <div className="muted small" style={{ marginTop: 6 }}>Costo ADI total: {money(s.cost)}</div>
          <h3 className="small" style={{ marginTop: 10 }}>Pagos</h3>
          {s.pays.length === 0 && <div className="muted small">Aún no hay pagos.</div>}
          {s.pays.map((p) => (
            <div key={p.id} className="list-item row small">
              <span>{fmtDate(p.payment_date)} {p.source === 'tanda' && <span className="badge">Bolsa de tanda</span>}</span>
              <b>{money(p.amount)}</b>
              {p.source === 'tanda'
                ? <span className="muted small">Se revierte eliminando la venta</span>
                : <button className="btn sm danger" onClick={() => delPayment(p)}>Eliminar</button>}
            </div>
          ))}
          <div className="actions"><button className="btn sm danger" onClick={delSale}>Eliminar venta</button></div>
        </div>
      )}
      {paying && <PayModal sale={s} onClose={() => setPaying(false)} />}
    </div>
  );
}

// ---------- Pedidos por entregar ----------
function PorEntregar({ q }) {
  const { sales } = useData();
  const deliver = useDelivery();
  const needle = q.trim().toLowerCase();

  const list = sales
    .filter((s) => s.pendingItems.length > 0)
    .map((s) => ({
      s,
      items: s.pendingItems.filter(
        (i) => !needle || `${s.customer?.name || ''} ${i.product_name} ${i.sku || ''}`.toLowerCase().includes(needle)
      ),
    }))
    .filter((x) => x.items.length > 0)
    .sort((a, b) => (a.s.sale_date < b.s.sale_date ? -1 : 1));

  if (list.length === 0) return <Empty>No hay productos por entregar{needle ? ' con esa búsqueda' : ''}.</Empty>;

  return (
    <>
      <div className="help">Al recibir mercancía de Vianney, busca el SKU para ver a qué cliente le toca.</div>
      {list.map(({ s, items }) => (
        <div key={s.id} className="card">
          <div className="row wrap" style={{ alignItems: 'flex-start' }}>
            <div>
              <h3>{s.customer?.name || 'Cliente'}{s.isTanda ? ' · Tanda' : ''}</h3>
              <div className="muted small">Pedido del {fmtDate(s.sale_date)}</div>
            </div>
            {s.liquidada ? <span className="badge ok">Pagado</span> : <span className="badge warn">Debe {money(s.balance)}</span>}
          </div>
          {items.map((i) => (
            <div key={i.id} className="list-item row small">
              <div style={{ minWidth: 0 }}>
                <b>{i.quantity}× {i.product_name}</b>
                <div className="muted">{i.sku ? `SKU ${i.sku}` : 'Sin SKU'}</div>
              </div>
              <button className="btn sm" onClick={() => deliver(i, true)}>Entregado</button>
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

// ---------- Pantalla Ventas ----------
export default function Ventas() {
  const { sales } = useData();
  const [filter, setFilter] = useState('pendientes');
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);

  const porEntregar = sales.reduce((t, s) => t + s.pendingItems.length, 0);

  const list = sales
    .filter((s) => (filter === 'pendientes' ? !s.liquidada : filter === 'liquidadas' ? s.liquidada : true))
    .filter((s) => {
      const n = q.trim().toLowerCase();
      if (!n) return true;
      const hay = `${s.customer?.name || ''} ${s.description} ${s.items.map((i) => `${i.product_name} ${i.sku || ''}`).join(' ')}`.toLowerCase();
      return hay.includes(n);
    })
    .sort((a, b) => (a.sale_date < b.sale_date ? 1 : -1));

  return (
    <>
      <div className="row">
        <h1>Ventas</h1>
        <button className="btn" onClick={() => setCreating(true)}>+ Nueva venta</button>
      </div>
      <div className="tabs">
        {[['pendientes', 'Por cobrar'], ['entrega', `Por entregar (${porEntregar})`], ['liquidadas', 'Liquidadas'], ['todas', 'Todas']].map(([id, l]) => (
          <button key={id} className={filter === id ? 'active' : ''} onClick={() => setFilter(id)}>{l}</button>
        ))}
      </div>
      <input placeholder="Buscar por cliente, producto o SKU…" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: '.8rem' }} />
      {filter === 'entrega'
        ? <PorEntregar q={q} />
        : list.length === 0 ? <Empty>No hay ventas en esta lista.</Empty> : list.map((s) => <SaleCard key={s.id} s={s} />)}
      {creating && <NewSaleModal onClose={() => setCreating(false)} />}
    </>
  );
}
