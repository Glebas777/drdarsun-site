const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

let createHandler;

test.before(async () => {
    ({ createHandler } = await import('../workers/telegram-webhook/src/index.mjs'));
});

test('webhook registration script sends the admin header expected by the Worker', () => {
    const script = fs.readFileSync('workers/telegram-webhook/register-webhook.sh', 'utf8');
    assert.match(script, /header = "X-Admin-Secret: %s"/);
    assert.doesNotMatch(script, /header = "Authorization:/);
});

const env = {
    LAYER0_API_BASE_URL: 'https://backend.example',
    TELEGRAM_WORKER_PUBLIC_URL: 'https://worker.example',
    TELEGRAM_WORKER_SHARED_SECRET: 'test-only-shared-secret-long-enough-for-tests',
    WEBHOOK_ADMIN_SECRET: 'test-only-admin-secret',
    ADMIN_BOT_TOKEN: 'admin-token',
    ADMIN_WEBHOOK_SECRET: 'admin-secret',
    HELP_BOT_TOKEN: 'support-token',
    SUPPORT_WEBHOOK_SECRET: 'support-secret',
    CLIENT_BOT_TOKEN: 'client-token',
    CLIENT_WEBHOOK_SECRET: 'client-secret',
    WORKER_ROLES: 'admin,support,client'
};

test('only the configured admin, support and client routes are accepted', async () => {
    const handler = createHandler(env);

    for (const role of ['auth', 'panel']) {
        const response = await handler(new Request(`https://worker.example/telegram/${role}`, {
            method: 'POST',
            headers: { 'X-Telegram-Bot-Api-Secret-Token': 'anything' },
            body: '{"update_id":1}'
        }));
        assert.equal(response.status, 404);
    }

    const unauthorized = await handler(new Request('https://worker.example/telegram/admin', {
        method: 'POST',
        headers: { 'X-Telegram-Bot-Api-Secret-Token': 'wrong' },
        body: '{"update_id":1}'
    }));
    assert.equal(unauthorized.status, 401);
});

test('registration configures all active bots with delivery limits', async () => {
    const calls = [];
    const handler = createHandler(env, async (url, options) => {
        calls.push({ url: String(url), body: JSON.parse(options.body) });
        return Response.json({ ok: true, result: true });
    });
    const response = await handler(new Request('https://worker.example/admin/register', {
        method: 'POST',
        headers: { 'X-Admin-Secret': env.WEBHOOK_ADMIN_SECRET }
    }));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.success, true);
    assert.deepEqual(body.results.map(result => result.role), ['admin', 'support', 'client']);
    assert.deepEqual(calls.map(call => call.body.url), [
        'https://worker.example/telegram/admin',
        'https://worker.example/telegram/support',
        'https://worker.example/telegram/client'
    ]);
    assert.equal(calls[0].body.max_connections, 10);
    assert.deepEqual(calls[0].body.allowed_updates, ['message', 'callback_query']);
});

test('single-role registration touches only the requested bot', async () => {
    const calls = [];
    const handler = createHandler(env, async (url, options) => {
        calls.push({ url: String(url), body: JSON.parse(options.body) });
        return Response.json({ ok: true, result: true });
    });
    const response = await handler(new Request('https://worker.example/admin/register/client', {
        method: 'POST',
        headers: { 'X-Admin-Secret': env.WEBHOOK_ADMIN_SECRET }
    }));

    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).results.map(result => result.role), ['client']);
    assert.deepEqual(calls.map(call => call.body.url), ['https://worker.example/telegram/client']);
});

test('registration response exposes Telegram retry_after without retrying', async () => {
    const handler = createHandler(env, async () => Response.json({
        ok: false,
        parameters: { retry_after: 37 }
    }, { status: 429 }));
    const response = await handler(new Request('https://worker.example/admin/register/client', {
        method: 'POST',
        headers: { 'X-Admin-Secret': env.WEBHOOK_ADMIN_SECRET }
    }));

    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), {
        action: 'register',
        success: false,
        results: [{
            role: 'client',
            configured: true,
            success: false,
            error: 'Telegram setWebhook failed with status 429. Retry after 37 seconds.',
            retryAfter: 37
        }]
    });
});

test('support updates use the support webhook secret and forward to Layero', async () => {
    const calls = [];
    const handler = createHandler(env, async (url, options) => {
        calls.push({ url: String(url), options });
        return new Response('ok', { status: 200 });
    });
    const response = await handler(new Request('https://worker.example/telegram/support', {
        method: 'POST',
        headers: { 'X-Telegram-Bot-Api-Secret-Token': env.SUPPORT_WEBHOOK_SECRET },
        body: JSON.stringify({ update_id: 4 })
    }));

    assert.equal(response.status, 200);
    assert.equal(calls[0].url, 'https://backend.example/api/telegram/webhook/support');
});

test('client updates use the client webhook secret and forward to Layero', async () => {
    const calls = [];
    const handler = createHandler(env, async (url, options) => {
        calls.push({ url: String(url), options });
        return new Response('ok', { status: 200 });
    });
    const response = await handler(new Request('https://worker.example/telegram/client', {
        method: 'POST',
        headers: { 'X-Telegram-Bot-Api-Secret-Token': env.CLIENT_WEBHOOK_SECRET },
        body: JSON.stringify({ update_id: 5 })
    }));

    assert.equal(response.status, 200);
    assert.equal(calls[0].url, 'https://backend.example/api/telegram/webhook/client');
    assert.equal(calls[0].options.headers['X-Telegram-Worker-Secret'], env.TELEGRAM_WORKER_SHARED_SECRET);
});

test('admin updates forward before acknowledging', async () => {
    const calls = [];
    const handler = createHandler(env, async (url, options) => {
        calls.push({ url: String(url), options });
        return new Response('ok', { status: 200 });
    });
    const response = await handler(new Request('https://worker.example/telegram/admin', {
        method: 'POST',
        headers: { 'X-Telegram-Bot-Api-Secret-Token': env.ADMIN_WEBHOOK_SECRET },
        body: JSON.stringify({ update_id: 2 })
    }));
    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://backend.example/api/telegram/webhook/admin');
    assert.equal(calls[0].options.headers['X-Telegram-Worker-Secret'], env.TELEGRAM_WORKER_SHARED_SECRET);
});

test('Layero errors are returned so Telegram can retry', async () => {
    const handler = createHandler(env, async () => new Response('unauthorized', { status: 401 }));
    const response = await handler(new Request('https://worker.example/telegram/admin', {
        method: 'POST',
        headers: { 'X-Telegram-Bot-Api-Secret-Token': env.ADMIN_WEBHOOK_SECRET },
        body: JSON.stringify({ update_id: 3 })
    }));
    assert.equal(response.status, 503);
});
