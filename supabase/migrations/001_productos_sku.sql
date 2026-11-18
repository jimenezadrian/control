-- =====================================================================
-- MIGRACIÓN 001 · Productos y SKU dentro de una venta
-- ---------------------------------------------------------------------
-- Qué hace (todo ADITIVO, no borra ni modifica datos existentes):
--   1. Crea la tabla sale_items (un renglón por producto de la venta).
--   2. Mantiene sales.adi_cost y sales.sale_price como TOTALES de la
--      venta, recalculados automáticamente desde sale_items (así nada
--      de lo que ya funciona se rompe).
--   3. Convierte cada venta existente en una venta con 1 producto
--      (usa su descripción y sus totales actuales). Solo si aún no
--      tiene productos, por eso se puede ejecutar más de una vez.
-- Ejecutar en: Supabase → SQL Editor. Es seguro repetirla.
-- =====================================================================

create table if not exists public.sale_items (
  id           uuid primary key default gen_random_uuid(),
  sale_id      uuid not null references public.sales(id) on delete cascade,
  product_name text not null,
  sku          text,
  quantity     integer not null default 1 check (quantity > 0),
  adi_cost     numeric(12,2) not null default 0 check (adi_cost >= 0),   -- costo ADI UNITARIO
  sale_price   numeric(12,2) not null default 0 check (sale_price >= 0), -- precio de venta UNITARIO
  delivered_at date,                                                      -- null = pendiente de entrega
  created_at   timestamptz not null default now()
);

create index if not exists sale_items_sale_idx on public.sale_items(sale_id);

alter table public.sale_items enable row level security;
drop policy if exists "acceso_autenticados" on public.sale_items;
create policy "acceso_autenticados" on public.sale_items
  for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public.sale_items to authenticated;

-- Totales de la venta = suma de sus productos -------------------------
create or replace function public.sync_sale_totals()
returns trigger
language plpgsql
as $$
declare
  v_sale uuid;
begin
  if tg_op = 'DELETE' then
    v_sale := old.sale_id;
  else
    v_sale := new.sale_id;
  end if;

  -- Si ya no quedan productos se dejan los totales como estaban.
  if exists (select 1 from public.sale_items where sale_id = v_sale) then
    update public.sales s
       set adi_cost   = (select coalesce(sum(quantity * adi_cost), 0)   from public.sale_items where sale_id = v_sale),
           sale_price = (select coalesce(sum(quantity * sale_price), 0) from public.sale_items where sale_id = v_sale)
     where s.id = v_sale;
  end if;
  return null;
end;
$$;

drop trigger if exists sale_items_sync_totals on public.sale_items;
create trigger sale_items_sync_totals
  after insert or update or delete on public.sale_items
  for each row execute function public.sync_sale_totals();

-- Ventas existentes -> 1 producto cada una ------------------------------
-- Los productos migrados quedan como "pendientes de entrega"; marca como
-- entregados los pedidos viejos desde la app (pantalla Ventas → Por entregar).
insert into public.sale_items (sale_id, product_name, sku, quantity, adi_cost, sale_price)
select s.id,
       coalesce(nullif(trim(s.description), ''), 'Pedido'),
       null,
       1,
       coalesce(s.adi_cost, 0),
       coalesce(s.sale_price, 0)
  from public.sales s
 where not exists (select 1 from public.sale_items i where i.sale_id = s.id);
