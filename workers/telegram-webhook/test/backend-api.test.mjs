import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import createTelegramWebhookApi from '../../../telegram-webhook-api.js';

const sharedSecret = 'worker-shared-secret_test-123456789012345678901234567890';

async function createApp({ claimed = 'claimed', failProcessor = false } = {}) {
    let processCount = 0;
    let savedState;
    let activeState = {};
    const calls = [];
    const app = express();
    app.use(express.json());
    app.use('/webhook', createTelegramWebhookApi({
        env: {
            TELEGRAM_WORKER_SHARED_SECRET: sharedSecret,
            SUPABASE_URL: 'https://supabase.example.test',
            SUPABASE_SERVICE_ROLE_KEY: 'service-role'
        },
        fetch: async (url, init = {}) => {
            const parsedUrl = new URL(url);
            const pathname = parsedUrl.pathname;
            calls.push({ pathname, body: init.body && JSON.parse(init.body) });
            if (pathname.endsWith('/claim_telegram_webhook_update')) return Response.json(claimed);
            if (pathname.endsWith('/telegram_bot_states') && !parsedUrl.searchParams.has('on_conflict')) return Response.json([]);
            if (pathname.endsWith('/telegram_bot_states') && parsedUrl.searchParams.has('on_conflict')) {
                savedState = JSON.parse(init.body).state;
                return new Response(null, { status: 201 });
            }
            if (pathname.endsWith('/complete_telegram_webhook_update')) return Response.json(true);
            if (pathname.endsWith('/retry_telegram_webhook_update')) return Response.json(true);
            throw new Error(`Unexpected database request: ${pathname}`);
        },
        processTelegramUpdate: async (role, update, options) => {
            processCount++;
            assert.equal(role, 'client');
            assert.equal(update.update_id, 42);
            assert.equal(options.env.TELEGRAM_WORKER_SHARED_SECRET, sharedSecret);
            if (failProcessor) throw new Error('test processing failure');
            activeState = { flow: 'test' };
        },
        getBotState: () => activeState,
        setBotState: (_role, _chatId, state) => { activeState = state; }
    }));
    const server = await new Promise(resolve => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    return {
        app,
        calls,
        get processCount() { return processCount; },
        get savedState() { return savedState; },
        close: () => new Promise(resolve => server.close(resolve)),
        url: `http://127.0.0.1:${server.address().port}/webhook/client`
    };
}

test('backend webhook authenticates, stores conversation state, and completes update', async () => {
    const instance = await createApp();
    try {
        const response = await fetch(instance.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Telegram-Worker-Secret': sharedSecret },
            body: JSON.stringify({ update_id: 42, message: { chat: { id: 12345, type: 'private' }, text: '/start' } })
        });
        assert.equal(response.status, 200);
        assert.equal(instance.processCount, 1);
        assert.deepEqual(instance.savedState, { flow: 'test' });
        assert.ok(instance.calls.some(call => call.pathname.endsWith('/complete_telegram_webhook_update')));
    } finally {
        await instance.close();
    }
});

test('backend webhook skips duplicate updates', async () => {
    const instance = await createApp({ claimed: 'completed' });
    try {
        const response = await fetch(instance.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Telegram-Worker-Secret': sharedSecret },
            body: JSON.stringify({ update_id: 42, message: { chat: { id: 12345, type: 'private' }, text: '/start' } })
        });
        assert.equal(response.status, 200);
        assert.equal(instance.processCount, 0);
    } finally {
        await instance.close();
    }
});

test('backend webhook asks Telegram to retry an update already in progress', async () => {
    const instance = await createApp({ claimed: 'processing' });
    try {
        const response = await fetch(instance.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Telegram-Worker-Secret': sharedSecret },
            body: JSON.stringify({ update_id: 42, message: { chat: { id: 12345, type: 'private' }, text: '/start' } })
        });
        assert.equal(response.status, 503);
        assert.equal(response.headers.get('retry-after'), '2');
        assert.equal(instance.processCount, 0);
    } finally {
        await instance.close();
    }
});

test('backend webhook marks failed updates retryable', async () => {
    const instance = await createApp({ failProcessor: true });
    try {
        const response = await fetch(instance.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Telegram-Worker-Secret': sharedSecret },
            body: JSON.stringify({ update_id: 42, message: { chat: { id: 12345, type: 'private' }, text: '/start' } })
        });
        assert.equal(response.status, 503);
        assert.ok(instance.calls.some(call => call.pathname.endsWith('/retry_telegram_webhook_update')));
    } finally {
        await instance.close();
    }
});

test('backend webhook rejects invalid shared secrets', async () => {
    const instance = await createApp();
    try {
        const response = await fetch(instance.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Telegram-Worker-Secret': 'wrong' },
            body: JSON.stringify({ update_id: 42 })
        });
        assert.equal(response.status, 401);
        assert.equal(instance.calls.length, 0);
    } finally {
        await instance.close();
    }
});
