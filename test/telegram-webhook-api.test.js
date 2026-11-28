const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { once } = require('node:events');
const createTelegramWebhookApi = require('../telegram-webhook-api');

async function withWebhook(options, run) {
    const app = express();
    app.use(express.json());
    app.use('/api/telegram/webhook', createTelegramWebhookApi(options));
    const server = app.listen(0);
    await once(server, 'listening');
    try {
        await run(`http://127.0.0.1:${server.address().port}/api/telegram/webhook`);
    } finally {
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
}

test('unauthorized admin webhook updates are acknowledged without touching state or Supabase', async () => {
    let processCalls = 0;
    let stateCalls = 0;
    const options = {
        env: {
            TELEGRAM_WORKER_SHARED_SECRET: 'test-secret-with-more-than-32-characters',
            MY_CHAT_ID: '42',
            SUPABASE_URL: 'https://supabase.example',
            SUPABASE_SERVICE_ROLE_KEY: 'service-key'
        },
        fetch: async () => { throw new Error('Supabase should not be queried'); },
        processTelegramUpdate: async () => { processCalls++; },
        getBotState: () => { stateCalls++; return {}; },
        setBotState: () => { stateCalls++; }
    };
    await withWebhook(options, async baseUrl => {
        const response = await fetch(`${baseUrl}/admin`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Telegram-Worker-Secret': options.env.TELEGRAM_WORKER_SHARED_SECRET
            },
            body: JSON.stringify({
                update_id: 9001,
                message: { chat: { id: 99, type: 'private' }, text: '/start' }
            })
        });
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { ok: true, ignored: true });
    });
    assert.equal(processCalls, 0);
    assert.equal(stateCalls, 0);
});

test('stateless client webhook processes updates without calling Supabase', async () => {
    const processedRoles = [];
    let stateCalls = 0;
    const options = {
        env: {
            TELEGRAM_WORKER_SHARED_SECRET: 'test-secret-with-more-than-32-characters'
        },
        fetch: async () => { throw new Error('Client webhook must not call Supabase'); },
        processTelegramUpdate: async role => { processedRoles.push(role); },
        getBotState: () => { stateCalls++; return {}; },
        setBotState: () => { stateCalls++; }
    };
    await withWebhook(options, async baseUrl => {
        const response = await fetch(`${baseUrl}/client`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Telegram-Worker-Secret': options.env.TELEGRAM_WORKER_SHARED_SECRET
            },
            body: JSON.stringify({
                update_id: 9002,
                message: { chat: { id: 99, type: 'private' }, text: '/start' }
            })
        });
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { ok: true });
    });
    assert.deepEqual(processedRoles, ['client']);
    assert.equal(stateCalls, 0);
});

test('a duplicate update currently in progress is acknowledged rather than returned as 503', async () => {
    const calls = [];
    const options = {
        env: {
            TELEGRAM_WORKER_SHARED_SECRET: 'test-secret-with-more-than-32-characters',
            SUPABASE_URL: 'https://supabase.example',
            SUPABASE_SERVICE_ROLE_KEY: 'service-key',
            MY_CHAT_ID: '99'
        },
        fetch: async url => {
            calls.push(String(url));
            return Response.json('processing');
        },
        processTelegramUpdate: async () => { throw new Error('Update should not be processed twice'); },
        getBotState: () => ({}),
        setBotState: () => {}
    };
    await withWebhook(options, async baseUrl => {
        const response = await fetch(`${baseUrl}/admin`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Telegram-Worker-Secret': options.env.TELEGRAM_WORKER_SHARED_SECRET
            },
            body: JSON.stringify({
                update_id: 9003,
                message: { chat: { id: 99, type: 'private' }, text: '/start' }
            })
        });
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { ok: true, duplicate: true, processing: true });
    });
    assert.equal(calls.length, 1);
});

test('support webhook persists state and processes public private chats', async () => {
    const calls = [];
    const processedRoles = [];
    const options = {
        env: {
            TELEGRAM_WORKER_SHARED_SECRET: 'test-secret-with-more-than-32-characters',
            SUPABASE_URL: 'https://supabase.example',
            SUPABASE_SERVICE_ROLE_KEY: 'service-key'
        },
        fetch: async (url, init = {}) => {
            const path = String(url);
            calls.push({ path, init });
            if (path.endsWith('/rpc/claim_telegram_webhook_update')) return Response.json('claimed');
            if (path.includes('/telegram_bot_states?') && init.method === undefined) return Response.json([]);
            if (path.endsWith('/rpc/complete_telegram_webhook_update')) return Response.json(true);
            return Response.json(null);
        },
        processTelegramUpdate: async role => { processedRoles.push(role); },
        getBotState: () => ({ flow: 'support' }),
        setBotState: () => {}
    };

    await withWebhook(options, async baseUrl => {
        const response = await fetch(`${baseUrl}/support`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Telegram-Worker-Secret': options.env.TELEGRAM_WORKER_SHARED_SECRET
            },
            body: JSON.stringify({
                update_id: 9004,
                message: { chat: { id: 987, type: 'private' }, text: '/start' }
            })
        });
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { ok: true });
    });

    assert.deepEqual(processedRoles, ['support']);
    assert.ok(calls.some(call =>
        call.path.includes('telegram_bot_states?on_conflict=bot_role,telegram_chat_id') &&
        JSON.parse(call.init.body).bot_role === 'support'
    ));
});
