import React, { useMemo, useState } from 'react';
import { useData } from '../data.jsx';
import { Empty, Field, Stat } from '../ui.jsx';
import { PRESETS, lastMonthKeys, monthName, resolvePeriod, validateRange } from '../period.js';
import { computePeriodStats } from '../stats.js';
import { computeTandaStats, fmtDate, money, today } from '../utils.js';

const KEY = 'vianney_dashboard_periodo';
function loadSel() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && PRESETS.some(([id]) => id === s.preset)) return s;
  } catch { /* sin almacenamiento: se usa el valor por defecto */ }
  return { preset: 'mes' };
}
function saveSel(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignorar */ }
}

function Chart({ buckets }) {
  const max = Math.max(...buckets.flatMap((b) => [b.ventas, b.cobrado]), 0);
  if (!buckets.length) return <div className="muted">El periodo es muy largo para graficarlo; elige uno más corto.</div>;
  if (max <= 0) return <div className="muted">Sin ventas ni cobros en este periodo.</div>;
  const step = buckets.length > 16 ? Math.ceil(buckets.length / 8) : 1;
  return (
    <>
      <div className="legend">
        <span><i style={{ background: 'var(--chart-1)' }} />Ventas</span>
        <span><i style={{ background: 'var(--chart-2)' }} />Cobrado</span>
      </div>
      <div className="chart" role="img" aria-label="Ventas y cobros del periodo">
        {buckets.map((b, i) => (
          <div className="col" key={i} title={`${b.label}: ventas ${money(b.ventas)} · cobrado ${money(b.cobrado)}`}>
            <div className="bar a" style={{ height: `${(b.ventas / max) * 100}%` }} />
            <div className="bar b" style={{ height: `${(b.cobrado / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="chart-x">
        {buckets.map((b, i) => <span key={i}>{i % step === 0 ? b.label : ''}</span>)}
      </div>
    </>
  );
}

export default function Dashboard({ go }) {
  const { raw, sales, customers, tandas } = useData();
  const hoy = today();
  const [sel, setSel] = useState(loadSel);
  const [draft, setDraft] = useState({ from: sel.from || '', to: sel.to || '' });
  const [rangeError, setRangeError] = useState('');

  const period = useMemo(() => resolvePeriod(sel, hoy), [sel, hoy]);
  const stats = useMemo(
    () => (period.error ? null : computePeriodStats(raw, sales, tandas, period, hoy)),
    [raw, sales, tandas, period, hoy],
  );
  const now = useMemo(() => computeTandaStats(tandas, hoy), [tandas, hoy]);
  const porEntregar = useMemo(() => sales.reduce((a, s) => a + s.pendingItems.length, 0), [sales]);

  const update = (next) => { setSel(next); saveSel(next); setRangeError(''); };

  function onPreset(preset) {
    if (preset === 'personalizado') {
      // Arranca con el rango que se estaba viendo para que las cifras no desaparezcan.
      const from = sel.from && sel.to ? sel.from : period.from;
      const to = sel.from && sel.to ? sel.to : period.to;
      setDraft({ from, to });
      update({ ...sel, preset, from, to });
    } else {
      update({ ...sel, preset });
    }
  }
  function applyRange() {
    const err = validateRange(draft.from, draft.to);
    if (err) return setRangeError(err);
    update({ ...sel, preset: 'personalizado', from: draft.from, to: draft.to });
  }

  const k = stats;
  return (
    <>
      <h1>Resumen</h1>

      <div className="period-box">
        <Field label="Periodo">
          <select value={sel.preset} onChange={(e) => onPreset(e.target.value)}>
            {PRESETS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </Field>

        {sel.preset === 'mes_elegido' && (
          <Field label="Mes">
            <select value={sel.month || hoy.slice(0, 7)} onChange={(e) => update({ ...sel, month: e.target.value })}>
              {lastMonthKeys(24, hoy).map((m) => <option key={m} value={m}>{monthName(m)}</option>)}
            </select>
          </Field>
        )}

        {sel.preset === 'personalizado' && (
          <>
            <div className="two">
              <Field label="Desde"><input type="date" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} /></Field>
              <Field label="Hasta"><input type="date" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} /></Field>
            </div>
            {rangeError && <div className="err-box">{rangeError}</div>}
            <button className="btn block" onClick={applyRange}>Aplicar</button>
          </>
        )}

        {period.error ? (
          <div className="period-banner">Elige las dos fechas y pulsa <b>Aplicar</b>.</div>
        ) : (
          <div className="period-banner">
            <span>Mostrando:</span>
            <b>{period.label}</b>
            <span className="muted">({period.days} {period.days === 1 ? 'día' : 'días'})</span>
          </div>
        )}
      </div>

      {!k ? <Empty>Elige un rango de fechas para ver los indicadores.</Empty> : (
        <>
          <h2 style={{ marginTop: 0 }}>Ventas y cobros ({k.ventas.cantidad} {k.ventas.cantidad === 1 ? 'venta' : 'ventas'})</h2>
          <div className="grid">
            <Stat label="Ventas normales" value={money(k.ventas.normales)} />
            <Stat label="Ventas de tandas" value={money(k.ventas.tandas)} />
            <Stat label="Total de ventas" value={money(k.ventas.total)} />
            <Stat label="Dinero cobrado" value={money(k.cobros.total)} tone="ok" />
            <Stat label="…pagos y abonos de clientes" value={money(k.cobros.clientes)} />
            <Stat label="…bolsa de tandas aplicada" value={money(k.cobros.bolsa)} />
            <Stat label={`Pendiente de cobrar al ${fmtDate(period.to)}`} value={money(k.cobros.pendiente)} tone="warn" />
          </div>

          <h2>Utilidad</h2>
          <div className="grid">
            <Stat label="Utilidad esperada (ventas del periodo)" value={money(k.utilidad.esperada)} />
            <Stat label="…de ventas de tandas" value={money(k.utilidad.esperadaTanda)} />
            <Stat label="Utilidad obtenida en el periodo" value={money(k.utilidad.obtenida)} tone="ok" />
            <Stat label="…de ventas de tandas" value={money(k.utilidad.obtenidaTanda)} />
          </div>

          <h2>Tandas en el periodo</h2>
          <div className="grid">
            <Stat label="Aportaciones recaudadas" value={money(k.tandas.aportaciones)} tone="ok" />
            <Stat label="Aportaciones pendientes (fechas vencidas)" value={money(k.tandas.pendientes)} tone="warn" />
            <Stat label="Fechas con bolsa completa" value={k.tandas.bolsasCompletas} />
            <Stat label="Pedidos financiados con tanda" value={k.ventas.pedidosTanda} />
            <Stat label="Bolsa aplicada a pedidos" value={money(k.tandas.bolsaAplicada)} />
            <Stat label="Participantes que recibieron pedido" value={k.tandas.receptores} />
            <Stat label={`Dinero de tandas en resguardo al ${fmtDate(period.to)}`} value={money(k.tandas.resguardo)} />
          </div>

          <h2>Capital</h2>
          <div className="grid">
            <Stat label="Capital propio aportado" value={money(k.capital.aportado)} />
            <Stat label="Capital recuperado" value={money(k.capital.recuperado)} />
            <Stat label={`Capital pendiente de recuperar al ${fmtDate(period.to)}`} value={money(k.capital.pendiente)} tone="warn" />
            <Stat label="Retiros de utilidad" value={money(k.capital.retirado)} />
            <Stat label="Gastos" value={money(k.capital.gastos)} />
            <Stat label={`Utilidad disponible al ${fmtDate(period.to)}`} value={money(k.utilidad.disponible)} tone="ok" />
          </div>
          <div className="help" style={{ marginTop: '.8rem' }}>
            Las cifras del periodo usan la fecha real de cada venta, pago, aportación o movimiento. Los saldos marcados “al {fmtDate(period.to)}” acumulan todo lo ocurrido hasta esa fecha.
            Las aportaciones de una tanda no son ingreso ni utilidad: solo cuentan como cobrado cuando la bolsa se aplica a un pedido.
          </div>

          <h2>Ventas y cobros por {k.buckets[0] && k.buckets[0].start === k.buckets[0].end ? 'día' : 'periodo'}</h2>
          <div className="card"><Chart buckets={k.buckets} /></div>
        </>
      )}

      <h2>Situación actual <span className="muted" style={{ fontFamily: 'var(--font-body)', fontWeight: 400 }}>(no depende del periodo)</span></h2>
      <div className="grid">
        <Stat label="Tandas activas" value={now.activas} />
        <Stat label="Participantes" value={now.participantes} />
        <Stat label="Clientes" value={customers.length} />
        <Stat label="Productos por entregar" value={porEntregar} />
      </div>
      {now.proximos.length > 0 && (
        <div className="card" style={{ marginTop: '.8rem' }}>
          <b>Próximo turno</b>
          {now.proximos.map((x, i) => (
            <div key={i} className="list-item small">
              {x.tanda}: fecha {x.period} de {x.total} · <b>{x.who}</b> · {fmtDate(x.date)}
            </div>
          ))}
        </div>
      )}

      <div className="actions">
        <button className="btn" onClick={() => go('ventas')}>Ver ventas</button>
        <button className="btn sec" onClick={() => go('tandas')}>Ver tandas</button>
      </div>

      {k && (
        <>
          <h2>Movimientos del periodo</h2>
          <div className="card">
            {k.actividad.length === 0 && <div className="muted">No hay movimientos en este periodo.</div>}
            {k.actividad.map((a, i) => (
              <div key={i} className="list-item row small">
                <div>{a.text}<div className="muted">{fmtDate(a.date)}</div></div>
                <b>{money(a.amount)}</b>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
