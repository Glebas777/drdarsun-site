# Telegram webhook Worker

The Worker accepts Telegram webhooks and puts updates into Cloudflare Queues before
returning `200` to Telegram. Admin updates use a dedicated queue, so customer and
support traffic cannot hold up the admin bot. Each consumer is limited to one
in-flight batch to keep Layer0 load predictable. Temporary Layer0 failures are
retried with backoff; repeated failures go to a role-specific dead-letter queue.

## Provision queues

Run these once from this directory, using the Cloudflare account that owns the Worker:

```sh
npx wrangler queues create drdarsun-telegram-admin
npx wrangler queues create drdarsun-telegram-bots
npx wrangler queues create drdarsun-telegram-admin-dlq
npx wrangler queues create drdarsun-telegram-bots-dlq
```

On a Cloudflare plan that supports extended retention, optionally run:

```sh
npx wrangler queues update drdarsun-telegram-admin --message-retention-period-secs 1209600
npx wrangler queues update drdarsun-telegram-bots --message-retention-period-secs 1209600
npx wrangler queues update drdarsun-telegram-admin-dlq --message-retention-period-secs 1209600
npx wrangler queues update drdarsun-telegram-bots-dlq --message-retention-period-secs 1209600
```

Queue retention can be limited to 24 hours on the Workers Free plan; longer
retention requires a plan that supports the configured 14 days. Check Cloudflare's
current pricing and limits before enabling Queues.

## Configure and deploy

1. In `wrangler.toml`, set `TELEGRAM_WORKER_PUBLIC_URL` under `[vars]` to this
   Worker's real HTTPS origin (the same origin used by Telegram webhook URLs).
2. Keep the existing Worker secrets configured: bot tokens, per-bot webhook
   secrets, `TELEGRAM_WORKER_SHARED_SECRET`, and `WEBHOOK_ADMIN_SECRET`.
3. Deploy with `npx wrangler deploy`.
4. Register webhooks once with the existing authenticated
   `POST /admin/register-webhooks` endpoint. Do not set `drop_pending_updates` to
   `true`; registration keeps Telegram's pending updates.
5. Check the Cloudflare Queue dashboard after a test `/start`: the admin message
   should appear in `drdarsun-telegram-admin`, then be acknowledged by its
   consumer. General bot messages use `drdarsun-telegram-bots`.

The scheduled Worker checks the admin webhook every five minutes and restores it
if Telegram reports a missing or incorrect URL. It never clears pending updates.
Cloudflare retries queued updates up to 100 times, then stores them in the
admin-specific dead-letter queue instead of discarding them. If that queue is
non-empty, inspect the first failing Layer0/Worker log before replaying messages;
replay only after the underlying error is fixed to avoid a retry loop.

If queues are not provisioned/bound, the Worker falls back to forwarding updates
synchronously to Layer0. This preserves the previous behavior but does not give
the admin bot the isolated retry queue or backlog recovery.
