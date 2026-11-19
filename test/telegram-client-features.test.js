const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { after, before, test } = require('node:test');
const createTelegramIntegrationRouter = require('../telegram-integration');

const userId = 'c0ffee00-0000-4000-8000-000000000001';
let server;
let endpoint;
let telegramEnabled = false;
const products = [
    { id: 1, name: 'Оливковое масло', price: 500, category: 'Масло', description: 'Холодный отжим' },
    { id: 2, name: 'Масло грецкого ореха', price: 700, category: 'Масло', description: 'Ароматное' },
    { id: 3, name: 'Льняное масло', price: 300, category: 'Масло', description: 'Источник ALA' }
];
const orders = Array.from({ length: 11 }, (_, index) => ({
    id: `order-${index}`,
    items: [{ product_id: 1, name: 'Оливковое масло', quantity: 1 }],
    total: 500,
    status: 'pending',
    created_at: '2026-11-18T12:00:00.000Z'
}));

const app = express();
app.use(express.json());
app.use('/api/telegram', createTelegramIntegrationRouter({
    env: {
        CLIENT_BOT_TOKEN: 'test-client-bot-token',
        SUPABASE_URL: 'https://supabase.example',
        SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key'
    },
    fetch: async (url, init = {}) => {
        const parsed = new URL(url);
        if (parsed.pathname === '/rest/v1/products') {
            return { ok: true, status: 200, json: async () => products };
        }
        if (parsed.pathname === '/rest/v1/telegram_accounts') {
            const linked = parsed.searchParams.get('telegram_chat_id') === 'eq.123456789';
            return { ok: true, status: 200, json: async () => linked ? [{ user_id: userId }] : [] };
        }
        if (parsed.pathname === '/rest/v1/orders') {
            assert.equal(parsed.searchParams.get('user_id'), `eq.${userId}`);
            const offset = Number(parsed.searchParams.get('offset')) || 0;
            const limit = Number(parsed.searchParams.get('limit')) || 0;
            return { ok: true, status: 200, json: async () => orders.slice(offset, offset + limit) };
        }
        if (parsed.pathname === '/rest/v1/notification_settings' && init.method === 'POST') {
            telegramEnabled = JSON.parse(init.body).telegram_enabled;
            return { ok: true, status: 201, json: async () => null };
        }
        if (parsed.pathname === '/rest/v1/notification_settings') {
            return { ok: true, status: 200, json: async () => [{ telegram_enabled: telegramEnabled }] };
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

async function get(path, { chatId = '123456789', token = 'test-client-bot-token' } = {}) {
    return fetch(`${endpoint}${path}`, {
        headers: {
            Authorization: `Bearer ${token}`,
            'X-Telegram-Chat-Id': chatId
        }
    });
}

async function patch(path, body, { chatId = '123456789', token = 'test-client-bot-token' } = {}) {
    return fetch(`${endpoint}${path}`, {
        method: 'PATCH',
        headers: {
            Authorization: `Bearer ${token}`,
            'X-Telegram-Chat-Id': chatId,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });
}

test('client catalog searches and paginates without accepting unbounded filters', async () => {
    const response = await get('/client/catalog?search=%D0%BE%D0%BB%D0%B8%D0%B2&offset=0');
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(result.products.map(product => product.name), ['Оливковое масло']);
    assert.equal(result.search, 'олив');
    assert.equal(result.hasMore, false);
});

test('client orders are limited to the linked Telegram account and have a next page', async () => {
    const response = await get('/client/orders?offset=0');
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.linked, true);
    assert.equal(result.orders.length, 10);
    assert.equal(result.hasMore, true);
});

test('unlinked Telegram chats cannot read or change notification preferences', async () => {
    const readResponse = await get('/client/notifications', { chatId: '987654321' });
    assert.deepEqual(await readResponse.json(), { linked: false, enabled: false });

    const writeResponse = await patch('/client/notifications', { enabled: true }, { chatId: '987654321' });
    assert.equal(writeResponse.status, 409);
    assert.equal(telegramEnabled, false);
});

test('linked users can change only the Telegram notification preference', async () => {
    const response = await patch('/client/notifications', { enabled: true });
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(result, { linked: true, enabled: true });
    assert.equal(telegramEnabled, true);
});
