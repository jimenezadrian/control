// Utilidades de búsqueda de clientes (sin React, para poder probarlas aparte).

// Escapa los comodines de LIKE para que "50%" o "a_b" se busquen tal cual.
export function escapeLike(text) {
  return String(text).replace(/[\\%_]/g, (c) => `\\${c}`);
}

// Patrón para ilike: coincidencia parcial en cualquier parte del nombre.
export function likePattern(text) {
  return `%${escapeLike(String(text).trim().replace(/\s+/g, ' '))}%`;
}

// ¿Ya existe un cliente con exactamente este nombre (sin importar mayúsculas)?
export function hasExactName(list, text) {
  const t = String(text).trim().toLowerCase();
  return Boolean(t) && list.some((c) => String(c.name).trim().toLowerCase() === t);
}

export const SEARCH_LIMIT = 8;
export const DEBOUNCE_MS = 250;
