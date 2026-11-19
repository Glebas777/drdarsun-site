const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { after, before, test } = require('node:test');
const createTelegramIntegrationRouter = require('../telegram-integration');

const maintenancePassword = 'test-maintenance-password-long';
let server;
let endpoint;
let maintenanceSetting = { enabled: false };
const auditRows = [];

const app = express();
app.use(express.json());
app.use('/api/telegram', createTelegramIntegrationRouter({
    env: {
        ADMIN_BOT_TOKEN: 'test-admin-bot-token',
        MY_CHAT_ID: '123456789',
        SITE_MAINTENANCE_PASSWORD: maintenancePassword,
        SUPABASE_URL: 'https://supabase.example',
        SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key'
    },
    fetch: async (url, init = {}) => {
        const parsed = new URL(url);
        if (parsed.pathname === '/rest/v1/site_runtime_settings' && init.method === 'POST') {
            maintenanceSetting = JSON.parse(init.body).value;
            return { ok: true, status: 201, json: async () => [{ value: maintenanceSetting }] };
        }
        if (parsed.pathname === '/rest/v1/site_runtime_settings') {
            return { ok: true, status: 200, json: async () => [{ value: maintenanceSetting }] };
        }
        if (parsed.pathname === '/rest/v1/telegram_admin_audit' && init.method === 'POST') {
            auditRows.push(JSON.parse(init.body));
            return { ok: true, status: 201, json: async () => null };
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
    if (server) await new Promise((resolve, reject) =>
        server.close(error => error ? reject(error) : resolve())
    );
});

async function request(path, { method = 'GET', body } = {}) {
    return fetch(`${endpoint}${path}`, {
        method,
        headers: {
            Authorization: 'Bearer test-admin-bot-token',
            'X-Telegram-Chat-Id': '123456789',
            'Content-Type': 'application/json'
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
}

test('maintenance API returns legacy settings and validates the selected mode', async () => {
    maintenanceSetting = { enabled: true };
    const legacyResponse = await request('/admin/maintenance');
    assert.deepEqual(await legacyResponse.json(), { enabled: true, mode: 'planned' });

    const invalidModeResponse = await request('/admin/maintenance', {
        method: 'POST',
        body: { enabled: true, mode: 'unknown', password: maintenancePassword }
    });
    assert.equal(invalidModeResponse.status, 400);
});

test('maintenance API saves the mode and preserves it when the site reopens', async () => {
    auditRows.length = 0;
    const enableResponse = await request('/admin/maintenance', {
        method: 'POST',
        body: { enabled: true, mode: 'emergency', password: maintenancePassword }
    });
    assert.equal(enableResponse.status, 200);
    assert.deepEqual(await enableResponse.json(), { enabled: true, mode: 'emergency' });
    assert.deepEqual(maintenanceSetting, { enabled: true, mode: 'emergency' });
    assert.equal(auditRows.at(-1).details.mode, 'emergency');

    const disableResponse = await request('/admin/maintenance', {
        method: 'POST',
        body: { enabled: false, password: maintenancePassword }
    });
    assert.equal(disableResponse.status, 200);
    assert.deepEqual(await disableResponse.json(), { enabled: false, mode: 'emergency' });
    assert.deepEqual(maintenanceSetting, { enabled: false, mode: 'emergency' });
});
