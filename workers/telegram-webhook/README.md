# Telegram webhook Workers

The website and Telegram bot logic run on **Layero**. These Cloudflare Workers
only validate Telegram webhook requests and forward them to Layero. Each
Worker serves its configured roles using the shared `src/index.mjs` handler:

| Config | Worker | Roles |
| --- | --- | --- |
| `wrangler.toml` | `drdarsun-tg-a` | `admin` |

There are no queue bindings or Cron Triggers in these configs. The webhook
handler forwards each valid update to Layero before acknowledging it to
Telegram. This intentionally does **not** use `ctx.waitUntil()`: acknowledging
before Layero confirms delivery would lose updates when the background request
fails. Network wait does not count toward Workers CPU time.

## Secrets

Add secrets through Wrangler's interactive prompt; do not write their values in
this file, source control, or shell history. Keep the existing shared secret
unchanged unless intentionally rotating it on both Cloudflare and Layero.

```sh
# Worker A
npx wrangler secret put TELEGRAM_WORKER_SHARED_SECRET --config workers/telegram-webhook/wrangler.toml
npx wrangler secret put WEBHOOK_ADMIN_SECRET --config workers/telegram-webhook/wrangler.toml
npx wrangler secret put ADMIN_BOT_TOKEN --config workers/telegram-webhook/wrangler.toml
npx wrangler secret put ADMIN_WEBHOOK_SECRET --config workers/telegram-webhook/wrangler.toml
```

`TELEGRAM_WORKER_SHARED_SECRET` must match Layero's configured value.
Each bot's `*_WEBHOOK_SECRET` must match the value Telegram sends in
`X-Telegram-Bot-Api-Secret-Token`. Keep `TELEGRAM_BOTS_ENABLED` disabled on
Layero; polling conflicts with webhook delivery.

## Deploy and register

Deploy the only Worker after verifying the secret and the Layero URL:

```sh
npx wrangler deploy --config workers/telegram-webhook/wrangler.toml
```

Register each Worker independently. Use the actual admin secret in a local
terminal and do not commit it:

```sh
curl -sS -X POST \
  -H 'X-Admin-Secret: <WEBHOOK_ADMIN_SECRET>' \
  https://drdarsun-tg-a.turgleb7.workers.dev/admin/register

```

Each successful response reports only its configured roles. The webhook
URLs are `/telegram/<role>`; allowed updates remain `message` and
`callback_query`. Registration uses up to 10 connections per bot.

## Retiring the account-code bot

Before deploying the support-only Worker B, call Telegram's `deleteWebhook`
for the retired account-code bot with `drop_pending_updates=false` and verify
Telegram confirms success. This prevents Telegram from retrying updates against
the removed `/telegram/auth` route. Do not delete the bot itself or discard
pending updates unless that is explicitly intended.

After confirming the webhook is deleted, deploy Worker B and remove its
obsolete secrets:

```sh
npx wrangler secret delete CODE_BOT_TOKEN
npx wrangler secret delete AUTH_WEBHOOK_SECRET
```

The website's normal email/password login and email password recovery remain
available. Existing Telegram-link rows and database migrations are left intact;
this code change does not modify production data.

## Migration and monitoring

Do not delete the old Workers or queues until both new registrations succeed,
updates reach Layero, and the old queue consumers have been detached. Review
queued messages before deleting queues. Never remove consumers or queues just
to make a deployment succeed.

Cloudflare's CPU metric excludes time waiting on `fetch()`. Check invocation
logs for forwarding status/errors and inspect CPU metrics before optimizing
JavaScript. There should be no idle invocations without webhook traffic or a
Cron Trigger. Queue retry reads no longer apply to this queue-free config.
