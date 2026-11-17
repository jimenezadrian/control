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
  if (code === '42501' || /row-level security|permission denied/i.test(msg)) return 'No tienes permiso para hacer esto. Vuelve a iniciar sesión.';
  if (code === '23514' || /check constraint/i.test(msg)) return 'Alguno de los valores no está permitido por la base de datos. Revisa los datos capturados.';
  if (code === '23503') return 'No se puede completar porque este registro está relacionado con otros datos.';
  if (code === '23505') return 'Ese registro ya existe.';
  if (code === '23502') return 'Falta un dato obligatorio.';
  return msg || 'Ocurrió un error inesperado.';
}

// ---------- Cálculos ----------
// Pagado de una venta = suma de la tabla payments. El anticipo se guarda en
// sales.deposit (referencia) Y como un pago en payments; solo se cuenta payments.
export function computeSales(d) {
  const cust = Object.fromEntries(d.customers.map((c) => [c.id, c]));
  return d.sales.map((s) => {
    const pays = d.payments
      .filter((p) => p.sale_id === s.id)
      .sort((a, b) => (a.payment_date + a.created_at < b.payment_date + b.created_at ? -1 : 1));
    const paid = r2(pays.reduce((t, p) => t + num(p.amount), 0));
    const price = num(s.sale_price);
    const cost = num(s.adi_cost);
    const balance = r2(price - paid);
    return {
      ...s,
      customer: cust[s.customer_id],
      pays,
      price,
      cost,
      paid,
      balance,
      profit: r2(price - cost),
      liquidada: balance <= 0.005,
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

export function computeParticipants(d) {
  return d.participants.map((p) => {
    const contribs = d.contributions
      .filter((c) => c.participant_id === p.id)
      .sort((a, b) => (a.contribution_date < b.contribution_date ? 1 : -1));
    const purchases = d.purchases
      .filter((c) => c.participant_id === p.id)
      .sort((a, b) => (a.purchase_date < b.purchase_date ? 1 : -1));
    const contributed = r2(contribs.reduce((t, c) => t + num(c.amount), 0));
    const used = r2(purchases.reduce((t, c) => t + num(c.balance_used), 0));
    const extra = r2(purchases.reduce((t, c) => t + num(c.extra_paid), 0));
    return { ...p, contribs, purchases, contributed, used, extra, saldo: r2(contributed - used) };
  });
}

export const CAPITAL_TYPES = ['Aportación', 'Recuperación', 'Retiro de utilidad', 'Gasto'];

export function computeCapital(d, sales) {
  const sum = (t) => r2(d.capital.filter((m) => m.movement_type === t).reduce((a, m) => a + num(m.amount), 0));
  const aportado = sum('Aportación');
  const recuperado = sum('Recuperación');
  const retirado = sum('Retiro de utilidad');
  const gastos = sum('Gasto');
  const invertido = r2(aportado - recuperado);
  const cobrado = r2(sales.reduce((t, s) => t + s.paid, 0));
  const pendiente = r2(sales.reduce((t, s) => t + Math.max(0, s.balance), 0));
  // Utilidad ganada (ya cobrada): de lo cobrado en cada venta, lo que pasa del costo ADI.
  const utilidadGanada = r2(sales.reduce((t, s) => t + Math.max(0, s.paid - s.cost), 0));
  const utilidadEstimada = r2(sales.reduce((t, s) => t + s.profit, 0));
  const utilidadDisponible = r2(utilidadGanada - retirado - gastos);
  return { aportado, recuperado, retirado, gastos, invertido, cobrado, pendiente, utilidadGanada, utilidadEstimada, utilidadDisponible };
}
