alter table public.brand_reviews
    add column if not exists review_text text;
