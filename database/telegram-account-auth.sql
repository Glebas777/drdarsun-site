begin;

create table if not exists public.telegram_accounts (
    user_id uuid primary key references auth.users (id) on delete cascade,
    email text,
    telegram_chat_id text not null unique,
    telegram_username text,
    linked_at timestamptz not null default now(),
    last_login_code_at timestamptz
);

alter table public.telegram_accounts
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

alter table public.telegram_accounts enable row level security;
revoke all on public.telegram_accounts from anon, authenticated;
grant all on public.telegram_accounts to service_role;

create table if not exists public.telegram_link_requests (
    code_hash text primary key check (code_hash ~ '^[0-9a-f]{64}$'),
    user_id uuid not null references auth.users (id) on delete cascade,
    email text not null,
    expires_at timestamptz not null,
    created_at timestamptz not null default now(),
    telegram_chat_id text,
    consumed_at timestamptz
);

alter table public.telegram_link_requests
    add column if not exists telegram_chat_id text,
    add column if not exists consumed_at timestamptz;

alter table public.telegram_link_requests
    alter column telegram_chat_id type text using telegram_chat_id::text;

create index if not exists telegram_link_requests_expiry_idx
    on public.telegram_link_requests (expires_at);
create index if not exists telegram_link_requests_user_idx
    on public.telegram_link_requests (user_id);

alter table public.telegram_link_requests enable row level security;
revoke all on public.telegram_link_requests from anon, authenticated;
grant all on public.telegram_link_requests to service_role;

create table if not exists public.telegram_login_requests (
    id text primary key check (id ~ '^[0-9a-f]{48}$'),
    poll_token_hash text not null check (poll_token_hash ~ '^[0-9a-f]{64}$'),
    status text not null default 'pending'
        check (status in ('pending', 'code_sent', 'consumed', 'locked')),
    user_id uuid references auth.users (id) on delete cascade,
    telegram_chat_id text,
    code_hash text check (code_hash is null or code_hash ~ '^[0-9a-f]{64}$'),
    attempts integer not null default 0 check (attempts between 0 and 5),
    created_at timestamptz not null default now(),
    code_sent_at timestamptz,
    expires_at timestamptz not null,
    completed_at timestamptz
);

create index if not exists telegram_login_requests_expiry_idx
    on public.telegram_login_requests (expires_at);
create index if not exists telegram_login_requests_user_idx
    on public.telegram_login_requests (user_id);

alter table public.telegram_login_requests enable row level security;
revoke all on public.telegram_login_requests from anon, authenticated;
grant all on public.telegram_login_requests to service_role;

alter table public.telegram_login_requests
    alter column telegram_chat_id type text using telegram_chat_id::text;

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

create or replace function public.get_telegram_notification_target(p_user_id uuid)
returns text
language sql
security definer
set search_path = public, pg_temp
as $$
    select account.telegram_chat_id
    from public.telegram_accounts account
    join public.notification_settings settings
      on settings.user_id = account.user_id
    where account.user_id = p_user_id
      and settings.telegram_enabled = true
    limit 1
$$;

