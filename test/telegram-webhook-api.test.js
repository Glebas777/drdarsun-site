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

test('removed client bot role is rejected before Supabase or bot processing', async () => {
    let processCalls = 0;
    const options = {
        env: {
            TELEGRAM_WORKER_SHARED_SECRET: 'test-secret-with-more-than-32-characters'
        },
        fetch: async () => { throw new Error('Supabase should not be queried'); },
        processTelegramUpdate: async () => { processCalls++; },
        getBotState: () => ({}),
        setBotState: () => {}
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
        assert.equal(response.status, 400);
        assert.deepEqual(await response.json(), { error: 'Invalid Telegram update.' });
    });
    assert.equal(processCalls, 0);
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
