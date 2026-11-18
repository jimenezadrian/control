-- =====================================================================
-- MIGRACIÓN 003 · Ventas financiadas por tanda
-- ---------------------------------------------------------------------
-- Conecta tanda -> periodo -> participante beneficiado -> bolsa -> venta.
--
-- REGLAS DE CONTABILIDAD (importante):
--   * Las aportaciones de la tanda NO son ingreso ni utilidad. Son dinero
--     de los participantes que se tiene "en resguardo".
--   * Al registrar el pedido del turno, la bolsa disponible se aplica a la
--     venta como UN pago (payments.source = 'tanda'). Ese pago es el único
--     momento en que el dinero de la tanda cuenta como cobrado, así no se
--     cuenta dos veces.
--   * Importe aplicado = el MENOR entre la bolsa disponible y el precio.
--       - Pedido MÁS caro que la bolsa: lo aplicado es toda la bolsa y la
--         diferencia queda como saldo normal del participante (abonos).
--       - Pedido MÁS barato que la bolsa: el excedente NO es utilidad.
--         Al registrar la venta hay que elegir:
--            'Devuelto'                  -> se le regresa al participante
--            'Pasa al siguiente periodo' -> se suma a la bolsa del siguiente
--       - La utilidad sale siempre de la venta: precio - costo ADI.
--
-- Qué hace (ADITIVO):
--   * sales: savings_group_id, savings_period_id, beneficiary_participant_id
--   * payments: source ('cliente' | 'tanda'), savings_period_id
--   * Funciones: period_bag, create_sale, delete_sale
-- Ejecutar DESPUÉS de la 001 y la 002. Es seguro repetirla.
-- =====================================================================

alter table public.sales
  add column if not exists savings_group_id uuid references public.savings_groups(id) on delete set null,
  add column if not exists savings_period_id uuid references public.savings_periods(id) on delete set null,
  add column if not exists beneficiary_participant_id uuid references public.participants(id) on delete set null;

-- Un periodo financia como máximo UN pedido.
create unique index if not exists sales_one_per_period_uidx
  on public.sales(savings_period_id)
  where savings_period_id is not null;

alter table public.payments
  add column if not exists source text not null default 'cliente',
  add column if not exists savings_period_id uuid references public.savings_periods(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'payments_source_check') then
    alter table public.payments
      add constraint payments_source_check check (source in ('cliente', 'tanda'));
  end if;
end $$;

-- Bolsa disponible de un periodo = aportaciones del periodo
--                                  + excedente que "pasa" del periodo anterior.
create or replace function public.period_bag(p_period_id uuid)
returns numeric
language sql
stable
as $$
  select coalesce((select sum(c.amount) from public.contributions c where c.period_id = p_period_id), 0)
       + coalesce((
           select prev.surplus_amount
             from public.savings_periods cur
             join public.savings_periods prev
               on prev.group_id = cur.group_id and prev.period_number = cur.period_number - 1
            where cur.id = p_period_id
              and prev.surplus_action = 'Pasa al siguiente periodo'
         ), 0);
$$;

