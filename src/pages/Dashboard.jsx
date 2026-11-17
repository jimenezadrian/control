import React, { useMemo, useState } from 'react';
import { useData } from '../data.jsx';
import { Stat } from '../ui.jsx';
import { fmtDate, money, monthKey, monthLabel, num, r2, today } from '../utils.js';

function lastMonths(n) {
  const out = [];
  const d = new Date();
  d.setDate(1);
  for (let i = 0; i < n; i++) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}

export default function Dashboard({ go }) {
  const { raw, sales, customers, capital } = useData();
  const [month, setMonth] = useState(today().slice(0, 7));

  const k = useMemo(() => {
    const inMonth = sales.filter((s) => monthKey(s.sale_date) === month);
    const vendido = r2(inMonth.reduce((t, s) => t + s.price, 0));
    const utilidad = r2(inMonth.reduce((t, s) => t + s.profit, 0));
    const salesIds = new Set(sales.map((s) => s.id));
    const cobrado = r2(raw.payments.filter((p) => salesIds.has(p.sale_id) && monthKey(p.payment_date) === month).reduce((t, p) => t + num(p.amount), 0));
    const activas = raw.groups.filter((g) => String(g.status || '').toLowerCase().startsWith('activ')).length;
    return { count: inMonth.length, vendido, utilidad, cobrado, activas };
  }, [raw, sales, month]);

  const activity = useMemo(() => {
    const cust = Object.fromEntries(raw.customers.map((c) => [c.id, c.name]));
    const saleById = Object.fromEntries(sales.map((s) => [s.id, s]));
    const part = Object.fromEntries(raw.participants.map((p) => [p.id, p.name]));
    const items = [];
    raw.payments.forEach((p) => items.push({ at: p.created_at, text: `Pago de ${cust[saleById[p.sale_id]?.customer_id] || 'cliente'}`, amount: p.amount, date: p.payment_date }));
    raw.sales.forEach((s) => items.push({ at: s.created_at, text: `Venta a ${cust[s.customer_id] || 'cliente'}`, amount: s.sale_price, date: s.sale_date }));
    raw.contributions.forEach((c) => items.push({ at: c.created_at, text: `Aportación de ${part[c.participant_id] || 'participante'}`, amount: c.amount, date: c.contribution_date }));
    raw.purchases.forEach((c) => items.push({ at: c.created_at, text: `Compra de ${part[c.participant_id] || 'participante'} (tanda)`, amount: num(c.balance_used) + num(c.extra_paid), date: c.purchase_date }));
    raw.capital.forEach((m) => items.push({ at: m.created_at, text: m.movement_type, amount: m.amount, date: m.movement_date }));
    return items.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 10);
  }, [raw, sales]);

  return (
    <>
      <div className="row">
        <h1>Resumen</h1>
        <select value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: 'auto' }}>
          {lastMonths(12).map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
      </div>

      <h2 style={{ marginTop: 0 }}>Del mes ({k.count} venta{k.count === 1 ? '' : 's'})</h2>
      <div className="grid">
        <Stat label="Ventas del mes" value={money(k.vendido)} />
        <Stat label="Cobrado en el mes" value={money(k.cobrado)} tone="ok" />
        <Stat label="Utilidad estimada del mes" value={money(k.utilidad)} />
        <Stat label="Pendiente de cobrar (total)" value={money(capital.pendiente)} tone="warn" />
      </div>

      <h2>En general</h2>
      <div className="grid">
        <Stat label="Capital invertido" value={money(capital.invertido)} />
        <Stat label="Tandas activas" value={k.activas} />
        <Stat label="Clientes" value={customers.length} />
        <Stat label="Utilidad disponible" value={money(capital.utilidadDisponible)} tone="ok" />
      </div>

      <div className="actions">
        <button className="btn" onClick={() => go('ventas')}>Ver ventas</button>
        <button className="btn sec" onClick={() => go('tandas')}>Ver tandas</button>
      </div>

      <h2>Actividad reciente</h2>
      <div className="card">
        {activity.length === 0 && <div className="muted">Todavía no hay movimientos.</div>}
        {activity.map((a, i) => (
          <div key={i} className="list-item row small">
            <div>{a.text}<div className="muted">{fmtDate(a.date)}</div></div>
            <b>{money(a.amount)}</b>
          </div>
        ))}
      </div>
    </>
  );
}
