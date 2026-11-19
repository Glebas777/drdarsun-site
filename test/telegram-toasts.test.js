const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { after, before, test } = require('node:test');
const createTelegramIntegrationRouter = require('../telegram-integration');

const userId = 'c0ffee00-0000-4000-8000-000000000001';
const insertedRows = [];
const publicBroadcasts = [];
let server;
let endpoint;

const app = express();
app.use(express.json());
app.use('/api/telegram', createTelegramIntegrationRouter({
    env: {
        ADMIN_BOT_TOKEN: 'test-admin-bot-token',
        MY_CHAT_ID: '123456789',
        SUPABASE_URL: 'https://supabase.example',
        SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key'
    },
    fetch: async (url, init = {}) => {
        const parsed = new URL(url);
        if (parsed.pathname === '/auth/v1/admin/users') {
            return {
                ok: true,
                status: 200,
                json: async () => ({ users: [{ id: userId, email: 'user@example.com' }] })
            };
        }
        if (parsed.pathname === '/rest/v1/site_public_toasts') {
            if (init.method === 'POST') publicBroadcasts.push(JSON.parse(init.body));
            return { ok: true, status: init.method === 'POST' ? 201 : 204, json: async () => null };
        }
        if (parsed.pathname === '/rest/v1/site_toast_notifications' && init.method === 'POST') {
            insertedRows.push(...JSON.parse(init.body));
            return { ok: true, status: 201, json: async () => null };
        }
        if (parsed.pathname === '/rest/v1/telegram_admin_audit' && init.method === 'POST') {
            return { ok: true, status: 201, json: async () => null };
        }
        throw new Error(`Unexpected request: ${parsed.pathname}`);
    }
}));

before(async () => {
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    endpoint = `http://127.0.0.1:${server.address().port}/api/telegram`;
});

after(async () => {
    if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

async function post(path, body, { authorized = true } = {}) {
    return fetch(`${endpoint}${path}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(authorized ? {
                Authorization: 'Bearer test-admin-bot-token',
                'X-Telegram-Chat-Id': '123456789'
            } : {})
        },
        body: JSON.stringify(body)
    });
}

test('admin broadcast toast is available to visitors without accounts', async () => {
    const response = await post('/admin/toasts/send', {
        target: 'all',
        message: 'Заказы снова доступны',
        kind: 'success',
        durationSeconds: 30
    });
    const result = await response.json();

    assert.equal(response.status, 200);
    assert.equal(result.sent, 1);
    assert.equal(result.broadcast, true);
    assert.equal(result.durationSeconds, 30);
    assert.deepEqual(publicBroadcasts.map(row => ({
        message: row.message,
        kind: row.kind
    })), [{
        message: 'Заказы снова доступны',
        kind: 'success'
    }]);
    assert.ok(Date.parse(publicBroadcasts[0].expires_at) > Date.now());
});

test('email-targeted toast remains private to that account', async () => {
    const response = await post('/admin/toasts/send', {
        target: 'user@example.com',
        message: 'Личное уведомление',
        kind: 'info',
        durationSeconds: 60
    });
    const result = await response.json();

    assert.equal(response.status, 200);
    assert.equal(result.broadcast, undefined);
    assert.equal(result.sent, 1);
    assert.equal(insertedRows.at(-1).user_id, userId);
    assert.equal(insertedRows.at(-1).message, 'Личное уведомление');
});

test('admin toast validates the duration and owner authorization', async () => {
    const invalidDuration = await post('/admin/toasts/send', {
        target: 'all',
        message: 'Тест',
        kind: 'info',
        durationSeconds: 3601
    });
    assert.equal(invalidDuration.status, 400);

    const unauthorized = await post('/admin/toasts/send', {
        target: 'all',
        message: 'Тест',
        kind: 'info',
        durationSeconds: 30
    }, { authorized: false });
    assert.equal(unauthorized.status, 401);
});

test('legacy admin email endpoints are disabled', async () => {
    const response = await post('/admin/email/send', {});
    assert.equal(response.status, 410);
});
