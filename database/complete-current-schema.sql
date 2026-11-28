-- Additive, idempotent schema repair for the current Dr. DarSun site and bots.
-- Run in the Supabase SQL Editor. Existing rows are preserved; core products
-- and orders tables must already exist because their ID types are deployment-specific.
begin;

do $$
begin
    if to_regclass('public.products') is null then
        raise exception 'Missing public.products. Create/restore the existing catalog table before applying this file.';
    end if;
    if to_regclass('public.orders') is null then
        raise exception 'Missing public.orders. Create/restore the existing orders table before applying this file.';
    end if;
    if not exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'products'
          and column_name in ('id', 'name', 'price')
        group by table_schema, table_name
        having count(*) = 3
    ) then
        raise exception 'public.products must contain id, name and price; review its schema before applying this file.';
    end if;
    if not exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'orders'
          and column_name in ('id', 'user_id', 'items', 'total', 'status', 'created_at')
        group by table_schema, table_name
        having count(*) = 6
    ) then
        raise exception 'public.orders must contain id, user_id, items, total, status and created_at; review its schema before applying this file.';
    end if;
end
$$;

create table if not exists public.couriers (
    user_id uuid primary key references auth.users (id) on delete cascade,
    name text not null,
    phone text,
    status text not null default 'inactive',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.couriers
    add column if not exists user_id uuid references auth.users (id) on delete cascade,
    add column if not exists name text,
    add column if not exists phone text,
    add column if not exists status text not null default 'inactive',
    add column if not exists created_at timestamptz not null default now(),
    add column if not exists updated_at timestamptz not null default now();

alter table public.products
    add column if not exists description text,
    add column if not exists category text,
    add column if not exists image_url text,
    add column if not exists volume text not null default '250 мл',
    add column if not exists packaging_type text not null default 'Тёмное стекло',
    add column if not exists pressing_type text not null default 'Холодный отжим',
    add column if not exists shelf_life_months integer not null default 6;

alter table public.orders
    add column if not exists customer_name text,
    add column if not exists customer_email text,
    add column if not exists customer_phone text,
    add column if not exists delivery_address text,
    add column if not exists payment_method text not null default 'upon_confirmation',
    add column if not exists request_id uuid,
    add column if not exists courier_id uuid references public.couriers (user_id) on delete set null;

create unique index if not exists orders_request_id_unique
    on public.orders (request_id) where request_id is not null;
create index if not exists orders_courier_status_created_idx
    on public.orders (courier_id, status, created_at desc);
create index if not exists orders_user_created_idx
    on public.orders (user_id, created_at desc);

do $$
declare
    order_id_type text;
    payment_order_id_type text;
begin
    select format_type(a.atttypid, a.atttypmod)
    into order_id_type
    from pg_attribute a
    where a.attrelid = 'public.orders'::regclass
      and a.attname = 'id' and not a.attisdropped;

    if order_id_type is null then
        raise exception 'Missing public.orders.id.';
    end if;

    if to_regclass('public.payments') is null then
        execute format(
            'create table public.payments (
                id uuid primary key default gen_random_uuid(),
                user_id uuid not null references auth.users (id) on delete cascade,
                order_id %s not null references public.orders (id) on delete cascade,
                amount numeric(12,2) not null check (amount > 0),
                status text not null default ''pending'',
                payment_id text,
                confirmation_url text,
                created_at timestamptz not null default now(),
                updated_at timestamptz not null default now()
            )',
            order_id_type
        );
    else
        select format_type(a.atttypid, a.atttypmod)
        into payment_order_id_type
        from pg_attribute a
        where a.attrelid = 'public.payments'::regclass
          and a.attname = 'order_id' and not a.attisdropped;
        if payment_order_id_type is not null
           and payment_order_id_type is distinct from order_id_type then
            raise exception 'public.payments.order_id (%) differs from public.orders.id (%); reconcile the existing schema first.',
                payment_order_id_type, order_id_type;
        end if;
        if payment_order_id_type is null then
            execute format('alter table public.payments add column order_id %s', order_id_type);
        end if;
        alter table public.payments
            add column if not exists user_id uuid references auth.users (id) on delete cascade,
            add column if not exists amount numeric(12,2),
            add column if not exists status text not null default 'pending',
            add column if not exists payment_id text,
            add column if not exists confirmation_url text,
            add column if not exists created_at timestamptz not null default now(),
            add column if not exists updated_at timestamptz not null default now();
    end if;
end
$$;

create unique index if not exists payments_order_id_unique on public.payments (order_id);
create unique index if not exists payments_payment_id_unique
    on public.payments (payment_id) where payment_id is not null;
create index if not exists payments_user_created_idx on public.payments (user_id, created_at desc);

do $$
declare
    product_id_type text;
