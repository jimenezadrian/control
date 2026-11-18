// Indicadores del dashboard para un periodo [from, to] (ambos incluidos).
//
// Reglas:
//  - Flujos (ventas, pagos, aportaciones, gastos...) usan SIEMPRE la fecha real del
//    movimiento (sale_date, payment_date, contribution_date, movement_date),
//    nunca created_at.
//  - Saldos acumulados (pendiente de cobrar, capital por recuperar, resguardo de tandas,
//    utilidad disponible) se muestran "al cierre del periodo": todo lo ocurrido hasta `to`.
//  - Una aportación de tanda NO es cobro ni utilidad. Solo los pagos de `payments`
//    (clientes o bolsa aplicada) cuentan como cobrado, y cada pago se cuenta una vez.
import { num, r2, today } from './utils.js';
import { addDays, buildBuckets, day } from './period.js';

const sum = (arr, f) => r2(arr.reduce((a, x) => a + f(x), 0));

export function computePeriodStats(d, sales, tandas, { from, to }, hoy = today()) {
  const inR = (s) => day(s) >= from && day(s) <= to;
  const upTo = (s) => day(s) <= to;
  const saleById = Object.fromEntries(sales.map((s) => [s.id, s]));

  // ----- Ventas del periodo (por fecha de venta)
  const vPer = sales.filter((s) => inR(s.sale_date));
  const vTanda = vPer.filter((s) => s.isTanda);
  const vNormal = vPer.filter((s) => !s.isTanda);

  // ----- Pagos del periodo (por fecha de pago), solo de ventas existentes
  const pays = d.payments.filter((p) => saleById[p.sale_id]);
  const pPer = pays.filter((p) => inR(p.payment_date));
  const isBolsa = (p) => p.source === 'tanda';
  const cobrado = sum(pPer, (p) => num(p.amount));
  const cobradoBolsa = sum(pPer.filter(isBolsa), (p) => num(p.amount));
  const cobradoClientes = r2(cobrado - cobradoBolsa);

  // ----- Utilidad obtenida: lo cobrado que rebasa el costo ADI, acumulado por fecha.
  // earned(venta, fecha) = max(0, pagado hasta esa fecha - costo). La del periodo es
  // earned(to) - earned(día anterior a from), así los periodos suman exacto el total.
  const dayBefore = addDays(from, -1);
  const paidThrough = (s, date) => sum(pays.filter((p) => p.sale_id === s.id && day(p.payment_date) <= date), (p) => num(p.amount));
  const earned = (s, date) => Math.max(0, paidThrough(s, date) - s.cost);
  const earnedPeriod = (s) => r2(earned(s, to) - earned(s, dayBefore));
  const utilidadObtenida = sum(sales, earnedPeriod);
  const utilidadObtenidaTanda = sum(sales.filter((s) => s.isTanda), earnedPeriod);
  const earnedTotalToDate = sum(sales, (s) => earned(s, to));

  // ----- Pendiente de cobrar al cierre: ventas hechas hasta `to` menos pagos hasta `to`
  const pendiente = sum(sales.filter((s) => upTo(s.sale_date)), (s) => Math.max(0, s.price - paidThrough(s, to)));

  // ----- Capital (movimientos por fecha de movimiento)
  const cap = d.capital;
  const capIn = (t) => sum(cap.filter((m) => m.movement_type === t && inR(m.movement_date)), (m) => num(m.amount));
  const capUpTo = (t) => sum(cap.filter((m) => m.movement_type === t && upTo(m.movement_date)), (m) => num(m.amount));
  const aportado = capIn('Aportación');
  const recuperado = capIn('Recuperación');
  const retirado = capIn('Retiro de utilidad');
  const gastos = capIn('Gasto');
  const capitalPendiente = r2(capUpTo('Aportación') - capUpTo('Recuperación'));
  const utilidadDisponible = r2(earnedTotalToDate - capUpTo('Retiro de utilidad') - capUpTo('Gasto'));

  // ----- Tandas
  const contribs = d.contributions.filter((c) => c.period_id);
  const cPer = contribs.filter((c) => inR(c.contribution_date));
  const aportacionesRecaudadas = sum(cPer, (c) => num(c.amount));

  const activas = tandas.filter((t) => t.active);
  const limit = to < hoy ? to : hoy; // solo fechas ya vencidas cuentan como pendientes
  let pendientesAport = 0; let bolsasCompletas = 0;
  activas.forEach((t) => t.periods.forEach((p) => {
    if (!inR(p.scheduled_date)) return;
    const cs = p.contribs.filter((c) => upTo(c.contribution_date));
    const col = sum(cs, (c) => num(c.amount));
    const completos = new Set(cs.map((c) => c.participant_id)).size;
    if (t.nPart > 0 && completos >= t.nPart) bolsasCompletas += 1;
    if (day(p.scheduled_date) <= limit) pendientesAport += Math.max(0, p.expected - col);
  }));
  pendientesAport = r2(pendientesAport);

  const receptores = new Set(vTanda.map((s) => s.beneficiary_participant_id).filter(Boolean)).size;

  // Resguardo al cierre = aportaciones - bolsa aplicada - excedentes devueltos (hasta `to`)
  const saleByPeriod = Object.fromEntries(sales.filter((s) => s.isTanda).map((s) => [s.savings_period_id, s]));
  const aplicadoHasta = sum(pays.filter((p) => isBolsa(p) && upTo(p.payment_date)), (p) => num(p.amount));
  const devueltoHasta = sum(
    d.periods.filter((p) => p.surplus_action === 'Devuelto' && saleByPeriod[p.id] && upTo(saleByPeriod[p.id].sale_date)),
    (p) => num(p.surplus_amount),
  );
  const resguardo = r2(sum(contribs.filter((c) => upTo(c.contribution_date)), (c) => num(c.amount)) - aplicadoHasta - devueltoHasta);

  // ----- Gráfica: ventas (fecha de venta) y cobros (fecha de pago) por cubeta
  const buckets = buildBuckets(from, to).map((b) => ({
    ...b,
    ventas: sum(vPer.filter((s) => day(s.sale_date) >= b.start && day(s.sale_date) <= b.end), (s) => s.price),
    cobrado: sum(pPer.filter((p) => day(p.payment_date) >= b.start && day(p.payment_date) <= b.end), (p) => num(p.amount)),
  }));

  return {
    ventas: {
      cantidad: vPer.length,
      normales: sum(vNormal, (s) => s.price),
      tandas: sum(vTanda, (s) => s.price),
      total: sum(vPer, (s) => s.price),
      pedidosTanda: vTanda.length,
    },
    cobros: { total: cobrado, clientes: cobradoClientes, bolsa: cobradoBolsa, pendiente },
    utilidad: {
      esperada: sum(vPer, (s) => s.profit),
      esperadaTanda: sum(vTanda, (s) => s.profit),
      obtenida: utilidadObtenida,
      obtenidaTanda: utilidadObtenidaTanda,
      disponible: utilidadDisponible,
    },
    tandas: {
      aportaciones: aportacionesRecaudadas,
      pendientes: pendientesAport,
      bolsasCompletas,
      bolsaAplicada: cobradoBolsa,
      receptores,
      resguardo,
    },
    capital: { aportado, recuperado, retirado, gastos, pendiente: capitalPendiente },
    buckets,
    actividad: activityInRange(d, saleById, from, to),
  };
}

