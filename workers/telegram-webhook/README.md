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

## Legacy combined Worker setup

Use this section only if you intentionally keep a single Worker for all bots.
For the requested one-Worker-per-bot setup, skip to **Isolated Worker per bot**;
do not deploy the combined config alongside the isolated Workers.

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
6. To check deployment bindings and secret presence without exposing values, call
   `GET /admin/health` with `Authorization: Bearer <WEBHOOK_ADMIN_SECRET>`.
   It returns only booleans and bot role names; `200` means required Worker
   configuration and queue bindings are present, while `503` identifies missing
   pieces.

The Layer0 server keeps long polling disabled unless `TELEGRAM_BOTS_ENABLED=true`
is explicitly set. Leave it unset when using this webhook Worker; starting a
polling process calls Telegram `deleteWebhook` and would take bots off the Worker.

The scheduled Worker checks the admin webhook first, then checks every other
configured bot webhook every five minutes. It restores missing or incorrect URLs
without clearing pending updates.
Cloudflare retries queued updates up to 100 times, then stores them in the
role-specific dead-letter queue instead of discarding them. If a DLQ is
non-empty, inspect the first failing Layer0/Worker log before replaying messages;
replay only after the underlying error is fixed to avoid a retry loop.
Retry delay grows exponentially from 5 seconds to a 300-second cap, unless the
backend provides a valid `Retry-After` header.

If queues are not provisioned/bound, the Worker falls back to forwarding updates
synchronously to Layer0. This preserves the previous behavior but does not give
the admin bot the isolated retry queue or backlog recovery.

## Isolated Worker per bot

Before deploying, run `database/telegram-webhook-state.sql` once in this
project's Supabase SQL Editor. The webhook backend uses its tables and RPC
functions to persist bot conversations and safely deduplicate Telegram retries.

The Layer0 backend must also have `TELEGRAM_WORKER_SHARED_SECRET` set to the
same random value entered for every Worker below, plus the bot tokens it uses
for outgoing messages (`ADMIN_BOT_TOKEN`, `PANEL_BOT_TOKEN`,
`CLIENT_BOT_TOKEN`, `CODE_BOT_TOKEN`, and `HELP_BOT_TOKEN`). Set `MY_CHAT_ID`
to the admin owner's numeric Telegram chat ID and `PANEL_CHAT_ID` or `M_CHAT_ID`
to the panel operator's numeric chat ID. Keep `TELEGRAM_BOTS_ENABLED` unset or
set to anything other than `true`; enabling polling calls `deleteWebhook` and
conflicts with these Workers.

To separate every bot completely, create all role queues and deploy each config:

```sh
npx wrangler queues create drdarsun-telegram-panel
npx wrangler queues create drdarsun-telegram-panel-dlq
npx wrangler queues create drdarsun-telegram-client
npx wrangler queues create drdarsun-telegram-client-dlq
npx wrangler queues create drdarsun-telegram-auth
npx wrangler queues create drdarsun-telegram-auth-dlq
npx wrangler queues create drdarsun-telegram-support
npx wrangler queues create drdarsun-telegram-support-dlq
```

Admin queue `drdarsun-telegram-admin` and its DLQ must already exist. Each isolated
Worker has only its role queue and accepts only `/telegram/<its-role>`. Re-register
webhooks through the isolated Admin Worker or call `/admin/register-webhooks` on
each Worker; the endpoint intentionally manages only its own role.

Before deploying, add secrets separately to **each** Worker configuration. The
backend shared secret must match `TELEGRAM_WORKER_SHARED_SECRET` on Layer0; use a
different random `WEBHOOK_ADMIN_SECRET` for each Worker. Add only the matching
bot token and webhook secret:

| Config | Bot token secret | Webhook secret |
| --- | --- | --- |
| `wrangler.admin.toml` | `ADMIN_BOT_TOKEN` | `ADMIN_WEBHOOK_SECRET` |
| `wrangler.panel.toml` | `PANEL_BOT_TOKEN` | `PANEL_WEBHOOK_SECRET` |
| `wrangler.client.toml` | `CLIENT_BOT_TOKEN` | `CLIENT_WEBHOOK_SECRET` |
| `wrangler.auth.toml` | `CODE_BOT_TOKEN` | `AUTH_WEBHOOK_SECRET` |
| `wrangler.support.toml` | `HELP_BOT_TOKEN` | `SUPPORT_WEBHOOK_SECRET` |

For each row, use the matching config and let Wrangler prompt for each value:

```sh
npx wrangler secret put TELEGRAM_WORKER_SHARED_SECRET --config wrangler.admin.toml
npx wrangler secret put WEBHOOK_ADMIN_SECRET --config wrangler.admin.toml
npx wrangler secret put ADMIN_BOT_TOKEN --config wrangler.admin.toml
npx wrangler secret put ADMIN_WEBHOOK_SECRET --config wrangler.admin.toml
npx wrangler deploy --config wrangler.admin.toml
```

Repeat with each config and its two role-specific secret names from the table.
Do not paste tokens or secrets into source files, command history, or chat. Every
isolated Worker has four secrets: the shared backend secret, its admin secret,
its bot token, and its webhook secret. The panel allowlist (`PANEL_CHAT_ID` or
`M_CHAT_ID`) and admin owner (`MY_CHAT_ID`) belong in the Layer0 backend, not in
Cloudflare Worker secrets.

After all five deployments report success, register each webhook using the
matching Worker's own `WEBHOOK_ADMIN_SECRET`:

```sh
curl -i -X POST https://drdarsun-telegram-admin.turgleb7.workers.dev/admin/register-webhooks \
  -H 'Authorization: Bearer <admin worker secret>'
```

Repeat for `panel`, `client`, `auth`, and `support`, substituting each Worker URL
and its own secret. Confirm each registration response has HTTP 200 and
`"success":true` for that role. Then call `/admin/health` on each URL with the
same Worker secret; HTTP 200 checks configuration only, not whether a bot has
processed a real message. Send `/start`, then inspect that Worker’s Queue and
consumer logs plus the Layer0 application logs.

The five isolated configs each run their own five-minute webhook watchdog. Once
they are working, disable or delete the old combined `drdarsun-telegram-webhook`
Worker (or at minimum remove its scheduled trigger and old bot secrets). Its
watchdog can otherwise move the same Telegram webhooks back to the combined
Worker. Do not deploy the combined `wrangler.toml` alongside these isolated
Workers.
