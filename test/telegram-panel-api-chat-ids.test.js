const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { after, before, test } = require('node:test');
const createTelegramIntegrationRouter = require('../telegram-integration');

let server;
let endpoint;

const app = express();
app.use(express.json());
app.use('/api/telegram', createTelegramIntegrationRouter({
    env: {
        PANEL_BOT_TOKEN: 'test-panel-bot-token',
        M_CHAT_ID: '647428798',
        PANEL_CHAT_ID: '8329766596',
        SUPABASE_URL: 'https://supabase.example',
        SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key'
    },
    fetch: async url => {
        const parsed = new URL(url);
        if (parsed.pathname === '/rest/v1/orders') {
            return { ok: true, status: 200, json: async () => [] };
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

async function getOrders(chatId) {
    return fetch(`${endpoint}/panel/orders`, {
        headers: {
            Authorization: 'Bearer test-panel-bot-token',
            'X-Telegram-Chat-Id': String(chatId)
        }
    });
}

test('panel API accepts owner and legacy IDs even when configured separately', async () => {
    assert.equal((await getOrders('8329766596')).status, 200);
    assert.equal((await getOrders('647428798')).status, 200);
});

test('panel API rejects chat IDs outside both allowlists', async () => {
    assert.equal((await getOrders('123456789')).status, 403);
});
