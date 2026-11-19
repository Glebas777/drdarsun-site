create table if not exists public.catalog_demo_state (
    id integer primary key check (id = 1),
    retired boolean not null default false,
    retired_at timestamptz
);

alter table public.catalog_demo_state enable row level security;

revoke all on public.catalog_demo_state from anon, authenticated;
grant select on public.catalog_demo_state to anon, authenticated;

drop policy if exists catalog_demo_state_public_read on public.catalog_demo_state;
create policy catalog_demo_state_public_read
    on public.catalog_demo_state
    for select
    to anon, authenticated
    using (true);

insert into public.catalog_demo_state (id, retired, retired_at)
values (
    1,
    exists (select 1 from public.products limit 1),
    case when exists (select 1 from public.products limit 1) then now() else null end
)
on conflict (id) do update
set retired = public.catalog_demo_state.retired or excluded.retired,
    retired_at = coalesce(public.catalog_demo_state.retired_at, excluded.retired_at);

create or replace function public.retire_catalog_demos_after_product_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
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

drop trigger if exists retire_catalog_demos_after_product_insert on public.products;
create trigger retire_catalog_demos_after_product_insert
    after insert on public.products
    for each row
    execute function public.retire_catalog_demos_after_product_insert();