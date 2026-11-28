-- Additive checkout and courier schema.
-- Review existing policies and table columns first: this transaction replaces
-- user-data policies on supported tables while preserving the table rows.
begin;

create table if not exists public.couriers (
    user_id uuid primary key references auth.users (id) on delete cascade,
    name text not null check (char_length(name) between 2 and 100),
    phone text check (phone is null or char_length(phone) between 7 and 20),
    status text not null default 'inactive' check (status in ('active', 'inactive', 'suspended')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

do $$
begin
    if to_regclass('public.orders') is null then
        raise exception 'Expected public.orders table before applying payments-courier schema.';
    end if;
    if not exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'orders' and column_name = 'user_id'
    ) then
        raise exception 'Expected public.orders.user_id; review the orders schema before applying this script.';
    end if;
end
$$;

alter table public.orders
    add column if not exists payment_method text not null default 'card',
    add column if not exists customer_phone text,
    add column if not exists courier_id uuid references public.couriers (user_id) on delete set null,
    add column if not exists request_id uuid;

update public.orders
set payment_method = 'card'
where payment_method is null;

alter table public.orders
    alter column payment_method set default 'card',
    alter column payment_method set not null,
    drop constraint if exists orders_payment_method_check,
    add constraint orders_payment_method_check
        check (payment_method in ('card', 'sbp', 'cash', 'upon_confirmation'));

create unique index if not exists orders_request_id_unique
    on public.orders (request_id)
    where request_id is not null;

create index if not exists orders_courier_status_created_idx
    on public.orders (courier_id, status, created_at desc);

do $$
declare
    order_id_type text;
    payments_order_id_type text;
begin
    if to_regclass('public.orders') is null then
        raise exception 'Expected public.orders table before applying payments-courier schema.';
    end if;

    select format_type(attribute.atttypid, attribute.atttypmod)
    into order_id_type
    from pg_attribute attribute
    where attribute.attrelid = 'public.orders'::regclass
      and attribute.attname = 'id'
      and not attribute.attisdropped;

    if order_id_type is null then
        raise exception 'Expected public.orders.id before creating public.payments.';
    end if;

    if to_regclass('public.payments') is null then
        execute format(
            'create table public.payments (
                id uuid primary key default gen_random_uuid(),
                user_id uuid not null references auth.users (id) on delete cascade,
                order_id %s not null references public.orders (id) on delete cascade,
                amount numeric(12, 2) not null check (amount > 0),
                status text not null default ''pending''
                    check (status in (''pending'', ''succeeded'', ''failed'', ''canceled'', ''refunded'')),
                payment_id text unique,
                confirmation_url text,
                created_at timestamptz not null default now(),
                updated_at timestamptz not null default now(),
                unique (order_id)
            )',
            order_id_type
        );
    else
        select format_type(attribute.atttypid, attribute.atttypmod)
        into payments_order_id_type
        from pg_attribute attribute
        where attribute.attrelid = 'public.payments'::regclass
          and attribute.attname = 'order_id'
          and not attribute.attisdropped;

        if payments_order_id_type is distinct from order_id_type then
            raise exception 'public.payments.order_id type (%) differs from public.orders.id type (%); reconcile existing data before applying.',
                payments_order_id_type, order_id_type;
        end if;
        alter table public.payments
            add column if not exists user_id uuid references auth.users (id) on delete cascade,
            add column if not exists amount numeric(12, 2),
            add column if not exists status text not null default 'pending',
            add column if not exists payment_id text,
            add column if not exists confirmation_url text,
            add column if not exists created_at timestamptz not null default now(),
            add column if not exists updated_at timestamptz not null default now();
    end if;
end
$$;

create unique index if not exists payments_order_id_unique
    on public.payments (order_id);

create unique index if not exists payments_payment_id_unique
    on public.payments (payment_id)
    where payment_id is not null;

create index if not exists payments_user_created_idx
    on public.payments (user_id, created_at desc);

alter table public.orders enable row level security;
alter table public.couriers enable row level security;
alter table public.payments enable row level security;

-- Replace existing policies on these tables so an older permissive policy
-- cannot broaden access alongside the least-privilege policies below.
do $$
declare
    target_table text;
    existing_policy record;
begin
    foreach target_table in array array['orders', 'couriers', 'payments', 'cart_items', 'favorites', 'devices']
    loop
        if to_regclass(format('public.%I', target_table)) is not null
           and exists (
               select 1 from information_schema.columns
               where table_schema = 'public'
                 and table_name = target_table
                 and column_name = 'user_id'
           ) then
            for existing_policy in
                select policyname
                from pg_policies
                where schemaname = 'public' and tablename = target_table
            loop
                execute format('drop policy %I on public.%I', existing_policy.policyname, target_table);
            end loop;
            execute format('alter table public.%I enable row level security', target_table);
        elsif to_regclass(format('public.%I', target_table)) is not null then
            raise exception 'Table public.% exists but has no user_id column; review its ownership model before applying RLS.', target_table;
        end if;
    end loop;
end
$$;

create policy orders_read_own
    on public.orders for select to authenticated
    using (user_id = auth.uid());

create policy couriers_read_self
    on public.couriers for select to authenticated
    using (user_id = auth.uid());

create policy payments_read_own
    on public.payments for select to authenticated
    using (user_id = auth.uid());

do $$
declare
    target_table text;
begin
    foreach target_table in array array['cart_items', 'favorites', 'devices']
    loop
        if to_regclass(format('public.%I', target_table)) is not null
           and exists (
               select 1 from information_schema.columns
               where table_schema = 'public'
                 and table_name = target_table
                 and column_name = 'user_id'
           ) then
            execute format(
                'create policy %I on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())',
                target_table || '_owner_only',
                target_table
            );
        end if;
    end loop;
end
$$;

-- RLS audit output: inspect for tables not present in this deployment.
select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('orders', 'cart_items', 'favorites', 'devices', 'payments', 'couriers')
order by tablename, policyname;

commit;