begin
    select format_type(a.atttypid, a.atttypmod)
    into product_id_type
    from pg_attribute a
    where a.attrelid = 'public.products'::regclass
      and a.attname = 'id' and not a.attisdropped;
    if product_id_type is null then
        raise exception 'Missing public.products.id.';
    end if;

    if to_regclass('public.favorites') is null then
        execute format(
            'create table public.favorites (
                user_id uuid not null references auth.users (id) on delete cascade,
                product_id %s not null references public.products (id) on delete cascade,
                created_at timestamptz not null default now()
            )',
            product_id_type
        );
    else
        alter table public.favorites
            add column if not exists user_id uuid references auth.users (id) on delete cascade,
            add column if not exists created_at timestamptz not null default now();
        if not exists (
            select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'favorites' and column_name = 'product_id'
        ) then
            execute format('alter table public.favorites add column product_id %s', product_id_type);
        end if;
    end if;

    if to_regclass('public.brand_reviews') is null then
        execute format(
            'create table public.brand_reviews (
                id uuid primary key default gen_random_uuid(),
                user_id uuid references auth.users (id) on delete cascade,
                user_name text not null,
                rating integer not null check (rating between 1 and 5),
                review_text text,
                product_id %s references public.products (id) on delete set null,
                status text not null default ''pending'',
                created_at timestamptz not null default now(),
                updated_at timestamptz not null default now()
            )',
            product_id_type
        );
    else
        alter table public.brand_reviews
            add column if not exists id uuid default gen_random_uuid(),
            add column if not exists user_id uuid references auth.users (id) on delete cascade,
            add column if not exists user_name text,
            add column if not exists rating integer,
            add column if not exists review_text text,
            add column if not exists status text not null default 'pending',
            add column if not exists created_at timestamptz not null default now(),
            add column if not exists updated_at timestamptz not null default now();
        if not exists (
            select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'brand_reviews' and column_name = 'product_id'
        ) then
            execute format('alter table public.brand_reviews add column product_id %s', product_id_type);
        end if;
    end if;
end
$$;

create unique index if not exists favorites_user_product_unique
    on public.favorites (user_id, product_id);
create unique index if not exists couriers_user_id_uidx
    on public.couriers (user_id);
create unique index if not exists brand_reviews_id_uidx
    on public.brand_reviews (id);
create index if not exists brand_reviews_product_status_created_idx
    on public.brand_reviews (product_id, status, created_at desc);
create index if not exists brand_reviews_user_idx on public.brand_reviews (user_id);

create table if not exists public.wallets (
    user_id uuid primary key references auth.users (id) on delete cascade,
    avatar_url text,
    updated_at timestamptz not null default now()
);
alter table public.wallets
    add column if not exists user_id uuid references auth.users (id) on delete cascade,
    add column if not exists avatar_url text,
    add column if not exists updated_at timestamptz not null default now();
create unique index if not exists wallets_user_id_uidx on public.wallets (user_id);

create table if not exists public.devices (
    user_id uuid not null references auth.users (id) on delete cascade,
    device_key text not null unique,
    device_name text,
    last_active timestamptz not null default now(),
    created_at timestamptz not null default now(),
    primary key (user_id, device_key)
);
alter table public.devices
    add column if not exists user_id uuid references auth.users (id) on delete cascade,
    add column if not exists device_key text,
    add column if not exists device_name text,
    add column if not exists last_active timestamptz not null default now(),
    add column if not exists created_at timestamptz not null default now();
create unique index if not exists devices_device_key_unique on public.devices (device_key);
create index if not exists devices_user_active_idx on public.devices (user_id, last_active desc);

create table if not exists public.notification_settings (
    user_id uuid primary key references auth.users (id) on delete cascade,
    email_enabled boolean not null default false,
    telegram_enabled boolean not null default false,
    updated_at timestamptz not null default now()
);
alter table public.notification_settings
    add column if not exists user_id uuid references auth.users (id) on delete cascade,
    add column if not exists email_enabled boolean not null default false,
    add column if not exists telegram_enabled boolean not null default false,
    add column if not exists updated_at timestamptz not null default now();
create unique index if not exists notification_settings_user_id_uidx
    on public.notification_settings (user_id);

create table if not exists public.site_runtime_settings (
    setting_key text primary key,
    value jsonb not null default '{}'::jsonb,
    updated_at timestamptz not null default now()
);
alter table public.site_runtime_settings
    add column if not exists setting_key text,
    add column if not exists value jsonb not null default '{}'::jsonb,
    add column if not exists updated_at timestamptz not null default now();
create unique index if not exists site_runtime_settings_setting_key_uidx
    on public.site_runtime_settings (setting_key);
insert into public.site_runtime_settings (setting_key, value)
values ('site_maintenance', '{"enabled":false,"mode":"planned"}'::jsonb)
on conflict (setting_key) do nothing;

create table if not exists public.site_public_toasts (
    id uuid primary key default gen_random_uuid(),
    message text not null,
    kind text not null default 'info',
    expires_at timestamptz not null,
    created_at timestamptz not null default now()
);
alter table public.site_public_toasts
    add column if not exists id uuid default gen_random_uuid(),
    add column if not exists message text,
    add column if not exists kind text not null default 'info',
    add column if not exists expires_at timestamptz,
    add column if not exists created_at timestamptz not null default now();
create unique index if not exists site_public_toasts_id_uidx
    on public.site_public_toasts (id);
create index if not exists site_public_toasts_expiry_idx
    on public.site_public_toasts (expires_at, created_at);

create table if not exists public.site_toast_notifications (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    message text not null,
    kind text not null default 'info',
    expires_at timestamptz not null,
    dismissed_at timestamptz,
    created_at timestamptz not null default now()
);
alter table public.site_toast_notifications
    add column if not exists id uuid default gen_random_uuid(),
    add column if not exists user_id uuid references auth.users (id) on delete cascade,
    add column if not exists message text,
    add column if not exists kind text not null default 'info',
    add column if not exists expires_at timestamptz,
    add column if not exists dismissed_at timestamptz,
    add column if not exists created_at timestamptz not null default now();
create unique index if not exists site_toast_notifications_id_uidx
    on public.site_toast_notifications (id);