create or replace function public.start_telegram_account_link(
    p_user_id uuid,
    p_email text,
    p_code_hash text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    delete from public.telegram_link_requests
    where expires_at <= now();

    if p_user_id is null
       or p_email is null
       or length(p_email) > 254
       or p_code_hash !~ '^[0-9a-f]{64}$' then
        raise exception 'Invalid Telegram link request';
    end if;

    delete from public.telegram_link_requests
    where user_id = p_user_id
      and consumed_at is null;

    insert into public.telegram_link_requests (code_hash, user_id, email, expires_at)
    values (p_code_hash, p_user_id, p_email, now() + interval '10 minutes');
end;
$$;

create or replace function public.create_telegram_login_request(
    p_id text,
    p_poll_token_hash text,
    p_expires_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    if p_id !~ '^[0-9a-f]{48}$'
       or p_poll_token_hash !~ '^[0-9a-f]{64}$'
       or p_expires_at <= now()
       or p_expires_at > now() + interval '10 minutes' then
        raise exception 'Invalid Telegram login request';
    end if;

    delete from public.telegram_login_requests
    where expires_at <= now();

    insert into public.telegram_login_requests (
        id,
        poll_token_hash,
        expires_at
    )
    values (
        p_id,
        p_poll_token_hash,
        p_expires_at
    );
end;
$$;

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
       or p_telegram_chat_id !~ '^[0-9]{1,19}$' then
        return false;
    end if;

    select *
    into link_request
    from public.telegram_link_requests
    where code_hash = p_code_hash
    for update;

    if not found then
        return false;
    end if;

    if link_request.consumed_at is not null then
        return link_request.telegram_chat_id = p_telegram_chat_id
            and exists (
                select 1
                from public.telegram_accounts account
                where account.user_id = link_request.user_id
                  and account.telegram_chat_id = p_telegram_chat_id
            );
    end if;

    if link_request.expires_at <= now()
       or exists (
           select 1
           from public.telegram_accounts account
           where account.user_id = link_request.user_id
              or account.telegram_chat_id = p_telegram_chat_id
       ) then
        return false;
    end if;

    insert into public.telegram_accounts (
        user_id,
        email,
        telegram_chat_id,
        telegram_username,
        linked_at
    )
    values (
        link_request.user_id,
        link_request.email,
        p_telegram_chat_id,
        nullif(left(regexp_replace(coalesce(p_telegram_username, ''), '^@', ''), 64), ''),
        now()
    );

    update public.telegram_link_requests
    set telegram_chat_id = p_telegram_chat_id,
        consumed_at = now()
    where code_hash = p_code_hash;

    return true;
exception
    when unique_violation then
        return false;
end;
$$;

create or replace function public.unlink_telegram_account(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    deleted_count integer;
begin
    delete from public.telegram_accounts
    where user_id = p_user_id;
    get diagnostics deleted_count = row_count;

    update public.notification_settings
    set telegram_enabled = false,
        updated_at = now()
    where user_id = p_user_id;

    delete from public.telegram_link_requests
    where user_id = p_user_id
      and consumed_at is null;

    return deleted_count > 0;
end;
$$;

create or replace function public.set_telegram_notifications(
    p_user_id uuid,
    p_enabled boolean
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    if p_enabled and not exists (
        select 1 from public.telegram_accounts where user_id = p_user_id
    ) then
        return false;
    end if;

    insert into public.notification_settings (
        user_id,
        email_enabled,
        telegram_enabled,
        updated_at
    )
    values (p_user_id, false, p_enabled, now())
    on conflict (user_id) do update
    set telegram_enabled = excluded.telegram_enabled,
        updated_at = now();

    return true;
end;
$$;

create or replace function public.begin_telegram_login(
    p_request_id text,
    p_telegram_chat_id text,
    p_code_hash text
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    login_request public.telegram_login_requests%rowtype;
    linked_account public.telegram_accounts%rowtype;
begin
    if p_request_id !~ '^[0-9a-f]{48}$'
       or p_telegram_chat_id !~ '^[0-9]{1,19}$'
       or p_code_hash !~ '^[0-9a-f]{64}$' then
        return null;
    end if;

    select *
    into login_request
    from public.telegram_login_requests
    where id = p_request_id
    for update;

    if not found then
        return null;
    end if;

    select *
    into linked_account
    from public.telegram_accounts
    where telegram_chat_id = p_telegram_chat_id
    for update;

    if not found then
        return null;
    end if;

    if login_request.status = 'code_sent' then
        if login_request.user_id = linked_account.user_id
           and login_request.telegram_chat_id = p_telegram_chat_id
           and login_request.code_hash = p_code_hash
           and login_request.expires_at > now() then
            return p_telegram_chat_id;
        end if;
        return null;
    end if;

    if login_request.status <> 'pending'
       or login_request.expires_at <= now()
       or linked_account.last_login_code_at > now() - interval '60 seconds' then
        return null;
    end if;

    update public.telegram_login_requests
    set status = 'code_sent',
        user_id = linked_account.user_id,
        telegram_chat_id = p_telegram_chat_id,
        code_hash = p_code_hash,
        attempts = 0,
        code_sent_at = now(),
        expires_at = now() + interval '5 minutes'
    where id = p_request_id;

    update public.telegram_accounts
    set last_login_code_at = now()
    where user_id = linked_account.user_id;

    return p_telegram_chat_id;
end;
$$;

create or replace function public.verify_telegram_login(
    p_request_id text,
    p_poll_token_hash text,
    p_code_hash text
)
returns table(user_id uuid, email text)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
    login_request public.telegram_login_requests%rowtype;
    account_email text;
begin
    if p_request_id !~ '^[0-9a-f]{48}$'
       or p_poll_token_hash !~ '^[0-9a-f]{64}$'
       or p_code_hash !~ '^[0-9a-f]{64}$' then
        return;
    end if;

    select *
    into login_request
    from public.telegram_login_requests
    where id = p_request_id
    for update;

    if not found
       or login_request.poll_token_hash <> p_poll_token_hash
       or login_request.status <> 'code_sent'
       or login_request.expires_at <= now()
       or login_request.attempts >= 5 then
        return;
    end if;

    if login_request.code_hash <> p_code_hash then
        update public.telegram_login_requests
        set attempts = attempts + 1,
            status = case when attempts + 1 >= 5 then 'locked' else status end
        where id = p_request_id;
        return;
    end if;

    select auth_user.email
    into account_email
    from auth.users auth_user
    where auth_user.id = login_request.user_id
      and exists (
          select 1
          from public.telegram_accounts account
          where account.user_id = auth_user.id
            and account.telegram_chat_id = login_request.telegram_chat_id
      );

    if account_email is null then
        update public.telegram_login_requests
        set status = 'locked'
        where id = p_request_id;
        return;
    end if;

    update public.telegram_login_requests
    set status = 'consumed',
        completed_at = now()
    where id = p_request_id;

    return query select login_request.user_id, account_email;
end;
$$;

revoke all on function public.start_telegram_account_link(uuid, text, text)
    from public, anon, authenticated;
revoke all on function public.confirm_telegram_link(text, text, text)
    from public, anon, authenticated;
revoke all on function public.create_telegram_login_request(text, text, timestamptz)
    from public, anon, authenticated;
revoke all on function public.unlink_telegram_account(uuid)
    from public, anon, authenticated;
revoke all on function public.set_telegram_notifications(uuid, boolean)
    from public, anon, authenticated;
revoke all on function public.begin_telegram_login(text, text, text)
    from public, anon, authenticated;
revoke all on function public.verify_telegram_login(text, text, text)
    from public, anon, authenticated;
revoke all on function public.get_telegram_notification_target(uuid)
    from public, anon, authenticated;

grant execute on function public.start_telegram_account_link(uuid, text, text) to service_role;
grant execute on function public.confirm_telegram_link(text, text, text) to service_role;
grant execute on function public.create_telegram_login_request(text, text, timestamptz) to service_role;
grant execute on function public.unlink_telegram_account(uuid) to service_role;
grant execute on function public.set_telegram_notifications(uuid, boolean) to service_role;
grant execute on function public.begin_telegram_login(text, text, text) to service_role;
grant execute on function public.verify_telegram_login(text, text, text) to service_role;
grant execute on function public.get_telegram_notification_target(uuid) to service_role;

commit;
