# Database updates

Only run migrations required by the deployed feature set, and check first which
have already been applied. Do not run these again blindly on production.

1. `catalog-demo-retirement.sql` — hides the three sample catalog cards forever
   after the first product is added. Existing products are detected when the
   script runs, and the database trigger preserves the retired state if products
   are later removed.
2. `orders-checkout.sql` — adds the customer and delivery fields used when a
   signed-in customer submits an order.
3. `catalog-product-options.sql` — adds/normalizes volume, packaging, pressing
   and shelf-life fields used by catalog product management.
4. `telegram-webhook-state.sql` — creates the durable conversation-state and
   update-deduplication tables/RPCs used by the webhook Worker and Layero.
5. `account-delete-cascade.sql` — makes public user-data foreign keys cascade
   on Auth user deletion and adds the missing cascade to UUID `user_id` columns.
   If it reports orphaned user IDs, inspect and resolve those rows before
   rerunning; the migration deliberately does not delete orphaned data.
6. `telegram-security-hardening.sql` — historical hardening for Telegram
   account-linking and webhook objects. Run only if all referenced objects
   already exist; it is not needed for this bot cleanup.
7. `product-reviews-moderation.sql` — converts reviews to a stars-only rating
   format, validates ratings from 1 to 5, indexes product ratings and prevents
   duplicate ratings by the same user. Run it before deploying the rating form;
   it clears legacy text values and does not change RLS policies.

`telegram-link.sql` is a historical migration for Telegram account linking,
which is no longer part of the site. Do not run it for the current feature set.
If it has already been applied, leave its tables, rows, and migration history
intact; bot removal does not require any database changes.

The account deletion API uses the Supabase Auth Admin API to delete the
authenticated user. Supabase Auth owns MFA factors and deletes them with that
user; do not directly modify the managed `auth` schema. The profile's 2FA
disable control unenrolls verified/pending factors and removes the encrypted
recovery-code vault.

For email changes, add `https://drdarsun.ru/auth/confirm.html` (and the `www`
variant if the site uses it) to Supabase **Authentication → URL Configuration
→ Redirect URLs**. In **Authentication → Email Templates → Change Email**, set a
Russian subject and use the body from `../email-templates/change-email-ru.html`.

Order submission is disabled unless the Layero service has
`ORDER_INTAKE_ENABLED=true`; keep it disabled until an order and payment process
is ready. The API enforces this server-side as well as the website UI.