create index if not exists site_toast_notifications_user_active_idx
    on public.site_toast_notifications (user_id, dismissed_at, created_at);

create table if not exists public.catalog_demo_state (
    id integer primary key check (id = 1),
    retired boolean not null default false,
    retired_at timestamptz
);
alter table public.catalog_demo_state
    add column if not exists id integer,
    add column if not exists retired boolean not null default false,
    add column if not exists retired_at timestamptz;
insert into public.catalog_demo_state (id, retired, retired_at)
select 1, exists (select 1 from public.products), case when exists (select 1 from public.products) then now() end
on conflict (id) do nothing;

create table if not exists public.site_visitor_daily_counts (
    visit_date date primary key,
    visitor_count bigint not null default 0 check (visitor_count >= 0),
    updated_at timestamptz not null default now()
);
alter table public.site_visitor_daily_counts
    add column if not exists visit_date date,
    add column if not exists visitor_count bigint not null default 0,
    add column if not exists updated_at timestamptz not null default now();
create unique index if not exists site_visitor_daily_counts_date_uidx
    on public.site_visitor_daily_counts (visit_date);
create unique index if not exists catalog_demo_state_id_uidx
    on public.catalog_demo_state (id);

create table if not exists public.telegram_accounts (
    user_id uuid primary key references auth.users (id) on delete cascade,
    email text,
    telegram_chat_id text not null unique,
    telegram_username text,
    linked_at timestamptz not null default now(),
    last_login_code_at timestamptz
);
alter table public.telegram_accounts
    add column if not exists user_id uuid references auth.users (id) on delete cascade,
    add column if not exists email text,
    add column if not exists telegram_chat_id text,
    add column if not exists telegram_username text,
    add column if not exists linked_at timestamptz not null default now(),
    add column if not exists last_login_code_at timestamptz;
alter table public.telegram_accounts
    alter column telegram_chat_id type text using telegram_chat_id::text;
create unique index if not exists telegram_accounts_chat_id_uidx
    on public.telegram_accounts (telegram_chat_id);
create unique index if not exists telegram_accounts_user_id_uidx
    on public.telegram_accounts (user_id);

create table if not exists public.telegram_link_requests (
    code_hash text primary key,
    user_id uuid not null references auth.users (id) on delete cascade,
    email text not null,
    expires_at timestamptz not null,
    created_at timestamptz not null default now(),
    telegram_chat_id text,
    consumed_at timestamptz
);
alter table public.telegram_link_requests
    add column if not exists code_hash text,
    add column if not exists user_id uuid references auth.users (id) on delete cascade,
    add column if not exists email text,
    add column if not exists expires_at timestamptz,
    add column if not exists created_at timestamptz not null default now(),
    add column if not exists telegram_chat_id text,
    add column if not exists consumed_at timestamptz;
alter table public.telegram_link_requests
    alter column telegram_chat_id type text using telegram_chat_id::text;
create unique index if not exists telegram_link_requests_code_hash_uidx
    on public.telegram_link_requests (code_hash);
create index if not exists telegram_link_requests_expiry_idx
    on public.telegram_link_requests (expires_at);
create index if not exists telegram_link_requests_user_idx
    on public.telegram_link_requests (user_id);

create table if not exists public.telegram_login_requests (
    id text primary key,
    poll_token_hash text not null,
    status text not null default 'pending',
    user_id uuid references auth.users (id) on delete cascade,
    telegram_chat_id text,
    code_hash text,
    attempts integer not null default 0,
    created_at timestamptz not null default now(),
    code_sent_at timestamptz,
    expires_at timestamptz not null,
    completed_at timestamptz
);
alter table public.telegram_login_requests
    add column if not exists id text,
    add column if not exists poll_token_hash text,
    add column if not exists status text not null default 'pending',
    add column if not exists user_id uuid references auth.users (id) on delete cascade,
    add column if not exists telegram_chat_id text,
    add column if not exists code_hash text,
    add column if not exists attempts integer not null default 0,
    add column if not exists created_at timestamptz not null default now(),
    add column if not exists code_sent_at timestamptz,
    add column if not exists expires_at timestamptz,
    add column if not exists completed_at timestamptz;
alter table public.telegram_login_requests
    alter column telegram_chat_id type text using telegram_chat_id::text;
create unique index if not exists telegram_login_requests_id_uidx
    on public.telegram_login_requests (id);
create index if not exists telegram_login_requests_expiry_idx
    on public.telegram_login_requests (expires_at);
create index if not exists telegram_login_requests_user_idx
    on public.telegram_login_requests (user_id);

create table if not exists public.telegram_admin_audit (
    id uuid primary key default gen_random_uuid(),
    actor_role text not null,
    actor_chat_id text,
    action text not null,
    entity_type text not null,
    entity_id text not null,
    details jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);
alter table public.telegram_admin_audit
    add column if not exists id uuid default gen_random_uuid(),
    add column if not exists actor_role text,
    add column if not exists actor_chat_id text,
    add column if not exists action text,
    add column if not exists entity_type text,
    add column if not exists entity_id text,
    add column if not exists details jsonb not null default '{}'::jsonb,
    add column if not exists created_at timestamptz not null default now();
create index if not exists telegram_admin_audit_created_idx
    on public.telegram_admin_audit (created_at desc);
create unique index if not exists telegram_admin_audit_id_uidx
    on public.telegram_admin_audit (id);

