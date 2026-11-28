# Telegram webhook Workers

The website and Telegram bot logic run on **Layero**. This Cloudflare Worker
only validates Telegram webhook requests and forwards them to Layero. Admin
order/product panel commands run through the admin bot; the public support bot
remains separate. A client bot can be enabled on this same webhook Worker:

| Config | Worker | Roles |
| --- | --- | --- |
| `wrangler.toml` | `drdarsun-tg-a` | `admin`, `support`, `client` |

There are no queue bindings or Cron Triggers in these configs. The webhook
handler forwards each valid update to Layero before acknowledging it to
Telegram. This intentionally does **not** use `ctx.waitUntil()`: acknowledging
before Layero confirms delivery would lose updates when the background request
fails. Network wait does not count toward Workers CPU time. The Worker has no
polling loop, scheduled task, queue consumer, or Supabase connection. The
Layero webhook handler performs idempotent update claims, and the database
account-link/login procedures are safe to retry. The client bot only accesses
the database for a link confirmation or an explicitly requested login code.

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
npx wrangler secret put HELP_BOT_TOKEN --config workers/telegram-webhook/wrangler.toml
npx wrangler secret put SUPPORT_WEBHOOK_SECRET --config workers/telegram-webhook/wrangler.toml
npx wrangler secret put CLIENT_BOT_TOKEN --config workers/telegram-webhook/wrangler.toml
npx wrangler secret put CLIENT_WEBHOOK_SECRET --config workers/telegram-webhook/wrangler.toml
```

`TELEGRAM_WORKER_SHARED_SECRET` must match Layero's configured value.
Each bot's `*_WEBHOOK_SECRET` must match the value Telegram sends in
`X-Telegram-Bot-Api-Secret-Token`. Keep `TELEGRAM_BOTS_ENABLED` disabled on
Layero; polling conflicts with webhook delivery. `HELP_BOT_TOKEN` must also be
configured in Layero so the support bot can send replies and access its API.
The support link points to the existing support account at `@darsunhelp` by
default; no third bot or extra Layer0 variable is needed. Set
`SUPPORT_BOT_USERNAME` as a regular Layer0 variable only if that username
changes.
The client bot token must also be added to Layero Secrets as `CLIENT_BOT_TOKEN`
so Layero can reply to `/start` and other messages. The token in a local `.env`
is not read by Wrangler during deploy; paste it only into Wrangler's hidden
interactive prompt and Layero's secret manager. Never put it in `wrangler.toml`.
Set `CLIENT_BOT_USERNAME` as a regular Layero variable without the leading
`@`. The login, registration, and about pages use the public
`/api/telegram/client/info` endpoint to reveal cached `t.me` links for the
configured client and support bots; the tokens are never sent to the browser.

## Deploy and register

Deploy the only Worker after verifying the secret and the Layero URL:

```sh
npx wrangler deploy --config workers/telegram-webhook/wrangler.toml
```

After deploying, run `workers/telegram-webhook/register-webhook.sh` from an
interactive terminal. It checks Worker health and registers all active bots,
including the client bot. To retry one bot without touching the others, pass
its role, for example `bash workers/telegram-webhook/register-webhook.sh client`.
If Telegram returns HTTP 429, the response includes `retry_after`; wait at least
that many seconds before retrying. The client bot supports account linking,
requested one-time login codes, and opt-in personal Telegram notifications.

Register all enabled bots together. The health endpoint checks that all roles
in `WORKER_ROLES` have their secrets before registration. Use the actual admin
secret in a local terminal and do not commit it:

```sh
curl -sS -X POST \
  -H 'X-Admin-Secret: <WEBHOOK_ADMIN_SECRET>' \
  https://drdarsun-tg-a.turgleb7.workers.dev/admin/register
```

Each successful response reports the registered roles. The helper script can
also run the health check and registration:
`workers/telegram-webhook/register-webhook.sh`.
The webhook URLs are `/telegram/<role>`; allowed updates remain `message` and
`callback_query`. Registration uses up to 10 connections per bot.

## Retiring the account-code bot

If the retired account-code bot still has a webhook, call Telegram's
`deleteWebhook` with `drop_pending_updates=false` and verify Telegram confirms
success. This prevents Telegram from retrying updates against the removed
`/telegram/auth` route. Do not delete the bot itself or discard pending updates
unless that is explicitly intended.

After confirming the webhook is deleted, remove its obsolete secrets from the
Worker:

```sh
npx wrangler secret delete CODE_BOT_TOKEN
npx wrangler secret delete AUTH_WEBHOOK_SECRET
```

The website's normal email/password login and email password recovery remain
available. Existing Telegram-link rows and database migrations are left intact;
this code change does not modify production data.

## Client account linking, login, and notifications

Before deploying the Layero site/API change, apply
[`database/telegram-account-auth.sql`](../../database/telegram-account-auth.sql)
in the Supabase SQL Editor. It extends the existing Telegram tables and
notification settings without removing linked accounts or existing settings.
It preserves existing Telegram chat IDs while normalizing their columns to
text, and stores only hashes of link/login challenges. The migration restricts
the RPCs and private tables to `service_role` and expires old pending requests
during new requests. Link confirmation also populates the legacy account
`email` column from the authenticated linking request. If the migration was
already applied, safely run the updated SQL file again to fix older schema
columns and the link RPC.

Set `CLIENT_BOT_USERNAME` in Layero to the existing client bot username without
`@`. Layero also needs `CLIENT_BOT_TOKEN`, `TELEGRAM_WORKER_SHARED_SECRET`,
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`. The
shared secret must match the existing Worker value. Do not copy secret values
into this repository or redeploy/rotate Worker secrets for this site-only
change.

After applying the SQL, push and deploy the Layero application. If the client
bot webhook is already registered and Worker health is green, no Worker
redeploy or webhook re-registration is needed. The site exposes Telegram
link/unlink controls in the profile, a separate opt-in notification toggle,
and Telegram login on the sign-in page. Login codes are sent only after the
client bot is opened from a fresh login request and only to the Telegram chat
already linked to that account. The existing multi-factor authentication
check still runs after the Telegram code succeeds.

Telegram notifications cover personal site toasts, order creation, order
status changes, and online-payment outcomes. Public all-visitor banners remain
site banners; they are not sent as mass Telegram messages. Login codes are
request-only and are not recurring notifications.

## Migration and monitoring

Do not delete the old Workers or queues until both new registrations succeed,
updates reach Layero, and the old queue consumers have been detached. Review
queued messages before deleting queues. Never remove consumers or queues just
to make a deployment succeed.

Cloudflare's CPU metric excludes time waiting on `fetch()`. Check invocation
logs for forwarding status/errors and inspect CPU metrics before optimizing
JavaScript. There should be no idle invocations without webhook traffic or a
Cron Trigger. Queue retry reads no longer apply to this queue-free config.
