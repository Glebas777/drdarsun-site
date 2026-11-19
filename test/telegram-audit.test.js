const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { after, before, test } = require('node:test');
const createTelegramIntegrationRouter = require('../telegram-integration');

const userId = 'c0ffee00-0000-4000-8000-000000000001';
const orderId = 'c0ffee00-0000-4000-8000-000000000002';
const auditRows = [];
let server;
let endpoint;

const app = express();
app.use(express.json());
app.use('/api/telegram', createTelegramIntegrationRouter({
    env: {
        PANEL_BOT_TOKEN: 'test-panel-bot-token',
        PANEL_CHAT_ID: '987654321',
        SUPABASE_URL: 'https://supabase.example',
        SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key'
    },
    fetch: async (url, init = {}) => {
        const parsed = new URL(url);
        if (parsed.pathname === '/rest/v1/products' && init.method !== 'POST' && init.method !== 'PATCH') {
            return { ok: true, status: 200, json: async () => [{ id: 1, name: 'Оливковое масло', price: 250 }] };
        }
        if (parsed.pathname === '/rest/v1/orders' && init.method === 'POST') {
            const order = { id: orderId, user_id: userId, items: JSON.parse(init.body).items, total: 500, status: 'pending', created_at: new Date().toISOString() };
            return { ok: true, status: 201, json: async () => [order] };
        }
        if (parsed.pathname === '/rest/v1/telegram_admin_audit' && init.method === 'POST') {
            auditRows.push(JSON.parse(init.body));
            return { ok: true, status: 201, json: async () => null };
        }
        if (parsed.pathname === '/rest/v1/telegram_admin_audit') {
            return { ok: true, status: 200, json: async () => auditRows };
        }
        throw new Error(`Unexpected request: ${parsed.pathname} ${init.method || 'GET'}`);
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

async function request(path, { method = 'GET', body } = {}) {
    return fetch(`${endpoint}${path}`, {
        method,
        headers: {
            Authorization: 'Bearer test-panel-bot-token',
            'X-Telegram-Chat-Id': '987654321',
            'Content-Type': 'application/json'
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
}

test('panel order creation writes a minimal audit record available to owner history', async () => {
    auditRows.length = 0;
    const createResponse = await request('/panel/orders', {
        method: 'POST',
        body: { user_id: userId, items: [{ product_id: 1, quantity: 2 }] }
    });
    assert.equal(createResponse.status, 201);
    assert.equal(auditRows.length, 1);
    assert.deepEqual(auditRows[0], {
        actor_role: 'panel',
        actor_chat_id: '987654321',
        action: 'order.created',
        entity_type: 'order',
        entity_id: orderId,
        details: { item_count: 1, total: 500 }
    });
    assert.equal(Object.hasOwn(auditRows[0].details, 'user_id'), false);

    const historyResponse = await request('/panel/audit');
    const history = await historyResponse.json();
    assert.equal(historyResponse.status, 200);
    assert.equal(history.entries.length, 1);
    assert.equal(history.entries[0].action, 'order.created');
});
