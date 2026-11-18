import React, { useMemo, useState } from 'react';
import { useData } from '../data.jsx';
import { Stat } from '../ui.jsx';
import { computeTandaStats, fmtDate, money, monthKey, monthLabel, num, r2, today } from '../utils.js';

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
  const { raw, sales, customers, capital: c, tandas } = useData();
  const [month, setMonth] = useState(today().slice(0, 7));

  const t = useMemo(() => computeTandaStats(tandas), [tandas]);

  const k = useMemo(() => {
    const inMonth = sales.filter((s) => monthKey(s.sale_date) === month);
    const ids = new Set(inMonth.map((s) => s.id));
    const sum = (arr, f) => r2(arr.reduce((a, x) => a + f(x), 0));
    const salesIds = new Set(sales.map((s) => s.id));
    return {
      count: inMonth.length,
      normales: sum(inMonth.filter((s) => !s.isTanda), (s) => s.price),
      tanda: sum(inMonth.filter((s) => s.isTanda), (s) => s.price),
      total: sum(inMonth, (s) => s.price),
      utilidad: sum(inMonth, (s) => s.profit),
      utilidadTanda: sum(inMonth.filter((s) => s.isTanda), (s) => s.profit),
      cobrado: r2(raw.payments.filter((p) => salesIds.has(p.sale_id) && monthKey(p.payment_date) === month).reduce((a, p) => a + num(p.amount), 0)),
      porEntregar: sales.reduce((a, s) => a + s.pendingItems.length, 0),
      ids,
    };
  }, [raw, sales, month]);

  const activity = useMemo(() => {
    const cust = Object.fromEntries(raw.customers.map((x) => [x.id, x.name]));
    const saleById = Object.fromEntries(sales.map((s) => [s.id, s]));
    const part = Object.fromEntries(raw.participants.map((p) => [p.id, p.name]));
    const items = [];
    raw.payments.forEach((p) => items.push({
      at: p.created_at,
      text: p.source === 'tanda' ? `Bolsa de tanda aplicada a ${cust[saleById[p.sale_id]?.customer_id] || 'pedido'}` : `Pago de ${cust[saleById[p.sale_id]?.customer_id] || 'cliente'}`,
      amount: p.amount, date: p.payment_date,
    }));
    raw.sales.forEach((s) => items.push({ at: s.created_at, text: `${s.savings_period_id ? 'Pedido de tanda' : 'Venta'} a ${cust[s.customer_id] || 'cliente'}`, amount: saleById[s.id]?.price ?? s.sale_price, date: s.sale_date }));
    raw.contributions.filter((x) => x.period_id).forEach((x) => items.push({ at: x.created_at, text: `Aportación de ${part[x.participant_id] || 'participante'} (${x.period_label || 'tanda'})`, amount: x.amount, date: x.contribution_date }));
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

      <h2 style={{ marginTop: 0 }}>Ventas del mes ({k.count})</h2>
      <div className="grid">
        <Stat label="Ventas normales" value={money(k.normales)} />
        <Stat label="Ventas de tandas" value={money(k.tanda)} />
        <Stat label="Total de ventas" value={money(k.total)} />
        <Stat label="Cobrado en el mes" value={money(k.cobrado)} tone="ok" />
        <Stat label="Utilidad esperada del mes" value={money(k.utilidad)} />
        <Stat label="…de ventas de tandas" value={money(k.utilidadTanda)} />
        <Stat label="Pendiente de cobrar (total)" value={money(c.pendiente)} tone="warn" />
        <Stat label="Productos por entregar" value={k.porEntregar} />
      </div>

      <h2>Tandas</h2>
      <div className="grid">
        <Stat label="Tandas activas" value={t.activas} />
        <Stat label="Participantes" value={t.participantes} />
        <Stat label="Fechas con pedido" value={t.periodosFinanciados} />
        <Stat label="Bolsas completas" value={t.bolsasCompletas} />
        <Stat label="Aportaciones recaudadas" value={money(t.recaudado)} tone="ok" />
        <Stat label="Aportaciones pendientes (fechas vencidas)" value={money(t.pendiente)} tone="warn" />
        <Stat label="Ya recibieron su pedido" value={t.recibieron} />
        <Stat label="Dinero de tandas en resguardo" value={money(c.resguardo)} />
      </div>
      {t.proximos.length > 0 && (
        <div className="card" style={{ marginTop: '.8rem' }}>
          <b>Próximo turno</b>
          {t.proximos.map((x, i) => (
            <div key={i} className="list-item small">
              {x.tanda}: fecha {x.period} de {x.total} · <b>{x.who}</b> · {fmtDate(x.date)}
            </div>
          ))}
        </div>
      )}

      <h2>Finanzas</h2>
      <div className="grid">
        <Stat label="Capital propio aportado" value={money(c.aportado)} />
        <Stat label="Capital recuperado" value={money(c.recuperado)} />
        <Stat label="Capital pendiente de recuperar" value={money(c.invertido)} tone="warn" />
        <Stat label="Utilidad esperada (todas)" value={money(c.utilidadEstimada)} />
        <Stat label="Utilidad obtenida (ya cobrada)" value={money(c.utilidadGanada)} tone="ok" />
        <Stat label="Utilidad de ventas de tandas (obtenida)" value={money(c.utilidadTandaGanada)} />
        <Stat label="Retiros de utilidad" value={money(c.retirado)} />
        <Stat label="Gastos" value={money(c.gastos)} />
      </div>
      <div className="help" style={{ marginTop: '.8rem' }}>
        Las aportaciones de una tanda no son ingreso ni utilidad: solo cuentan como cobrado cuando la bolsa se aplica a un pedido, y la utilidad sale de precio de venta − costo ADI. Clientes: {customers.length}.
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
