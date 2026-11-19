# Database updates

Before deploying the matching site/backend changes, open the Supabase SQL Editor
for this project and run these scripts in order:

1. `catalog-demo-retirement.sql` — hides the three sample catalog cards forever
   after the first product is added. Existing products are detected when the
   script runs, and the database trigger preserves the retired state if products
   are later removed.
2. `orders-checkout.sql` — adds the customer and delivery fields used when a
   signed-in customer submits an order.
3. `catalog-product-options.sql` — adds/normalizes volume, packaging, pressing
   and shelf-life fields used by panel-bot product creation.
4. `telegram-link.sql` — creates the account-link request/account tables, the
   one-time link confirmation RPC, and customer notification preferences used by
   the website and client bot.
5. `telegram-webhook-state.sql` — creates the durable conversation-state and
   update-deduplication tables/RPCs used by the per-bot webhook Workers.
6. `account-delete-cascade.sql` — makes public user-data foreign keys cascade
   on Auth user deletion and adds the missing cascade to UUID `user_id` columns.
   Run this last. If it reports orphaned user IDs, inspect and resolve those rows
   before rerunning; the migration deliberately does not delete orphaned data.

The account deletion API uses the Supabase Auth Admin API to delete the
authenticated user. Supabase Auth owns MFA factors and deletes them with that
user; do not directly modify the managed `auth` schema. The profile's 2FA
disable control unenrolls verified/pending factors and removes the encrypted
recovery-code vault.

For email changes, add `https://drdarsun.ru/auth/confirm.html` (and the `www`
variant if the site uses it) to Supabase **Authentication → URL Configuration
→ Redirect URLs**. In **Authentication → Email Templates → Change Email**, set a
Russian subject and use the body from `../email-templates/change-email-ru.html`.

The checkout creates a pending order using prices read from the database, not the
browser cart. It does not collect payment online; confirm the order and payment
method with the customer before processing it. After the migration, the panel
bot's orders list includes the customer's name, account email, and delivery
address.