create table if not exists public.telegram_bot_states (
    bot_role text not null,
    telegram_chat_id text not null,
    state jsonb not null default '{}'::jsonb,
    updated_at timestamptz not null default now(),
    primary key (bot_role, telegram_chat_id)
);
alter table public.telegram_bot_states
    add column if not exists bot_role text,
    add column if not exists telegram_chat_id text,
    add column if not exists state jsonb not null default '{}'::jsonb,
    add column if not exists updated_at timestamptz not null default now();
create unique index if not exists telegram_bot_states_role_chat_uidx
    on public.telegram_bot_states (bot_role, telegram_chat_id);

create table if not exists public.telegram_webhook_updates (
    bot_role text not null,
    update_id bigint not null,
    status text not null default 'pending',
    attempts integer not null default 0,
    locked_at timestamptz,
    completed_at timestamptz,
    updated_at timestamptz not null default now(),
    primary key (bot_role, update_id)
);
alter table public.telegram_webhook_updates
    add column if not exists bot_role text,
    add column if not exists update_id bigint,
    add column if not exists status text not null default 'pending',
    add column if not exists attempts integer not null default 0,
    add column if not exists locked_at timestamptz,
    add column if not exists completed_at timestamptz,
    add column if not exists updated_at timestamptz not null default now();
update public.telegram_webhook_updates
set status = 'pending', locked_at = null
where status is null or status not in ('pending', 'processing', 'completed');
alter table public.telegram_webhook_updates
    drop constraint if exists telegram_webhook_updates_status_check,
    add constraint telegram_webhook_updates_status_check
        check (status in ('pending', 'processing', 'completed'));
create unique index if not exists telegram_webhook_updates_role_id_uidx
    on public.telegram_webhook_updates (bot_role, update_id);
create index if not exists telegram_webhook_updates_status_idx
    on public.telegram_webhook_updates (status, updated_at);

