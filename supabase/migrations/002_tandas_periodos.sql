-- =====================================================================
-- MIGRACIÓN 002 · Tandas colectivas con periodos y pagos por fecha
-- ---------------------------------------------------------------------
-- Nueva lógica: una tanda es una cooperación colectiva. En cada periodo
-- todos aportan el mismo importe y la bolsa financia el pedido de quien
-- tiene el turno. YA NO hay saldos individuales para gastar.
--
-- Qué hace (ADITIVO, no borra datos):
--   * savings_groups.participants_count : cantidad de participantes.
--   * savings_periods                   : una fila por fecha/periodo.
--   * contributions.period_id           : a qué periodo pertenece el pago
--                                         (un pago = una fila; sin fila = pendiente).
--   * participants.customer_id          : cliente ligado al participante
--                                         (se crea solo al registrar su pedido).
--   * Funciones: create_tanda, generate_periods, pay_contribution,
--                unpay_contribution.
-- Las tablas viejas (contributions sin periodo, participant_purchases)
-- se CONSERVAN pero la app ya no las usa.
-- Ejecutar DESPUÉS de la 001. Es seguro repetirla.
-- =====================================================================

alter table public.savings_groups
  add column if not exists participants_count integer
  check (participants_count is null or participants_count > 0);

create table if not exists public.savings_periods (
  id                         uuid primary key default gen_random_uuid(),
  group_id                   uuid not null references public.savings_groups(id) on delete cascade,
  period_number              integer not null check (period_number > 0),
  scheduled_date             date not null,
  beneficiary_participant_id uuid references public.participants(id) on delete set null,
  status                     text not null default 'Abierto',   -- 'Abierto' | 'Financiado'
  surplus_amount             numeric(12,2) not null default 0,  -- excedente de bolsa (no es utilidad)
  surplus_action             text check (surplus_action in ('Devuelto', 'Pasa al siguiente periodo')),
  created_at                 timestamptz not null default now(),
  unique (group_id, period_number)
);

create index if not exists savings_periods_group_idx on public.savings_periods(group_id);

alter table public.savings_periods enable row level security;
drop policy if exists "acceso_autenticados" on public.savings_periods;
create policy "acceso_autenticados" on public.savings_periods
  for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public.savings_periods to authenticated;

alter table public.contributions
  add column if not exists period_id uuid references public.savings_periods(id) on delete cascade;

-- Evita duplicados: una sola aportación por participante y periodo.
create unique index if not exists contributions_participant_period_uidx
  on public.contributions(participant_id, period_id)
  where period_id is not null;

alter table public.participants
  add column if not exists customer_id uuid references public.customers(id) on delete set null;

-- Genera (o completa) los periodos de una tanda a partir de su fecha de inicio.
-- Semanal = cada 7 días · Quincenal = cada 14 días · Mensual = cada mes.
create or replace function public.generate_periods(p_group_id uuid)
returns integer
language plpgsql
as $$
declare
  g    public.savings_groups%rowtype;
  i    integer;
  made integer := 0;
  d    date;
begin
  select * into g from public.savings_groups where id = p_group_id;
  if not found then
    raise exception 'La tanda no existe.';
  end if;
  if g.periods is null or g.periods < 1 then
    raise exception 'La tanda no tiene número de periodos.';
  end if;
  if g.start_date is null then
    raise exception 'La tanda no tiene fecha de inicio.';
  end if;

  for i in 1 .. g.periods loop
    d := case lower(coalesce(g.frequency, 'semanal'))
           when 'quincenal' then g.start_date + (i - 1) * 14
           when 'mensual'   then (g.start_date + ((i - 1) * interval '1 month'))::date
           else                  g.start_date + (i - 1) * 7
         end;
    insert into public.savings_periods (group_id, period_number, scheduled_date)
    values (p_group_id, i, d)
    on conflict (group_id, period_number) do nothing;
    if found then
      made := made + 1;
    end if;
  end loop;
  return made;
end;
$$;

-- Crea la tanda y todos sus periodos en una sola operación.
create or replace function public.create_tanda(
  p_name         text,
  p_amount       numeric,
  p_frequency    text,
  p_periods      integer,
  p_start        date,
  p_participants integer
) returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  if coalesce(trim(p_name), '') = '' then raise exception 'Escribe el nombre de la tanda.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'La aportación debe ser mayor a cero.'; end if;
  if p_periods is null or p_periods < 1 then raise exception 'Indica el número de periodos.'; end if;
  if p_participants is null or p_participants < 1 then raise exception 'Indica la cantidad de participantes.'; end if;
  if p_start is null then raise exception 'Elige la fecha de inicio.'; end if;

  insert into public.savings_groups (name, contribution_amount, frequency, periods, start_date, status, participants_count)
  values (trim(p_name), p_amount, coalesce(p_frequency, 'Semanal'), p_periods, p_start, 'Activa', p_participants)
  returning id into v_id;

  perform public.generate_periods(v_id);
  return v_id;
end;
$$;

-- Marca a un participante como pagado en un periodo (un clic).
-- El importe SIEMPRE es el configurado en la tanda.
create or replace function public.pay_contribution(
  p_participant_id uuid,
  p_period_id      uuid,
  p_date           date default null
) returns uuid
language plpgsql
as $$
declare
  per   public.savings_periods%rowtype;
  part  public.participants%rowtype;
  v_amt numeric;
  v_id  uuid;
begin
  select * into per from public.savings_periods where id = p_period_id;
  if not found then raise exception 'El periodo no existe.'; end if;

  select * into part from public.participants where id = p_participant_id;
  if not found or part.group_id <> per.group_id then
    raise exception 'El participante no pertenece a esta tanda.';
  end if;

  select contribution_amount into v_amt from public.savings_groups where id = per.group_id;

  begin
    insert into public.contributions (participant_id, period_id, amount, contribution_date, period_label)
    values (p_participant_id, p_period_id, v_amt, coalesce(p_date, current_date), 'Periodo ' || per.period_number)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Ese pago ya estaba registrado.';
  end;
  return v_id;
end;
$$;

-- Corrige un pago marcado por error.
create or replace function public.unpay_contribution(
  p_participant_id uuid,
  p_period_id      uuid
) returns void
language plpgsql
as $$
declare
  per public.savings_periods%rowtype;
begin
  select * into per from public.savings_periods where id = p_period_id;
  if not found then raise exception 'El periodo no existe.'; end if;
  if per.status = 'Financiado' then
    raise exception 'Este periodo ya financió un pedido; para corregir un pago elimina primero la venta de ese periodo.';
  end if;

  delete from public.contributions
   where participant_id = p_participant_id and period_id = p_period_id;
  if not found then
    raise exception 'No había un pago registrado.';
  end if;
end;
$$;

revoke execute on function public.generate_periods(uuid) from public, anon;
revoke execute on function public.create_tanda(text, numeric, text, integer, date, integer) from public, anon;
revoke execute on function public.pay_contribution(uuid, uuid, date) from public, anon;
revoke execute on function public.unpay_contribution(uuid, uuid) from public, anon;
grant execute on function public.generate_periods(uuid) to authenticated;
grant execute on function public.create_tanda(text, numeric, text, integer, date, integer) to authenticated;
grant execute on function public.pay_contribution(uuid, uuid, date) to authenticated;
grant execute on function public.unpay_contribution(uuid, uuid) to authenticated;
