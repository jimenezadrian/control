// ---------- Formato ----------
const mxn = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const num = (v) => Number(v) || 0;
export const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const money = (n) => mxn.format(num(n));

// Fecha local de hoy como YYYY-MM-DD (sin desfase por zona horaria)
export function today() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

// 'YYYY-MM-DD' -> 'dd/mm/aaaa'
export function fmtDate(s) {
  if (!s) return '';
  const [y, m, d] = String(s).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

export const monthKey = (s) => String(s || '').slice(0, 7);
export function monthLabel(key) {
  const [y, m] = key.split('-');
  const names = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  return `${names[Number(m) - 1]} ${y}`;
}

// ---------- Errores comprensibles ----------
export function friendlyError(e) {
  const msg = String(e?.message || e || '');
  const code = e?.code;
  if (/Invalid login credentials/i.test(msg)) return 'Correo o contraseña incorrectos.';
  if (/Failed to fetch|NetworkError|network/i.test(msg)) return 'No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo.';
  if (code === 'PGRST205' || code === '42P01' || code === 'PGRST202' || code === '42883' || /schema cache|does not exist/i.test(msg)) {
    return 'Falta aplicar las actualizaciones de la base de datos (migraciones 001, 002 y 003 de la carpeta supabase/migrations). Revisa el README.';
  }
  if (code === '42501' || /row-level security|permission denied/i.test(msg)) return 'No tienes permiso para hacer esto. Vuelve a iniciar sesión.';
  if (code === '23514' || /check constraint/i.test(msg)) return 'Alguno de los valores no está permitido por la base de datos. Revisa los datos capturados.';
  if (code === '23503') return 'No se puede completar porque este registro está relacionado con otros datos.';
  if (code === '23505') return 'Ese registro ya existe.';
  if (code === '23502') return 'Falta un dato obligatorio.';
  return msg || 'Ocurrió un error inesperado.';
}

// ---------- Ventas ----------
// Pagado de una venta = suma de la tabla payments. El anticipo se guarda en
// sales.deposit (referencia) Y como un pago en payments; solo se cuenta payments.
// Un pago con source = 'tanda' es la bolsa de la tanda aplicada a esa venta.
export function computeSales(d) {
  const cust = Object.fromEntries(d.customers.map((c) => [c.id, c]));
  const itemsBy = {};
  d.items.forEach((i) => (itemsBy[i.sale_id] ||= []).push(i));
  return d.sales.map((s) => {
    const pays = d.payments
      .filter((p) => p.sale_id === s.id)
      .sort((a, b) => (a.payment_date + a.created_at < b.payment_date + b.created_at ? -1 : 1));
    const items = (itemsBy[s.id] || [])
      .map((i) => ({
        ...i,
        quantity: num(i.quantity),
        unitCost: num(i.adi_cost),
        unitPrice: num(i.sale_price),
        subCost: r2(num(i.quantity) * num(i.adi_cost)),
        subPrice: r2(num(i.quantity) * num(i.sale_price)),
        subProfit: r2(num(i.quantity) * (num(i.sale_price) - num(i.adi_cost))),
      }))
      .sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
    const paid = r2(pays.reduce((t, p) => t + num(p.amount), 0));
    const paidTanda = r2(pays.filter((p) => p.source === 'tanda').reduce((t, p) => t + num(p.amount), 0));
    const price = items.length ? r2(items.reduce((t, i) => t + i.subPrice, 0)) : num(s.sale_price);
    const cost = items.length ? r2(items.reduce((t, i) => t + i.subCost, 0)) : num(s.adi_cost);
    const balance = r2(price - paid);
    return {
      ...s,
      customer: cust[s.customer_id],
      pays,
      items,
      price,
      cost,
      paid,
      paidTanda,
      paidCliente: r2(paid - paidTanda),
      balance,
      profit: r2(price - cost),
      liquidada: balance <= 0.005,
      isTanda: Boolean(s.savings_period_id),
      pendingItems: items.filter((i) => !i.delivered_at),
    };
  });
}

export function computeCustomers(d, sales) {
  return d.customers
    .map((c) => {
      const mine = sales.filter((s) => s.customer_id === c.id);
      return {
        ...c,
        sales: mine,
        total: r2(mine.reduce((t, s) => t + s.price, 0)),
        paid: r2(mine.reduce((t, s) => t + s.paid, 0)),
        balance: r2(mine.reduce((t, s) => t + Math.max(0, s.balance), 0)),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

// ---------- Tandas (colectivas, por periodo) ----------
// Una tanda = grupo + participantes + periodos. En cada periodo todos aportan el
// importe configurado; la bolsa (aportaciones + excedente que pasa del periodo
// anterior) financia el pedido de quien tiene el turno.
// Las aportaciones SIN periodo (de la versión anterior) se ignoran aquí.
export function computeTandas(d, sales) {
  const saleByPeriod = {};
  sales.filter((s) => s.savings_period_id).forEach((s) => (saleByPeriod[s.savings_period_id] = s));

  return d.groups.map((g) => {
    const parts = d.participants
      .filter((p) => p.group_id === g.id)
      .sort((a, b) => num(a.turn_number) - num(b.turn_number));
    const nPart = num(g.participants_count) || parts.length;
    const amount = num(g.contribution_amount);
    const rawPeriods = d.periods.filter((p) => p.group_id === g.id).sort((a, b) => a.period_number - b.period_number);

    let prev = null;
    const periods = rawPeriods.map((per) => {
      const contribs = d.contributions.filter((c) => c.period_id === per.id);
      const byPart = Object.fromEntries(contribs.map((c) => [c.participant_id, c]));
      const collected = r2(contribs.reduce((t, c) => t + num(c.amount), 0));
      const carryIn = prev && prev.surplus_action === 'Pasa al siguiente periodo' ? num(prev.surplus_amount) : 0;
      const paidCount = parts.filter((p) => byPart[p.id]).length;
      const out = {
        ...per,
        contribs,
        byPart,
        collected,
        carryIn,
        bag: r2(collected + carryIn),
        paidCount,
        expected: r2(nPart * amount),
        missing: r2(Math.max(0, nPart * amount - collected)),
        complete: nPart > 0 && paidCount >= nPart,
        financed: per.status === 'Financiado',
        sale: saleByPeriod[per.id] || null,
        turnHolder: parts.find((p) => num(p.turn_number) === per.period_number) || null,
      };
      prev = per;
      return out;
    });

    const participants = parts.map((p) => ({
      ...p,
      paid: periods.filter((per) => per.byPart[p.id]).length,
      received: periods.some((per) => per.financed && per.beneficiary_participant_id === p.id),
    }));

    return {
      ...g,
      active: String(g.status || '').toLowerCase().startsWith('activ'),
      nPart,
      amount,
      participants,
      periods,
      collected: r2(periods.reduce((t, p) => t + p.collected, 0)),
    };
  });
}

export function computeTandaStats(tandas, hoy = today()) {
  const act = tandas.filter((t) => t.active);
  const periodsAct = act.flatMap((t) => t.periods);
  const due = act.flatMap((t) => t.periods.filter((p) => p.scheduled_date <= hoy).map((p) => ({ t, p })));
  const next = act
    .map((t) => {
      const per = t.periods.find((p) => !p.financed);
      if (!per) return null;
      const who = per.turnHolder || null;
      return { tanda: t.name, period: per.period_number, total: t.periods.length, who: who?.name || 'Sin asignar', date: per.scheduled_date };
    })
    .filter(Boolean);
  return {
    activas: act.length,
    participantes: act.reduce((t, g) => t + g.participants.length, 0),
    periodosFinanciados: periodsAct.filter((p) => p.financed).length,
    bolsasCompletas: periodsAct.filter((p) => p.complete).length,
    recaudado: r2(act.reduce((t, g) => t + g.collected, 0)),
    pendiente: r2(due.reduce((t, { t: g, p }) => t + p.missing, 0)),
    recibieron: act.reduce((t, g) => t + g.participants.filter((p) => p.received).length, 0),
    proximos: next,
  };
}

// ---------- Capital y finanzas ----------
export const CAPITAL_TYPES = ['Aportación', 'Recuperación', 'Retiro de utilidad', 'Gasto'];

export function computeCapital(d, sales) {
  const sum = (t) => r2(d.capital.filter((m) => m.movement_type === t).reduce((a, m) => a + num(m.amount), 0));
  const aportado = sum('Aportación');
  const recuperado = sum('Recuperación');
  const retirado = sum('Retiro de utilidad');
  const gastos = sum('Gasto');
  const invertido = r2(aportado - recuperado);

  const normales = sales.filter((s) => !s.isTanda);
  const detanda = sales.filter((s) => s.isTanda);
  const tot = (arr, f) => r2(arr.reduce((t, s) => t + f(s), 0));

  const cobrado = tot(sales, (s) => s.paid);
  const pendiente = tot(sales, (s) => Math.max(0, s.balance));
  // Utilidad ganada: de lo cobrado en cada venta, lo que pasa del costo ADI.
  const ganada = (s) => Math.max(0, s.paid - s.cost);
  const utilidadGanada = tot(sales, ganada);
  const utilidadEstimada = tot(sales, (s) => s.profit);
  const utilidadDisponible = r2(utilidadGanada - retirado - gastos);

  // Dinero de tandas en resguardo = aportaciones con periodo
  //   - bolsa aplicada a ventas - excedentes devueltos. NO es ingreso ni utilidad.
  const aportaciones = r2(d.contributions.filter((c) => c.period_id).reduce((t, c) => t + num(c.amount), 0));
  const aplicado = tot(sales, (s) => s.paidTanda);
  const devuelto = r2(d.periods.filter((p) => p.surplus_action === 'Devuelto').reduce((t, p) => t + num(p.surplus_amount), 0));
  const resguardo = r2(aportaciones - aplicado - devuelto);

  return {
    aportado, recuperado, retirado, gastos, invertido, cobrado, pendiente,
    utilidadGanada, utilidadEstimada, utilidadDisponible,
    ventasNormales: tot(normales, (s) => s.price),
    ventasTanda: tot(detanda, (s) => s.price),
    ventasTotal: tot(sales, (s) => s.price),
    utilidadTandaEsperada: tot(detanda, (s) => s.profit),
    utilidadTandaGanada: tot(detanda, ganada),
    aportaciones, aplicado, devuelto, resguardo,
  };
}
