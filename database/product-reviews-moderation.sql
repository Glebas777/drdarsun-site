-- Stars-only reviews migration.
-- Text is optional legacy data and is no longer collected or displayed.
ALTER TABLE public.brand_reviews
    ADD COLUMN IF NOT EXISTS product_id text;

ALTER TABLE public.brand_reviews
    ALTER COLUMN review_text SET DEFAULT '';

UPDATE public.brand_reviews
SET review_text = ''
WHERE review_text IS NULL;

ALTER TABLE public.brand_reviews
    ALTER COLUMN review_text SET NOT NULL;

ALTER TABLE public.brand_reviews
    DROP CONSTRAINT IF EXISTS brand_reviews_rating_check;

ALTER TABLE public.brand_reviews
    ADD CONSTRAINT brand_reviews_rating_check
    CHECK (rating BETWEEN 1 AND 5);

CREATE INDEX IF NOT EXISTS brand_reviews_product_status_created_at_idx
    ON public.brand_reviews (product_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS brand_reviews_product_rating_idx
    ON public.brand_reviews (product_id, rating);

CREATE UNIQUE INDEX IF NOT EXISTS brand_reviews_unique_user_product_idx
    ON public.brand_reviews (user_id, COALESCE(product_id, '__brand__'))
    WHERE user_id IS NOT NULL;