// Movimientos del periodo, del más reciente al más antiguo (por fecha real del movimiento).
export function activityInRange(d, saleById, from, to) {
  const inR = (s) => day(s) >= from && day(s) <= to;
  const cust = Object.fromEntries(d.customers.map((x) => [x.id, x.name]));
  const part = Object.fromEntries(d.participants.map((p) => [p.id, p.name]));
  const items = [];
  d.payments.filter((p) => inR(p.payment_date)).forEach((p) => {
    const who = cust[saleById[p.sale_id]?.customer_id];
    items.push({ at: p.created_at, date: p.payment_date, amount: p.amount, text: p.source === 'tanda' ? `Bolsa de tanda aplicada a ${who || 'pedido'}` : `Pago de ${who || 'cliente'}` });
  });
  d.sales.filter((s) => inR(s.sale_date)).forEach((s) => {
    items.push({ at: s.created_at, date: s.sale_date, amount: saleById[s.id]?.price ?? s.sale_price, text: `${s.savings_period_id ? 'Pedido de tanda' : 'Venta'} a ${cust[s.customer_id] || 'cliente'}` });
  });
  d.contributions.filter((c) => c.period_id && inR(c.contribution_date)).forEach((c) => {
    items.push({ at: c.created_at, date: c.contribution_date, amount: c.amount, text: `Aportación de ${part[c.participant_id] || 'participante'} (${c.period_label || 'tanda'})` });
  });
  d.capital.filter((m) => inR(m.movement_date)).forEach((m) => {
    items.push({ at: m.created_at, date: m.movement_date, amount: m.amount, text: m.movement_type });
  });
  return items
    .sort((a, b) => (day(a.date) === day(b.date) ? (a.at < b.at ? 1 : -1) : day(a.date) < day(b.date) ? 1 : -1))
    .slice(0, 12);
}
