create table if not exists public.telegram_accounts (
    user_id uuid primary key references auth.users (id) on delete cascade,
    telegram_chat_id text not null unique,
    telegram_username text,
    linked_at timestamptz not null default now()
);

alter table public.telegram_accounts
    add column if not exists telegram_chat_id text,
    add column if not exists telegram_username text,
    add column if not exists linked_at timestamptz not null default now();

create unique index if not exists telegram_accounts_chat_id_uidx
    on public.telegram_accounts (telegram_chat_id);
create unique index if not exists telegram_accounts_user_id_uidx
    on public.telegram_accounts (user_id);

alter table public.telegram_accounts enable row level security;
revoke all on public.telegram_accounts from anon, authenticated;
grant all on public.telegram_accounts to service_role;

create table if not exists public.telegram_link_requests (
    code_hash text primary key check (code_hash ~ '^[0-9a-f]{64}$'),
    user_id uuid not null references auth.users (id) on delete cascade,
    email text not null,
    expires_at timestamptz not null,
    created_at timestamptz not null default now()
);

alter table public.telegram_link_requests enable row level security;
revoke all on public.telegram_link_requests from anon, authenticated;
grant all on public.telegram_link_requests to service_role;

create index if not exists telegram_link_requests_expiry_idx
    on public.telegram_link_requests (expires_at);

create or replace function public.confirm_telegram_link(
    p_code_hash text,
    p_telegram_chat_id text,
    p_telegram_username text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    link_request public.telegram_link_requests%rowtype;
begin
    if p_code_hash !~ '^[0-9a-f]{64}$'
       or p_telegram_chat_id !~ '^-?[0-9]{1,19}$' then
        return false;
    end if;

    select *
    into link_request
    from public.telegram_link_requests
    where code_hash = p_code_hash
      and expires_at > now()
    for update;

    if not found then
        return false;
    end if;

    if exists (
        select 1
        from public.telegram_accounts
        where user_id = link_request.user_id
           or telegram_chat_id = p_telegram_chat_id
    ) then
        return false;
    end if;

    insert into public.telegram_accounts (
        user_id,
        telegram_chat_id,
        telegram_username,
        linked_at
    )
    values (
        link_request.user_id,
        p_telegram_chat_id,
        nullif(left(regexp_replace(coalesce(p_telegram_username, ''), '^@', ''), 64), ''),
        now()
    );

    delete from public.telegram_link_requests
    where code_hash = p_code_hash;

    return true;
exception
    when unique_violation then
        return false;
end;
$$;

revoke all on function public.confirm_telegram_link(text, text, text)
    from public, anon, authenticated;
grant execute on function public.confirm_telegram_link(text, text, text)
    to service_role;

create table if not exists public.notification_settings (
    user_id uuid primary key references auth.users (id) on delete cascade,
    email_enabled boolean not null default false,
    telegram_enabled boolean not null default false,
    updated_at timestamptz not null default now()
);

alter table public.notification_settings
    add column if not exists email_enabled boolean not null default false,
    add column if not exists telegram_enabled boolean not null default false,
    add column if not exists updated_at timestamptz not null default now();

create unique index if not exists notification_settings_user_id_uidx
    on public.notification_settings (user_id);

alter table public.notification_settings enable row level security;
revoke all on public.notification_settings from anon, authenticated;
grant select, insert, update on public.notification_settings to authenticated;
grant all on public.notification_settings to service_role;

drop policy if exists "Users manage their own notification settings"
    on public.notification_settings;
create policy "Users manage their own notification settings"
    on public.notification_settings
    for all
    to authenticated
    using ((select auth.uid()) = user_id)
    with check ((select auth.uid()) = user_id);
