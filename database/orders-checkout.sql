alter table public.orders
    add column if not exists customer_name text,
    add column if not exists customer_email text,
    add column if not exists delivery_address text,
    add column if not exists payment_method text not null default 'upon_confirmation';
