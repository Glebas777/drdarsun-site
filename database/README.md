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
4. `telegram-webhook-state.sql` — creates the durable conversation-state and
   update-deduplication tables/RPCs used by the per-bot webhook Workers.

The checkout creates a pending order using prices read from the database, not the
browser cart. It does not collect payment online; confirm the order and payment
method with the customer before processing it. After the migration, the panel
bot's orders list includes the customer's name, account email, and delivery
address.
