create table if not exists public.telegram_bot_states (
    bot_role text not null check (bot_role in ('client', 'admin', 'panel', 'auth', 'support')),
    telegram_chat_id text not null,
    state jsonb not null default '{}'::jsonb,
    updated_at timestamptz not null default now(),
    primary key (bot_role, telegram_chat_id)
);

alter table public.telegram_bot_states enable row level security;
revoke all on public.telegram_bot_states from anon, authenticated;
grant all on public.telegram_bot_states to service_role;

create table if not exists public.telegram_webhook_updates (
    bot_role text not null check (bot_role in ('client', 'admin', 'panel', 'auth', 'support')),
    update_id bigint not null,
    status text not null check (status in ('processing', 'completed')),
    claimed_at timestamptz not null default now(),
    completed_at timestamptz,
    primary key (bot_role, update_id)
);

create index if not exists telegram_webhook_updates_completed_at_idx
    on public.telegram_webhook_updates (completed_at)
    where status = 'completed';

alter table public.telegram_webhook_updates enable row level security;
revoke all on public.telegram_webhook_updates from anon, authenticated;
grant all on public.telegram_webhook_updates to service_role;

create or replace function public.claim_telegram_webhook_update(
    p_bot_role text,
    p_update_id bigint
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    claimed_status text;
begin
    delete from public.telegram_webhook_updates
    where status = 'completed'
      and completed_at < now() - interval '30 days';

    insert into public.telegram_webhook_updates (bot_role, update_id, status, claimed_at, completed_at)
    values (p_bot_role, p_update_id, 'processing', now(), null)
    on conflict (bot_role, update_id) do update
        set status = 'processing',
            claimed_at = now(),
            completed_at = null
        where telegram_webhook_updates.status <> 'completed'
          and telegram_webhook_updates.claimed_at < now() - interval '2 minutes'
    returning status into claimed_status;

    if claimed_status = 'processing' then
        return 'claimed';
    end if;

    select status
    into claimed_status
    from public.telegram_webhook_updates
    where bot_role = p_bot_role
      and update_id = p_update_id;

    if claimed_status = 'completed' then
        return 'completed';
    end if;

    return 'processing';
end;
$$;

create or replace function public.complete_telegram_webhook_update(
    p_bot_role text,
    p_update_id bigint
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    update public.telegram_webhook_updates
    set status = 'completed',
        completed_at = now()
    where bot_role = p_bot_role
      and update_id = p_update_id
      and status = 'processing';

    return found;
end;
$$;

create or replace function public.retry_telegram_webhook_update(
    p_bot_role text,
    p_update_id bigint
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    update public.telegram_webhook_updates
    set claimed_at = now() - interval '2 minutes'
    where bot_role = p_bot_role
      and update_id = p_update_id
      and status = 'processing';

    return found;
end;
$$;

revoke all on function public.claim_telegram_webhook_update(text, bigint) from public, anon, authenticated;
revoke all on function public.complete_telegram_webhook_update(text, bigint) from public, anon, authenticated;
revoke all on function public.retry_telegram_webhook_update(text, bigint) from public, anon, authenticated;
grant execute on function public.claim_telegram_webhook_update(text, bigint) to service_role;
grant execute on function public.complete_telegram_webhook_update(text, bigint) to service_role;
grant execute on function public.retry_telegram_webhook_update(text, bigint) to service_role;