-- Crea una venta completa en UNA transacción: cliente (si es nuevo), venta,
-- productos, anticipo y, si es el pedido de un turno, el pago con la bolsa.
-- p_items = [{"product_name":"..","sku":"..","quantity":1,"adi_cost":450,"sale_price":650}, ...]
create or replace function public.create_sale(
  p_customer_id        uuid,
  p_new_customer_name  text,
  p_new_customer_phone text,
  p_sale_date          date,
  p_deposit            numeric,
  p_items              jsonb,
  p_period_id          uuid default null,
  p_beneficiary_id     uuid default null,
  p_surplus_action     text default null
) returns uuid
language plpgsql
as $$
declare
  v_cust     uuid := p_customer_id;
  v_sale     uuid;
  v_item     jsonb;
  v_cost     numeric := 0;
  v_price    numeric := 0;
  v_desc     text;
  v_deposit  numeric := coalesce(p_deposit, 0);
  v_date     date := coalesce(p_sale_date, current_date);
  per        public.savings_periods%rowtype;
  part       public.participants%rowtype;
  v_bag      numeric := 0;
  v_applied  numeric := 0;
  v_surplus  numeric := 0;
  v_action   text := null;
  v_last     integer;
  v_group    uuid := null;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Agrega al menos un producto.';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    if coalesce(trim(v_item->>'product_name'), '') = '' then
      raise exception 'Cada producto necesita un nombre.';
    end if;
    if coalesce((v_item->>'quantity')::integer, 0) < 1 then
      raise exception 'La cantidad de cada producto debe ser al menos 1.';
    end if;
    if coalesce((v_item->>'adi_cost')::numeric, -1) < 0 or coalesce((v_item->>'sale_price')::numeric, -1) < 0 then
      raise exception 'El costo y el precio no pueden estar vacíos ni ser negativos.';
    end if;
    v_cost  := v_cost  + (v_item->>'quantity')::integer * (v_item->>'adi_cost')::numeric;
    v_price := v_price + (v_item->>'quantity')::integer * (v_item->>'sale_price')::numeric;
  end loop;

  if v_price <= 0 then raise exception 'El precio de venta debe ser mayor a cero.'; end if;
  if v_deposit < 0 then raise exception 'El anticipo no puede ser negativo.'; end if;

  if p_period_id is not null then
    -- ---------- Pedido del turno de una tanda ----------
    select * into per from public.savings_periods where id = p_period_id for update;
    if not found then raise exception 'El periodo no existe.'; end if;
    if per.status = 'Financiado' then raise exception 'Este periodo ya tiene un pedido registrado.'; end if;

    select * into part from public.participants where id = p_beneficiary_id;
    if not found or part.group_id <> per.group_id then
      raise exception 'El beneficiario no pertenece a esta tanda.';
    end if;

    v_bag := public.period_bag(p_period_id);
    if v_bag <= 0 then
      raise exception 'La bolsa de este periodo está en $0. Registra primero las aportaciones.';
    end if;

    v_applied := least(v_bag, v_price);

    if v_bag > v_price + 0.005 then
      v_surplus := round(v_bag - v_price, 2);
      v_action  := p_surplus_action;
      if v_action is null or v_action not in ('Devuelto', 'Pasa al siguiente periodo') then
        raise exception 'La bolsa es mayor al pedido. Elige qué hacer con el excedente de %.', v_surplus;
      end if;
      if v_action = 'Pasa al siguiente periodo' then
        select max(period_number) into v_last from public.savings_periods where group_id = per.group_id;
        if per.period_number >= v_last then
          raise exception 'Este es el último periodo; el excedente debe devolverse.';
        end if;
        if exists (select 1 from public.savings_periods nx
                    where nx.group_id = per.group_id
                      and nx.period_number = per.period_number + 1
                      and nx.status = 'Financiado') then
          raise exception 'El siguiente periodo ya tiene su pedido registrado; el excedente debe devolverse.';
        end if;
      end if;
    end if;

    if v_deposit + v_applied > v_price + 0.005 then
      raise exception 'El pago extra más la bolsa no pueden ser mayores al precio de venta.';
    end if;

    -- El participante se vuelve cliente (una sola vez).
    v_cust := part.customer_id;
    if v_cust is null then
      insert into public.customers (name, phone) values (part.name, part.phone) returning id into v_cust;
      update public.participants set customer_id = v_cust where id = part.id;
    end if;
    v_group := per.group_id;
  else
    -- ---------- Venta normal ----------
    if v_deposit > v_price + 0.005 then
      raise exception 'El anticipo no puede ser mayor al precio de venta.';
    end if;
    if v_cust is null then
      if coalesce(trim(p_new_customer_name), '') = '' then
        raise exception 'Elige un cliente.';
      end if;
      insert into public.customers (name, phone)
      values (trim(p_new_customer_name), nullif(trim(coalesce(p_new_customer_phone, '')), ''))
      returning id into v_cust;
    end if;
  end if;

  select left(string_agg(
           (x->>'product_name') || case when (x->>'quantity')::integer > 1 then ' x' || (x->>'quantity') else '' end,
           ', '), 250)
    into v_desc
    from jsonb_array_elements(p_items) x;

  insert into public.sales (customer_id, description, adi_cost, sale_price, deposit, sale_date,
                            savings_group_id, savings_period_id, beneficiary_participant_id)
  values (v_cust, v_desc, v_cost, v_price, v_deposit, v_date,
          v_group, p_period_id, case when p_period_id is not null then p_beneficiary_id end)
  returning id into v_sale;

  insert into public.sale_items (sale_id, product_name, sku, quantity, adi_cost, sale_price)
  select v_sale,
         trim(x->>'product_name'),
         nullif(trim(coalesce(x->>'sku', '')), ''),
         (x->>'quantity')::integer,
         (x->>'adi_cost')::numeric,
         (x->>'sale_price')::numeric
    from jsonb_array_elements(p_items) x;

  -- El anticipo se guarda en sales.deposit Y como pago (solo payments se suma).
  if v_deposit > 0 then
    insert into public.payments (sale_id, amount, payment_date, source)
    values (v_sale, v_deposit, v_date, 'cliente');
  end if;

  if p_period_id is not null then
    insert into public.payments (sale_id, amount, payment_date, source, savings_period_id)
    values (v_sale, v_applied, v_date, 'tanda', p_period_id);

    update public.savings_periods
       set beneficiary_participant_id = p_beneficiary_id,
           status = 'Financiado',
           surplus_amount = v_surplus,
           surplus_action = v_action
     where id = p_period_id;
  end if;

  return v_sale;
end;
$$;

-- Elimina una venta con sus pagos y, si era la de un turno, libera el periodo.
create or replace function public.delete_sale(p_sale_id uuid)
returns void
language plpgsql
as $$
declare
  s public.sales%rowtype;
begin
  select * into s from public.sales where id = p_sale_id;
  if not found then raise exception 'La venta no existe.'; end if;

  if s.savings_period_id is not null then
    -- Si el excedente de este periodo ya se usó en el pedido del siguiente,
    -- borrar esta venta dejaría mal los números del siguiente.
    if exists (select 1
                 from public.savings_periods cur
                 join public.savings_periods nx
                   on nx.group_id = cur.group_id and nx.period_number = cur.period_number + 1
                where cur.id = s.savings_period_id
                  and cur.surplus_action = 'Pasa al siguiente periodo'
                  and nx.status = 'Financiado') then
      raise exception 'No se puede eliminar: el excedente de esta fecha ya se usó en el pedido de la siguiente. Elimina primero la venta de la fecha siguiente.';
    end if;

    update public.savings_periods
       set status = 'Abierto', beneficiary_participant_id = null,
           surplus_amount = 0, surplus_action = null
     where id = s.savings_period_id;
  end if;

  delete from public.payments where sale_id = p_sale_id;
  delete from public.sales where id = p_sale_id;  -- sale_items se borran en cascada
end;
$$;

revoke execute on function public.period_bag(uuid) from public, anon;
revoke execute on function public.create_sale(uuid, text, text, date, numeric, jsonb, uuid, uuid, text) from public, anon;
revoke execute on function public.delete_sale(uuid) from public, anon;
grant execute on function public.period_bag(uuid) to authenticated;
grant execute on function public.create_sale(uuid, text, text, date, numeric, jsonb, uuid, uuid, text) to authenticated;
grant execute on function public.delete_sale(uuid) to authenticated;
