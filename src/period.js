// Periodos del dashboard. Todo trabaja con fechas solo-día 'YYYY-MM-DD'
// (comparables como texto) para evitar desfases de zona horaria.
import { today } from './utils.js';

const pad = (n) => String(n).padStart(2, '0');
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export const day = (s) => String(s || '').slice(0, 10);

export function addDays(s, n) {
  const [y, m, d] = day(s).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
export function diffDays(a, b) { // b - a, en días
  const f = (s) => { const [y, m, d] = day(s).split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((f(b) - f(a)) / 86400000);
}
export const monthStart = (s) => `${day(s).slice(0, 7)}-01`;
export function monthEnd(s) {
  const [y, m] = day(s).split('-').map(Number);
  return addDays(`${m === 12 ? y + 1 : y}-${pad(m === 12 ? 1 : m + 1)}-01`, -1);
}

// '2026-10-25' -> '25 de octubre de 2026'
export function longDate(s) {
  const [y, m, d] = day(s).split('-').map(Number);
  return `${d} de ${MESES[m - 1]} de ${y}`;
}
export function monthName(key) {
  const [y, m] = key.split('-');
  return `${MESES[Number(m) - 1]} ${y}`;
}
export function lastMonthKeys(n, hoy = today()) {
  const out = [];
  let [y, m] = hoy.split('-').map(Number);
  for (let i = 0; i < n; i++) {
    out.push(`${y}-${pad(m)}`);
    m -= 1;
    if (m === 0) { m = 12; y -= 1; }
  }
  return out;
}

export const PRESETS = [
  ['mes', 'Este mes'],
  ['mes_anterior', 'Mes anterior'],
  ['7', 'Últimos 7 días'],
  ['15', 'Últimos 15 días'],
  ['30', 'Últimos 30 días'],
  ['anio', 'Este año'],
  ['mes_elegido', 'Otro mes…'],
  ['personalizado', 'Rango personalizado'],
];

export function validateRange(from, to) {
  if (!from || !to) return 'Elige la fecha inicial y la fecha final.';
  if (from > to) return 'La fecha inicial no puede ser posterior a la final.';
  return '';
}

// sel = { preset, month ('YYYY-MM'), from, to } -> { from, to, days, label, error }
export function resolvePeriod(sel, hoy = today()) {
  let from; let to; let error = '';
  switch (sel.preset) {
    case 'mes': from = monthStart(hoy); to = monthEnd(hoy); break;
    case 'mes_anterior': { const e = addDays(monthStart(hoy), -1); from = monthStart(e); to = e; break; }
    case '7': case '15': case '30': from = addDays(hoy, -(Number(sel.preset) - 1)); to = hoy; break;
    case 'anio': from = `${hoy.slice(0, 4)}-01-01`; to = `${hoy.slice(0, 4)}-12-31`; break;
    case 'mes_elegido': { const k = sel.month || hoy.slice(0, 7); from = `${k}-01`; to = monthEnd(from); break; }
    case 'personalizado': from = sel.from; to = sel.to; error = validateRange(from, to); break;
    default: from = monthStart(hoy); to = monthEnd(hoy);
  }
  if (error) return { from, to, days: 0, label: '', error };
  return { from, to, days: diffDays(from, to) + 1, label: `${longDate(from)} al ${longDate(to)}`, error };
}

// Cubetas para la gráfica: por día (≤31 días), por semana (≤126) o por mes.
export function buildBuckets(from, to) {
  const days = diffDays(from, to) + 1;
  const out = [];
  if (days <= 31) {
    for (let d = from; d <= to; d = addDays(d, 1)) out.push({ start: d, end: d, label: d.slice(8) });
  } else if (days <= 126) {
    for (let d = from; d <= to; d = addDays(d, 7)) {
      const end = addDays(d, 6) > to ? to : addDays(d, 6);
      out.push({ start: d, end, label: `${d.slice(8)}/${d.slice(5, 7)}` });
    }
  } else {
    for (let d = monthStart(from); d <= to; d = addDays(monthEnd(d), 1)) {
      const start = d < from ? from : d;
      const end = monthEnd(d) > to ? to : monthEnd(d);
      out.push({ start, end, label: MESES[Number(d.slice(5, 7)) - 1].slice(0, 3) });
    }
  }
  return out.length > 60 ? [] : out;
}
