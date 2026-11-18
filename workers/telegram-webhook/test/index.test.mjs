import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../src/index.mjs';

const webhookSecret = 'telegram-webhook-secret_test-123';
const workerSecret = 'worker-shared-secret_test-123456789012345678901234567890';

function env(overrides = {}) {
    return {
        CLIENT_BOT_TOKEN: 'client-token',
        CLIENT_WEBHOOK_SECRET: webhookSecret,
        TELEGRAM_WORKER_SHARED_SECRET: workerSecret,
        LAYER0_API_BASE_URL: 'https://api.example.test',
        ...overrides
    };
}

function telegramRequest(path, { method = 'POST', secret = webhookSecret, body = { update_id: 7, message: { text: '/start' } } } = {}) {
    return new Request(`https://worker.example.test${path}`, {
        method,
        headers: {
            'Content-Type': 'application/json',
            ...(secret ? { 'X-Telegram-Bot-Api-Secret-Token': secret } : {})
        },
        body: method === 'POST' ? JSON.stringify(body) : undefined
    });
}

test('rejects webhook requests with an invalid Telegram secret', async () => {
    let forwarded = false;
    const handler = createHandler(env(), async () => {
        forwarded = true;
        return Response.json({ ok: true });
    });
    const response = await handler(telegramRequest('/telegram/client', { secret: 'wrong-secret' }));
    assert.equal(response.status, 401);
    assert.equal(forwarded, false);
});

test('forwards a valid update to the matching Layero handler with the worker secret', async () => {
    let forwardedRequest;
    const handler = createHandler(env(), async (input, init) => {
        forwardedRequest = { url: String(input), init };
        return Response.json({ ok: true });
    });
    const response = await handler(telegramRequest('/telegram/client'));
    assert.equal(response.status, 200);
    assert.equal(forwardedRequest.url, 'https://api.example.test/api/telegram/webhook/client');
    assert.equal(forwardedRequest.init.headers['X-Telegram-Worker-Secret'], workerSecret);
    assert.equal(JSON.parse(forwardedRequest.init.body).update_id, 7);
});

test('asks Telegram to retry when Layero cannot confirm processing', async () => {
    const handler = createHandler(env(), async () => new Response('unavailable', { status: 503 }));
    const response = await handler(telegramRequest('/telegram/client'));
    assert.equal(response.status, 503);
});

test('webhook registration requires its own admin secret', async () => {
    let requests = 0;
    const handler = createHandler(env({
        WEBHOOK_ADMIN_SECRET: 'registration-secret',
        TELEGRAM_WORKER_PUBLIC_URL: 'https://worker.example.test'
    }), async () => {
        requests++;
        return Response.json({ ok: true, result: true });
    });
    const response = await handler(new Request('https://worker.example.test/admin/register-webhooks', {
        method: 'POST',
        headers: { Authorization: 'Bearer wrong' }
    }));
    assert.equal(response.status, 401);
    assert.equal(requests, 0);
});

test('registers only configured bots and preserves Telegram pending updates', async () => {
    const calls = [];
    const handler = createHandler(env({
        WEBHOOK_ADMIN_SECRET: 'registration-secret',
        TELEGRAM_WORKER_PUBLIC_URL: 'https://worker.example.test',
        ADMIN_BOT_TOKEN: 'admin-token',
        ADMIN_WEBHOOK_SECRET: 'admin-webhook-secret'
    }), async (input, init) => {
        calls.push({ url: String(input), payload: JSON.parse(init.body) });
        return Response.json({ ok: true, result: true });
    });
    const response = await handler(new Request('https://worker.example.test/admin/register-webhooks', {
        method: 'POST',
        headers: { Authorization: 'Bearer registration-secret' }
    }));
    assert.equal(response.status, 200);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].payload.drop_pending_updates, false);
    assert.equal(calls[0].payload.max_connections, 1);
    assert.equal(calls[0].payload.secret_token, webhookSecret);
    assert.equal(calls[1].payload.url, 'https://worker.example.test/telegram/admin');
});

test('removes webhook without dropping pending updates for rollback', async () => {
    let call;
    const handler = createHandler(env({
        WEBHOOK_ADMIN_SECRET: 'registration-secret',
        ADMIN_BOT_TOKEN: 'admin-token'
    }), async (input, init) => {
        call = { url: String(input), payload: JSON.parse(init.body) };
        return Response.json({ ok: true, result: true });
    });
    const response = await handler(new Request('https://worker.example.test/admin/remove-webhooks', {
        method: 'POST',
        headers: { Authorization: 'Bearer registration-secret' }
    }));
    assert.equal(response.status, 200);
    assert.match(call.url, /\/botadmin-token\/deleteWebhook$/);
    assert.equal(call.payload.drop_pending_updates, false);
});

test('does not register the same Telegram token under multiple roles', async () => {
    let telegramCalls = 0;
    const handler = createHandler(env({
        ADMIN_BOT_TOKEN: 'client-token',
        WEBHOOK_ADMIN_SECRET: 'registration-secret',
        TELEGRAM_WORKER_PUBLIC_URL: 'https://worker.example.test',
        ADMIN_WEBHOOK_SECRET: 'admin-webhook-secret'
    }), async () => {
        telegramCalls++;
        return Response.json({ ok: true, result: true });
    });
    const response = await handler(new Request('https://worker.example.test/admin/register-webhooks', {
        method: 'POST',
        headers: { Authorization: 'Bearer registration-secret' }
    }));
    assert.equal(response.status, 502);
    assert.equal(telegramCalls, 0);
    const result = await response.json();
    assert.ok(result.results.filter(item => item.configured).every(item => item.success === false));
});
