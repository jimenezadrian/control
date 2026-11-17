import React, { useState } from 'react';
import { supabase } from '../supabase.js';
import { useData } from '../data.jsx';
import { Empty, Field, Modal, check, confirmar, useAction } from '../ui.jsx';
import { money } from '../utils.js';
import { NewSaleModal, SaleCard } from './Ventas.jsx';

function NewCustomerModal({ onClose }) {
  const { reload } = useData();
  const { busy, run } = useAction();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');

  async function save() {
    if (!name.trim()) return setError('Escribe el nombre del cliente.');
    const ok = await run(async () => {
      check(await supabase.from('customers').insert({ name: name.trim(), phone: phone.trim() || null }));
      await reload();
    }, 'Cliente guardado');
    if (ok) onClose();
  }

  return (
    <Modal title="Nuevo cliente" onClose={onClose}>
      {error && <div className="err-box">{error}</div>}
      <Field label="Nombre"><input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
      <Field label="Teléfono (opcional)"><input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
      <button className="btn block" onClick={save} disabled={busy}>{busy ? 'Guardando…' : 'Guardar cliente'}</button>
    </Modal>
  );
}

function CustomerDetail({ id, onBack }) {
  const { customers, reload } = useData();
  const { run } = useAction();
  const [selling, setSelling] = useState(false);
  const c = customers.find((x) => x.id === id);
  if (!c) return <Empty>Cliente no encontrado.</Empty>;

  async function del() {
    if (c.sales.length > 0) return alert('Este cliente tiene ventas. Elimina primero sus ventas para poder borrarlo.');
    if (!confirmar(`¿Eliminar a ${c.name}?`)) return;
    const ok = await run(async () => {
      check(await supabase.from('customers').delete().eq('id', c.id));
      await reload();
    }, 'Cliente eliminado');
    if (ok) onBack();
  }

  return (
    <>
      <button className="btn sm sec" onClick={onBack}>← Clientes</button>
      <div className="row" style={{ marginTop: '.8rem' }}>
        <div>
          <h1 style={{ marginBottom: 0 }}>{c.name}</h1>
          {c.phone && <a className="muted" href={`tel:${c.phone}`}>{c.phone}</a>}
        </div>
      </div>
      <div className="card" style={{ marginTop: '.8rem' }}>
        <div className="two">
          <div>Total vendido<br /><b>{money(c.total)}</b></div>
          <div>Ha pagado<br /><b>{money(c.paid)}</b></div>
        </div>
        <div style={{ marginTop: '.6rem' }}>Debe: <b style={{ color: c.balance > 0 ? 'var(--danger)' : 'var(--ok)' }}>{money(c.balance)}</b></div>
        <div className="actions">
          <button className="btn" onClick={() => setSelling(true)}>+ Nueva venta</button>
          <button className="btn sm danger" onClick={del}>Eliminar cliente</button>
        </div>
      </div>
      <h2>Historial de compras</h2>
      {c.sales.length === 0 ? <Empty>Aún no tiene compras.</Empty> :
        [...c.sales].sort((a, b) => (a.sale_date < b.sale_date ? 1 : -1)).map((s) => <SaleCard key={s.id} s={s} showCustomer={false} />)}
      {selling && <NewSaleModal presetCustomerId={c.id} onClose={() => setSelling(false)} />}
    </>
  );
}

export default function Clientes() {
  const { customers } = useData();
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [sel, setSel] = useState(null);

  if (sel) return <CustomerDetail id={sel} onBack={() => setSel(null)} />;

  const list = customers.filter((c) => !q.trim() || c.name.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <>
      <div className="row">
        <h1>Clientes</h1>
        <button className="btn" onClick={() => setCreating(true)}>+ Nuevo cliente</button>
      </div>
      <input placeholder="Buscar cliente…" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: '.8rem' }} />
      {list.length === 0 ? <Empty>Todavía no hay clientes.</Empty> : list.map((c) => (
        <div key={c.id} className="card" onClick={() => setSel(c.id)} style={{ cursor: 'pointer' }}>
          <div className="row">
            <div>
              <h3>{c.name}</h3>
              <div className="muted small">{c.sales.length} compra(s)</div>
            </div>
            <div className="right">
              <div className="small muted">Debe</div>
              <b style={{ color: c.balance > 0 ? 'var(--danger)' : 'var(--ok)' }}>{money(c.balance)}</b>
            </div>
          </div>
        </div>
      ))}
      {creating && <NewCustomerModal onClose={() => setCreating(false)} />}
    </>
  );
}
