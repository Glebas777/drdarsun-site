const test = require('node:test');
const assert = require('node:assert/strict');

let createHandler;

test.before(async () => {
    ({ createHandler } = await import('../workers/telegram-webhook/src/index.mjs'));
});

const env = {
    LAYER0_API_BASE_URL: 'https://backend.example',
    TELEGRAM_WORKER_PUBLIC_URL: 'https://worker.example',
    TELEGRAM_WORKER_SHARED_SECRET: 'test-only-shared-secret-long-enough-for-tests',
    WEBHOOK_ADMIN_SECRET: 'test-only-admin-secret',
    ADMIN_BOT_TOKEN: 'admin-token',
    ADMIN_WEBHOOK_SECRET: 'admin-secret',
    WORKER_ROLES: 'admin'
};

test('only the admin route is accepted', async () => {
    const handler = createHandler(env);

    for (const role of ['client', 'auth', 'panel', 'support']) {
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

test('admin registration uses one role and delivery limits', async () => {
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
    assert.deepEqual(body.results.map(result => result.role), ['admin']);
    assert.deepEqual(calls.map(call => call.body.url), ['https://worker.example/telegram/admin']);
    assert.equal(calls[0].body.max_connections, 10);
    assert.deepEqual(calls[0].body.allowed_updates, ['message', 'callback_query']);
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
