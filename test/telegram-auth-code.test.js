const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { after, before, test } = require('node:test');
const createTelegramAuthRouter = require('../telegram-auth-api');

const userId = 'c0ffee00-0000-4000-8000-000000000001';
let server;
let endpoint;
let verifiedCode;

const app = express();
app.use(express.json());
app.use('/api/telegram-auth', createTelegramAuthRouter({
    env: {
        SUPABASE_URL: 'https://supabase.example',
        SUPABASE_ANON_KEY: 'test-anon-key',
        SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key'
    },
    fetch: async (url, init = {}) => {
        const parsed = new URL(url);
        if (parsed.pathname === '/rest/v1/telegram_accounts') {
            return { ok: true, status: 200, json: async () => [{ user_id: userId, telegram_chat_id: 12345 }] };
        }
        if (parsed.pathname === `/auth/v1/admin/users/${userId}`) {
            return { ok: true, status: 200, json: async () => ({ user: { email: 'user@example.com' } }) };
        }
        if (parsed.pathname === '/auth/v1/verify') {
            verifiedCode = JSON.parse(init.body).token;
            return {
                ok: true,
                status: 200,
                json: async () => ({ access_token: 'test-access-token', refresh_token: 'test-refresh-token' })
            };
        }
        throw new Error(`Unexpected request: ${parsed.pathname}`);
    }
}));

before(async () => {
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    endpoint = `http://127.0.0.1:${server.address().port}/api/telegram-auth`;
});

after(async () => {
    if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

async function post(code) {
    return fetch(`${endpoint}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'test_user', code, mode: 'login' })
    });
}

test('Telegram authentication accepts longer Supabase OTP values', async () => {
    const response = await post('12345678');
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(verifiedCode, '12345678');
    assert.equal(result.session.access_token, 'test-access-token');
});

test('Telegram authentication rejects codes outside the accepted length', async () => {
    const response = await post('1234567890123');
    assert.equal(response.status, 400);
});
