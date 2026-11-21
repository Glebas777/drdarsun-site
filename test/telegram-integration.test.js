const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { once } = require('node:events');
const createTelegramIntegrationRouter = require('../telegram-integration');

async function withRouter(options, run) {
    const app = express();
    app.use(express.json());
    app.use('/api/telegram', createTelegramIntegrationRouter(options));
    const server = app.listen(0);
    await once(server, 'listening');
    try {
        await run(`http://127.0.0.1:${server.address().port}/api/telegram`);
    } finally {
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
}

test('Telegram account-linking endpoints are no longer exposed', async () => {
    await withRouter({ env: {} }, async baseUrl => {
        const responses = await Promise.all([
            fetch(`${baseUrl}/link`),
            fetch(`${baseUrl}/link/start`, { method: 'POST' }),
            fetch(`${baseUrl}/link/confirm`, { method: 'POST' })
        ]);
        assert.deepEqual(responses.map(response => response.status), [404, 404, 404]);
    });
});

test('admin API controls still require the configured owner chat ID', async () => {
    const env = {
        ADMIN_BOT_TOKEN: 'admin-token',
        MY_CHAT_ID: '42',
        SUPABASE_URL: 'https://supabase.example',
        SUPABASE_SERVICE_ROLE_KEY: 'service-key'
    };
    await withRouter({
        env,
        fetch: async () => { throw new Error('Database should not be queried'); }
    }, async baseUrl => {
        const response = await fetch(`${baseUrl}/admin/orders`, {
            headers: {
                Authorization: `Bearer ${env.ADMIN_BOT_TOKEN}`,
                'X-Telegram-Chat-Id': '99'
            }
        });
        assert.equal(response.status, 403);
    });
});

test('retired bot ban, backup and access APIs are no longer exposed', async () => {
    const env = {
        ADMIN_BOT_TOKEN: 'admin-token',
        MY_CHAT_ID: '42',
        SUPABASE_URL: 'https://supabase.example',
        SUPABASE_SERVICE_ROLE_KEY: 'service-key'
    };
    await withRouter({
        env,
        fetch: async () => { throw new Error('Database should not be queried'); }
    }, async baseUrl => {
        const responses = await Promise.all([
            fetch(`${baseUrl}/access`, { headers: { Authorization: `Bearer ${env.ADMIN_BOT_TOKEN}` } }),
            fetch(`${baseUrl}/admin/bans`, { headers: { Authorization: `Bearer ${env.ADMIN_BOT_TOKEN}`, 'X-Telegram-Chat-Id': '42' } }),
            fetch(`${baseUrl}/admin/backup`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${env.ADMIN_BOT_TOKEN}`, 'X-Telegram-Chat-Id': '42', 'Content-Type': 'application/json' },
                body: '{}'
            }),
            fetch(`${baseUrl}/admin/ip-bans`, { headers: { Authorization: `Bearer ${env.ADMIN_BOT_TOKEN}`, 'X-Telegram-Chat-Id': '42' } })
        ]);
        assert.deepEqual(responses.map(response => response.status), [404, 404, 404, 404]);
    });
});
