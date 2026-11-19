alter table public.products
    add column if not exists volume text not null default '250 мл',
    add column if not exists packaging_type text not null default 'Тёмное стекло',
    add column if not exists pressing_type text not null default 'Холодный отжим',
    add column if not exists shelf_life_months integer not null default 6;

alter table public.products
    alter column volume type text using volume::text,
    alter column volume set default '250 мл',
    alter column packaging_type set default 'Тёмное стекло',
    alter column pressing_type set default 'Холодный отжим',
    alter column shelf_life_months set default 6;

update public.products
set volume = coalesce(nullif(btrim(volume), ''), '250 мл'),
    packaging_type = coalesce(nullif(btrim(packaging_type), ''), 'Тёмное стекло'),
    pressing_type = coalesce(nullif(btrim(pressing_type), ''), 'Холодный отжим'),
    shelf_life_months = coalesce(shelf_life_months, 6)
where volume is null
   or btrim(volume) = ''
   or packaging_type is null
   or btrim(packaging_type) = ''
   or pressing_type is null
   or btrim(pressing_type) = ''
   or shelf_life_months is null;

alter table public.products
    alter column volume set not null,
    alter column packaging_type set not null,
    alter column pressing_type set not null,
    alter column shelf_life_months set not null;