create table if not exists public.telegram_support_tickets (
    id uuid primary key default gen_random_uuid(),
    ticket_number bigint,
    telegram_chat_id text not null,
    telegram_username text,
    topic text not null default 'Другое',
    status text not null default 'open',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
alter table public.telegram_support_tickets
    add column if not exists id uuid default gen_random_uuid(),
    add column if not exists ticket_number bigint,
    add column if not exists telegram_chat_id text,
    add column if not exists telegram_username text,
    add column if not exists topic text not null default 'Другое',
    add column if not exists status text not null default 'open',
    add column if not exists created_at timestamptz not null default now(),
    add column if not exists updated_at timestamptz not null default now();
create sequence if not exists public.telegram_support_tickets_ticket_number_seq;
do $$
declare
    identity_column boolean;
    ticket_sequence text;
    max_ticket_number bigint;
    sequence_last_value bigint;
    sequence_was_called boolean;
    sequence_value bigint;
begin
    select is_identity = 'YES' into identity_column
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'telegram_support_tickets'
      and column_name = 'ticket_number';

    ticket_sequence := pg_get_serial_sequence(
        'public.telegram_support_tickets',
        'ticket_number'
    );
    if ticket_sequence is null then
        ticket_sequence := 'public.telegram_support_tickets_ticket_number_seq';
    end if;

    if not coalesce(identity_column, false) then
        execute format(
            'alter table public.telegram_support_tickets alter column ticket_number set default nextval(%L::regclass)',
            ticket_sequence
        );
        execute format(
            'alter sequence %s owned by public.telegram_support_tickets.ticket_number',
            ticket_sequence::regclass
        );
    end if;

    select coalesce(max(ticket_number), 0)
    into max_ticket_number
    from public.telegram_support_tickets;
    execute format('select last_value, is_called from %s', ticket_sequence::regclass)
    into sequence_last_value, sequence_was_called;

    sequence_value := greatest(
        max_ticket_number,
        case when sequence_was_called then sequence_last_value else 0 end,
        1
    );
    perform setval(
        ticket_sequence::regclass,
        sequence_value,
        max_ticket_number > 0 or sequence_was_called
    );

    if not coalesce(identity_column, false) then
        update public.telegram_support_tickets
            set ticket_number = nextval(ticket_sequence::regclass)
            where ticket_number is null;
    end if;

    execute format('grant usage, select on sequence %s to service_role', ticket_sequence::regclass);
end;
$$;
create unique index if not exists telegram_support_tickets_id_uidx
    on public.telegram_support_tickets (id);
create unique index if not exists telegram_support_tickets_number_uidx
    on public.telegram_support_tickets (ticket_number);
create index if not exists telegram_support_tickets_chat_status_idx
    on public.telegram_support_tickets (telegram_chat_id, status, updated_at desc);
create index if not exists telegram_support_tickets_status_updated_idx
    on public.telegram_support_tickets (status, updated_at desc);
create table if not exists public.telegram_support_messages (
    id uuid primary key default gen_random_uuid(),
    ticket_id uuid not null references public.telegram_support_tickets (id) on delete cascade,
    sender_role text not null,
    telegram_chat_id text,
    message text not null,
    created_at timestamptz not null default now()
);
alter table public.telegram_support_messages
    add column if not exists id uuid default gen_random_uuid(),
    add column if not exists ticket_id uuid references public.telegram_support_tickets (id) on delete cascade,
    add column if not exists sender_role text,
    add column if not exists telegram_chat_id text,
    add column if not exists message text,
    add column if not exists created_at timestamptz not null default now();
create unique index if not exists telegram_support_messages_id_uidx
    on public.telegram_support_messages (id);
create index if not exists telegram_support_messages_ticket_created_idx
    on public.telegram_support_messages (ticket_id, created_at);

create table if not exists public.qr_login_requests (
    id text primary key,
    poll_token_hash text not null,
    expires_at timestamptz not null,
    status text not null default 'pending',
    email text,
    email_otp text
);
alter table public.qr_login_requests
    add column if not exists id text,
    add column if not exists poll_token_hash text,
    add column if not exists expires_at timestamptz,
    add column if not exists status text not null default 'pending',
    add column if not exists email text,
    add column if not exists email_otp text;
alter table public.qr_login_requests
    alter column id type text using id::text;
create index if not exists qr_login_requests_expiry_idx
    on public.qr_login_requests (expires_at);
create unique index if not exists qr_login_requests_id_uidx
    on public.qr_login_requests (id);

create table if not exists public.mfa_recovery_vault (
    user_id uuid primary key references auth.users (id) on delete cascade,
    ciphertext text not null,
    iv text not null,
    auth_tag text not null,
    email_code_hash text,
    email_code_expires_at timestamptz,
    email_code_sent_at timestamptz,
    email_code_attempts integer not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
alter table public.mfa_recovery_vault
    add column if not exists user_id uuid references auth.users (id) on delete cascade,
    add column if not exists ciphertext text,
    add column if not exists iv text,
    add column if not exists auth_tag text,
    add column if not exists email_code_hash text,
    add column if not exists email_code_expires_at timestamptz,
    add column if not exists email_code_sent_at timestamptz,
    add column if not exists email_code_attempts integer not null default 0,
    add column if not exists created_at timestamptz not null default now(),
    add column if not exists updated_at timestamptz not null default now();
create unique index if not exists mfa_recovery_vault_user_uidx
    on public.mfa_recovery_vault (user_id);

create or replace function public.retire_catalog_demos_after_product_insert()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
    insert into public.catalog_demo_state (id, retired, retired_at)
    values (1, true, now())
    on conflict (id) do update
    set retired = true,
        retired_at = coalesce(public.catalog_demo_state.retired_at, excluded.retired_at);
    return new;
end;
$$;
revoke all on function public.retire_catalog_demos_after_product_insert() from public, anon, authenticated;
do $$
begin
    if not exists (
        select 1 from pg_trigger
        where tgrelid = 'public.products'::regclass
          and tgname = 'retire_catalog_demos_after_product_insert'
          and not tgisinternal
    ) then
        execute 'create trigger retire_catalog_demos_after_product_insert
            after insert on public.products
            for each row execute function public.retire_catalog_demos_after_product_insert()';
    end if;
end;
$$;

create or replace function public.get_site_visitors_today()
returns bigint language sql stable security definer set search_path = public, pg_temp
as $$
    select coalesce((select visitor_count from public.site_visitor_daily_counts where visit_date = current_date), 0)
$$;

create or replace function public.record_site_visitor(p_visit_date date)
returns bigint language plpgsql security definer set search_path = public, pg_temp
as $$
declare result bigint;
begin
    if p_visit_date is null or p_visit_date < current_date - 1 or p_visit_date > current_date + 1 then
        raise exception 'Invalid visitor date';
    end if;
    insert into public.site_visitor_daily_counts (visit_date, visitor_count, updated_at)
    values (p_visit_date, 1, now())
    on conflict (visit_date) do update
    set visitor_count = public.site_visitor_daily_counts.visitor_count + 1,
        updated_at = now()
    returning visitor_count into result;
    return result;
end;
$$;

create or replace function public.get_telegram_notification_target(p_user_id uuid)
returns text language sql security definer set search_path = public, pg_temp
as $$
    select a.telegram_chat_id
    from public.telegram_accounts a
    join public.notification_settings n on n.user_id = a.user_id
    where a.user_id = p_user_id and n.telegram_enabled
    limit 1
$$;

create or replace function public.start_telegram_account_link(p_user_id uuid, p_email text, p_code_hash text)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
begin
    if p_user_id is null or p_email is null or length(p_email) > 254
       or p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$' then
        raise exception 'Invalid Telegram link request';
    end if;
    delete from public.telegram_link_requests where expires_at <= now();
    delete from public.telegram_link_requests
      where user_id = p_user_id and consumed_at is null;
    insert into public.telegram_link_requests (code_hash, user_id, email, expires_at)
    values (p_code_hash, p_user_id, p_email, now() + interval '10 minutes');
end;
$$;

create or replace function public.confirm_telegram_link(
    p_code_hash text, p_telegram_chat_id text, p_telegram_username text default null
)
returns boolean language plpgsql security definer set search_path = public, pg_temp
as $$
declare link_request public.telegram_link_requests%rowtype;
begin
    if p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$'
       or p_telegram_chat_id is null or p_telegram_chat_id !~ '^[0-9]{1,19}$' then return false; end if;
    select * into link_request from public.telegram_link_requests
      where code_hash = p_code_hash for update;
    if not found then return false; end if;
    if link_request.consumed_at is not null then
        return link_request.telegram_chat_id = p_telegram_chat_id
          and exists (select 1 from public.telegram_accounts
            where user_id = link_request.user_id and telegram_chat_id = p_telegram_chat_id);
    end if;
    if link_request.expires_at <= now() or exists (
        select 1 from public.telegram_accounts
        where user_id = link_request.user_id or telegram_chat_id = p_telegram_chat_id
    ) then return false; end if;
    insert into public.telegram_accounts (user_id, email, telegram_chat_id, telegram_username, linked_at)
    values (link_request.user_id, link_request.email, p_telegram_chat_id,
      nullif(left(regexp_replace(coalesce(p_telegram_username, ''), '^@', ''), 64), ''), now());
    update public.telegram_link_requests
      set telegram_chat_id = p_telegram_chat_id, consumed_at = now()
      where code_hash = p_code_hash;
    return true;
exception when unique_violation then return false;
end;
$$;

create or replace function public.unlink_telegram_account(p_user_id uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp
as $$
declare deleted_count integer;
begin
    delete from public.telegram_accounts where user_id = p_user_id;
    get diagnostics deleted_count = row_count;
    update public.notification_settings set telegram_enabled = false, updated_at = now()
      where user_id = p_user_id;
    delete from public.telegram_link_requests
      where user_id = p_user_id and consumed_at is null;
    return deleted_count > 0;
end;
$$;

create or replace function public.set_telegram_notifications(p_user_id uuid, p_enabled boolean)
returns boolean language plpgsql security definer set search_path = public, pg_temp
as $$
begin
    if p_enabled and not exists (select 1 from public.telegram_accounts where user_id = p_user_id) then
        return false;
    end if;
    insert into public.notification_settings (user_id, email_enabled, telegram_enabled, updated_at)
    values (p_user_id, false, p_enabled, now())
    on conflict (user_id) do update
      set telegram_enabled = excluded.telegram_enabled, updated_at = now();
    return true;
end;
$$;

create or replace function public.create_telegram_login_request(p_id text, p_poll_token_hash text, p_expires_at timestamptz)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
begin
    if p_id is null or p_id !~ '^[0-9a-f]{48}$'
       or p_poll_token_hash is null or p_poll_token_hash !~ '^[0-9a-f]{64}$'
       or p_expires_at is null or p_expires_at <= now()
       or p_expires_at > now() + interval '10 minutes' then
        raise exception 'Invalid Telegram login request';
    end if;
    delete from public.telegram_login_requests where expires_at <= now();
    insert into public.telegram_login_requests (id, poll_token_hash, expires_at)
      values (p_id, p_poll_token_hash, p_expires_at);
end;
$$;

create or replace function public.begin_telegram_login(p_request_id text, p_telegram_chat_id text, p_code_hash text)
returns text language plpgsql security definer set search_path = public, pg_temp
as $$
declare r public.telegram_login_requests%rowtype; a public.telegram_accounts%rowtype;
begin
    if p_request_id is null or p_request_id !~ '^[0-9a-f]{48}$'
       or p_telegram_chat_id is null or p_telegram_chat_id !~ '^[0-9]{1,19}$'
       or p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$' then return null; end if;
    select * into r from public.telegram_login_requests where id = p_request_id for update;
    if not found then return null; end if;
    select * into a from public.telegram_accounts where telegram_chat_id = p_telegram_chat_id for update;
    if not found then return null; end if;
    if r.status = 'code_sent' then
        if r.user_id = a.user_id and r.telegram_chat_id = p_telegram_chat_id
           and r.code_hash = p_code_hash and r.expires_at > now() then return p_telegram_chat_id; end if;
        return null;
    end if;
    if r.status <> 'pending' or r.expires_at <= now()
       or a.last_login_code_at > now() - interval '60 seconds' then return null; end if;
    update public.telegram_login_requests set status = 'code_sent', user_id = a.user_id,
      telegram_chat_id = p_telegram_chat_id, code_hash = p_code_hash, attempts = 0,
      code_sent_at = now(), expires_at = now() + interval '5 minutes'
      where id = p_request_id;
    update public.telegram_accounts set last_login_code_at = now() where user_id = a.user_id;
    return p_telegram_chat_id;
end;
$$;

create or replace function public.verify_telegram_login(p_request_id text, p_poll_token_hash text, p_code_hash text)
returns table(user_id uuid, email text)
language plpgsql security definer set search_path = public, auth, pg_temp
as $$
declare r public.telegram_login_requests%rowtype; account_email text;
begin
    if p_request_id is null or p_request_id !~ '^[0-9a-f]{48}$'
       or p_poll_token_hash is null or p_poll_token_hash !~ '^[0-9a-f]{64}$'
       or p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$' then return; end if;
    select * into r from public.telegram_login_requests where id = p_request_id for update;
    if not found or r.poll_token_hash <> p_poll_token_hash or r.status <> 'code_sent'
       or r.expires_at <= now() or r.attempts >= 5 then return; end if;
    if r.code_hash <> p_code_hash then
        update public.telegram_login_requests set attempts = attempts + 1,
          status = case when attempts + 1 >= 5 then 'locked' else status end
          where id = p_request_id;
        return;
    end if;
    select u.email into account_email from auth.users u
      where u.id = r.user_id and exists (
        select 1 from public.telegram_accounts a
        where a.user_id = u.id and a.telegram_chat_id = r.telegram_chat_id
      );
    if account_email is null then
        update public.telegram_login_requests set status = 'locked' where id = p_request_id;
        return;
    end if;
    update public.telegram_login_requests set status = 'consumed', completed_at = now()
      where id = p_request_id;
    return query select r.user_id, account_email;
end;
$$;

create or replace function public.create_telegram_support_ticket(
    p_telegram_chat_id text, p_telegram_username text, p_message text, p_topic text
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare t public.telegram_support_tickets%rowtype;
begin
    if p_telegram_chat_id is null or p_telegram_chat_id !~ '^-?[0-9]{1,19}$'
       or p_message is null or length(p_message) not between 1 and 4000 then
        raise exception 'Invalid support ticket';
    end if;
    select * into t from public.telegram_support_tickets
      where telegram_chat_id = p_telegram_chat_id and status = 'open'
      order by created_at desc limit 1 for update;
    if found then
        return jsonb_build_object('ticket_id', t.id, 'ticket_number', t.ticket_number, 'existing', true);
    end if;
    insert into public.telegram_support_tickets (telegram_chat_id, telegram_username, topic)
      values (p_telegram_chat_id, nullif(left(p_telegram_username, 64), ''), coalesce(nullif(left(p_topic, 80), ''), 'Другое'))
      returning * into t;
    insert into public.telegram_support_messages (ticket_id, sender_role, telegram_chat_id, message)
      values (t.id, 'customer', p_telegram_chat_id, p_message);
    return jsonb_build_object('ticket_id', t.id, 'ticket_number', t.ticket_number, 'existing', false);
end;
$$;

create or replace function public.add_telegram_support_message(
    p_ticket_id uuid, p_sender_role text, p_telegram_chat_id text, p_message text
)
returns boolean language plpgsql security definer set search_path = public, pg_temp
as $$
declare t public.telegram_support_tickets%rowtype;
begin
    if p_sender_role is null or p_sender_role not in ('customer', 'support')
       or p_message is null or length(p_message) not between 1 and 4000 then return false; end if;
    select * into t from public.telegram_support_tickets where id = p_ticket_id and status = 'open' for update;
    if not found or (p_sender_role = 'customer' and (
        p_telegram_chat_id is null or t.telegram_chat_id <> p_telegram_chat_id
    )) then return false; end if;
    insert into public.telegram_support_messages (ticket_id, sender_role, telegram_chat_id, message)
      values (p_ticket_id, p_sender_role, p_telegram_chat_id, p_message);
    update public.telegram_support_tickets set updated_at = now() where id = p_ticket_id;
    return true;
end;
$$;

create or replace function public.claim_telegram_webhook_update(p_bot_role text, p_update_id bigint)
returns text language plpgsql security definer set search_path = public, pg_temp
as $$
declare r public.telegram_webhook_updates%rowtype;
begin
    if p_bot_role not in ('admin', 'support') or p_update_id < 0 then return 'invalid'; end if;
    insert into public.telegram_webhook_updates (bot_role, update_id)
      values (p_bot_role, p_update_id) on conflict do nothing;
    select * into r from public.telegram_webhook_updates
      where bot_role = p_bot_role and update_id = p_update_id for update;
    if r.status = 'completed' then return 'completed'; end if;
    if r.status = 'processing' and r.locked_at > now() - interval '2 minutes' then return 'processing'; end if;
    update public.telegram_webhook_updates set status = 'processing', attempts = attempts + 1,
      locked_at = now(), updated_at = now()
      where bot_role = p_bot_role and update_id = p_update_id;
    return 'claimed';
end;
$$;

create or replace function public.complete_telegram_webhook_update(p_bot_role text, p_update_id bigint)
returns boolean language plpgsql security definer set search_path = public, pg_temp
as $$
begin
    update public.telegram_webhook_updates set status = 'completed', completed_at = now(),
      locked_at = null, updated_at = now()
      where bot_role = p_bot_role and update_id = p_update_id and status = 'processing';
    return found;
end;
$$;

create or replace function public.retry_telegram_webhook_update(p_bot_role text, p_update_id bigint)
returns boolean language plpgsql security definer set search_path = public, pg_temp
as $$
begin
    update public.telegram_webhook_updates set status = 'pending', locked_at = null, updated_at = now()
      where bot_role = p_bot_role and update_id = p_update_id and status = 'processing';
    return found;
end;
$$;

do $$
declare fn record;
begin
    for fn in
        select p.oid::regprocedure as signature
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in (
            'get_site_visitors_today', 'record_site_visitor',
            'get_telegram_notification_target', 'start_telegram_account_link',
            'confirm_telegram_link', 'unlink_telegram_account', 'set_telegram_notifications',
            'create_telegram_login_request', 'begin_telegram_login', 'verify_telegram_login',
            'create_telegram_support_ticket', 'add_telegram_support_message',
            'claim_telegram_webhook_update', 'complete_telegram_webhook_update',
            'retry_telegram_webhook_update'
        )
    loop
        execute format('revoke all on function %s from public, anon, authenticated', fn.signature);
        execute format('grant execute on function %s to service_role', fn.signature);
    end loop;
end;
$$;

alter table public.couriers enable row level security;
alter table public.payments enable row level security;
alter table public.telegram_accounts enable row level security;
alter table public.telegram_link_requests enable row level security;
alter table public.telegram_login_requests enable row level security;
alter table public.telegram_admin_audit enable row level security;
alter table public.telegram_bot_states enable row level security;
alter table public.telegram_webhook_updates enable row level security;
alter table public.telegram_support_tickets enable row level security;
alter table public.telegram_support_messages enable row level security;
alter table public.qr_login_requests enable row level security;
alter table public.mfa_recovery_vault enable row level security;
alter table public.site_visitor_daily_counts enable row level security;
alter table public.site_runtime_settings enable row level security;
alter table public.site_public_toasts enable row level security;
alter table public.site_toast_notifications enable row level security;
alter table public.catalog_demo_state enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.favorites enable row level security;
alter table public.wallets enable row level security;
alter table public.devices enable row level security;
alter table public.notification_settings enable row level security;
alter table public.brand_reviews enable row level security;

revoke all on public.couriers, public.payments, public.telegram_accounts,
    public.telegram_link_requests, public.telegram_login_requests,
    public.telegram_admin_audit, public.telegram_bot_states, public.telegram_webhook_updates,
    public.telegram_support_tickets, public.telegram_support_messages,
    public.qr_login_requests, public.mfa_recovery_vault, public.site_visitor_daily_counts,
    public.site_runtime_settings
from anon, authenticated;
grant all on public.couriers, public.payments, public.telegram_accounts,
    public.telegram_link_requests, public.telegram_login_requests,
    public.telegram_admin_audit, public.telegram_bot_states, public.telegram_webhook_updates,
    public.telegram_support_tickets, public.telegram_support_messages,
    public.qr_login_requests, public.mfa_recovery_vault, public.site_visitor_daily_counts,
    public.site_runtime_settings
to service_role;

revoke all on public.site_toast_notifications from anon, authenticated;
revoke insert, update, delete on public.products, public.site_public_toasts, public.catalog_demo_state
from anon, authenticated;
revoke insert, update, delete on public.brand_reviews from anon, authenticated;
revoke insert, update, delete on public.orders from anon, authenticated;
grant select on public.products, public.site_public_toasts, public.catalog_demo_state to anon, authenticated;
grant all on public.products, public.site_public_toasts, public.catalog_demo_state to service_role;
grant select, update on public.site_toast_notifications to authenticated;
grant all on public.site_toast_notifications to service_role;
grant select, insert, update, delete on public.favorites, public.wallets, public.devices,
    public.notification_settings to authenticated;
grant all on public.favorites, public.wallets, public.devices, public.notification_settings to service_role;
grant select on public.orders to authenticated;
grant all on public.orders, public.brand_reviews to service_role;
grant select on public.brand_reviews to anon, authenticated;

do $$
declare table_name text;
begin
    foreach table_name in array array['favorites', 'wallets', 'devices', 'notification_settings'] loop
        if not exists (
            select 1 from pg_policies
            where schemaname = 'public' and tablename = table_name
              and policyname = table_name || '_owner_access'
        ) then
            execute format(
                'create policy %I on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())',
                table_name || '_owner_access', table_name
            );
        end if;
        if not exists (
            select 1 from pg_policies
            where schemaname = 'public' and tablename = table_name
              and policyname = table_name || '_owner_boundary'
        ) then
            execute format(
                'create policy %I on public.%I as restrictive for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())',
                table_name || '_owner_boundary', table_name
            );
        end if;
    end loop;
end;
$$;

do $$
begin
    if not exists (select 1 from pg_policies where schemaname='public' and tablename='orders' and policyname='orders_read_own') then
        create policy orders_read_own on public.orders for select to authenticated using (user_id = auth.uid());
    end if;
    if not exists (select 1 from pg_policies where schemaname='public' and tablename='products' and policyname='products_public_read') then
        create policy products_public_read on public.products for select to anon, authenticated using (true);
    end if;
    if not exists (select 1 from pg_policies where schemaname='public' and tablename='site_public_toasts' and policyname='site_public_toasts_read') then
        create policy site_public_toasts_read on public.site_public_toasts for select to anon, authenticated using (expires_at > now());
    end if;
    if not exists (select 1 from pg_policies where schemaname='public' and tablename='catalog_demo_state' and policyname='catalog_demo_state_public_read') then
        create policy catalog_demo_state_public_read on public.catalog_demo_state for select to anon, authenticated using (true);
    end if;
    if not exists (select 1 from pg_policies where schemaname='public' and tablename='brand_reviews' and policyname='brand_reviews_approved_read') then
        create policy brand_reviews_approved_read on public.brand_reviews for select to anon, authenticated using (status = 'approved');
    end if;
    if not exists (select 1 from pg_policies where schemaname='public' and tablename='site_toast_notifications' and policyname='site_toast_notifications_owner_access') then
        create policy site_toast_notifications_owner_access on public.site_toast_notifications
          for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
    end if;
    if not exists (select 1 from pg_policies where schemaname='public' and tablename='site_toast_notifications' and policyname='site_toast_notifications_owner_boundary') then
        create policy site_toast_notifications_owner_boundary on public.site_toast_notifications as restrictive
          for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
    end if;
    if not exists (select 1 from pg_policies where schemaname='public' and tablename='orders' and policyname='orders_owner_boundary') then
        create policy orders_owner_boundary on public.orders as restrictive
          for select to authenticated using (user_id = auth.uid());
    end if;
    if not exists (select 1 from pg_policies where schemaname='public' and tablename='site_public_toasts' and policyname='site_public_toasts_expiry_boundary') then
        create policy site_public_toasts_expiry_boundary on public.site_public_toasts as restrictive
          for select to anon, authenticated using (expires_at > now());
    end if;
    if not exists (select 1 from pg_policies where schemaname='public' and tablename='brand_reviews' and policyname='brand_reviews_approval_boundary') then
        create policy brand_reviews_approval_boundary on public.brand_reviews as restrictive
          for select to anon, authenticated using (status = 'approved');
    end if;
end;
$$;

do $$
begin
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
        if not exists (
            select 1 from pg_publication_tables
            where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'site_public_toasts'
        ) then
            execute 'alter publication supabase_realtime add table public.site_public_toasts';
        end if;
        if not exists (
            select 1 from pg_publication_tables
            where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'site_toast_notifications'
        ) then
            execute 'alter publication supabase_realtime add table public.site_toast_notifications';
        end if;
    end if;
end;
$$;

commit;
