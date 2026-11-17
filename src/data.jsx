import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from './supabase.js';
import { computeCapital, computeCustomers, computeParticipants, computeSales, friendlyError } from './utils.js';

const Ctx = createContext(null);
export const useData = () => useContext(Ctx);

const EMPTY = {
  customers: [], sales: [], payments: [], groups: [], participants: [],
  contributions: [], purchases: [], capital: [],
};

const TABLES = {
  customers: 'customers',
  sales: 'sales',
  payments: 'payments',
  groups: 'savings_groups',
  participants: 'participants',
  contributions: 'contributions',
  purchases: 'participant_purchases',
  capital: 'capital_movements',
};

// Pocos registros (negocio familiar): se cargan todas las tablas y se calcula en el navegador.
export function DataProvider({ children }) {
  const [raw, setRaw] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    try {
      const keys = Object.keys(TABLES);
      const res = await Promise.all(
        keys.map((k) => supabase.from(TABLES[k]).select('*').order('created_at', { ascending: true }).limit(5000))
      );
      const bad = res.find((r) => r.error);
      if (bad) throw bad.error;
      const next = {};
      keys.forEach((k, i) => (next[k] = res[i].data || []));
      setRaw(next);
      setError('');
    } catch (e) {
      console.error(e);
      setError(friendlyError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const derived = useMemo(() => {
    const sales = computeSales(raw);
    const customers = computeCustomers(raw, sales);
    const participants = computeParticipants(raw);
    const capital = computeCapital(raw, sales);
    return { sales, customers, participants, capital };
  }, [raw]);

  return <Ctx.Provider value={{ raw, ...derived, loading, error, reload }}>{children}</Ctx.Provider>;
}
