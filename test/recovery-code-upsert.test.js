const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { after, before, test } = require('node:test');
const createRecoveryCodesRouter = require('../recovery-codes-api');

const userId = 'c0ffee00-0000-4000-8000-000000000001';
const jwtPayload = Buffer.from(JSON.stringify({ aal: 'aal2' })).toString('base64url');
const authorization = `Bearer header.${jwtPayload}.signature`;
const storedRows = new Map();
const requests = [];
let server;
let endpoint;

const app = express();
app.use(express.json());
app.use('/api/recovery-codes', createRecoveryCodesRouter({
    env: {
        SUPABASE_URL: 'https://supabase.example',
        SUPABASE_ANON_KEY: 'test-anon-key',
        SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
        RECOVERY_CODES_ENCRYPTION_KEY: 'test-encryption-key'
    },
    fetch: async (url, init = {}) => {
        const parsed = new URL(url);
        requests.push({ url: parsed, init });
        if (parsed.pathname === '/auth/v1/user') {
            return {
                ok: true,
                status: 200,
                json: async () => ({ id: userId, email: 'user@example.test' })
            };
        }
        if (parsed.pathname === '/rest/v1/mfa_recovery_vault' && init.method === 'POST') {
            const body = JSON.parse(init.body);
            storedRows.set(body.user_id, body);
            return { ok: true, status: 201, json: async () => null };
        }
        throw new Error(`Unexpected request: ${parsed.pathname}`);
    }
}));

before(async () => {
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    endpoint = `http://127.0.0.1:${server.address().port}/api/recovery-codes`;
});

after(async () => {
    if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

test('registering recovery codes again upserts and replaces the encrypted vault row', async () => {
    const firstCodes = ['a'.repeat(16), 'b'.repeat(16)];
    const secondCodes = ['c'.repeat(16), 'd'.repeat(16)];

    for (const codes of [firstCodes, secondCodes]) {
        const response = await fetch(`${endpoint}/register`, {
            method: 'POST',
            headers: { Authorization: authorization, 'Content-Type': 'application/json' },
            body: JSON.stringify({ codes })
        });
        assert.equal(response.status, 201);
    }

    const vaultWrites = requests.filter(({ url }) => url.pathname === '/rest/v1/mfa_recovery_vault');
    assert.equal(vaultWrites.length, 2);
    assert.equal(vaultWrites[1].url.searchParams.get('on_conflict'), 'user_id');
    assert.match(vaultWrites[1].init.headers.Prefer, /resolution=merge-duplicates/);
    assert.ok(storedRows.has(userId));
    assert.notEqual(vaultWrites[0].init.body, vaultWrites[1].init.body);
});
