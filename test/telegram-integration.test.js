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

test('Telegram account-management endpoints require an authenticated site session', async () => {
    await withRouter({ env: {} }, async baseUrl => {
        const responses = await Promise.all([
            fetch(`${baseUrl}/link`),
            fetch(`${baseUrl}/link/start`, { method: 'POST' })
        ]);
        assert.deepEqual(responses.map(response => response.status), [401, 401]);
    });
});

test('linking creates a short-lived hashed challenge and a client-bot deep link', async () => {
    let linkRequest;
    await withRouter({
        env: {
            SUPABASE_URL: 'https://supabase.example',
            SUPABASE_ANON_KEY: 'anon-key',
            SUPABASE_SERVICE_ROLE_KEY: 'service-key',
            CLIENT_BOT_USERNAME: '@DrDarSunClientBot'
        },
        fetch: async (url, init = {}) => {
            if (String(url).endsWith('/auth/v1/user')) {
                return Response.json({
                    id: '00000000-0000-4000-8000-000000000001',
                    email: 'customer@example.com'
                });
            }
            if (String(url).endsWith('/rpc/start_telegram_account_link')) {
                linkRequest = JSON.parse(init.body);
                return Response.json(null);
            }
            throw new Error(`Unexpected request: ${url}`);
        }
    }, async baseUrl => {
        const response = await fetch(`${baseUrl}/link/start`, {
            method: 'POST',
            headers: { Authorization: 'Bearer user-session-token' }
        });
        assert.equal(response.status, 201);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        const result = await response.json();
        const link = new URL(result.url);
        const code = link.searchParams.get('start').slice('link_'.length);
        assert.equal(link.hostname, 't.me');
        assert.equal(link.pathname, '/DrDarSunClientBot');
        assert.match(code, /^[a-f0-9]{48}$/);
        assert.equal(result.expiresInSeconds, 600);
        assert.equal(linkRequest.p_user_id, '00000000-0000-4000-8000-000000000001');
        assert.equal(linkRequest.p_email, 'customer@example.com');
        assert.equal(linkRequest.p_code_hash, require('node:crypto').createHash('sha256').update(code).digest('hex'));
        assert.notEqual(linkRequest.p_code_hash, code);
    });
});

test('only the configured client bot can confirm a link for its private chat', async () => {
    let confirmation;
    await withRouter({
        env: {
            CLIENT_BOT_TOKEN: 'client-bot-secret',
            SUPABASE_URL: 'https://supabase.example',
            SUPABASE_SERVICE_ROLE_KEY: 'service-key'
        },
        fetch: async (url, init = {}) => {
            if (String(url).endsWith('/rpc/confirm_telegram_link')) {
                confirmation = JSON.parse(init.body);
                return Response.json(true);
            }
            throw new Error(`Unexpected request: ${url}`);
        }
    }, async baseUrl => {
        const response = await fetch(`${baseUrl}/client/link/confirm`, {
            method: 'POST',
            headers: {
                Authorization: 'Bearer client-bot-secret',
                'X-Telegram-Chat-Id': '123456789',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ code: 'a'.repeat(48), username: 'customer_user' })
        });
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { success: true });
        assert.equal(confirmation.p_telegram_chat_id, '123456789');
        assert.equal(confirmation.p_telegram_username, 'customer_user');
        assert.equal(confirmation.p_code_hash, require('node:crypto').createHash('sha256').update('a'.repeat(48)).digest('hex'));
    });
});

test('non-client bot roles cannot use client account-link endpoints', async () => {
    await withRouter({
        env: { ADMIN_BOT_TOKEN: 'admin-bot-secret' },
        fetch: async () => { throw new Error('Database should not be queried'); }
    }, async baseUrl => {
        const response = await fetch(`${baseUrl}/client/link/confirm`, {
            method: 'POST',
            headers: {
                Authorization: 'Bearer admin-bot-secret',
                'X-Telegram-Chat-Id': '123456789',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ code: 'a'.repeat(48) })
        });
        assert.equal(response.status, 403);
    });
});

test('Telegram login request returns one-time bot link while storing only the poll-secret hash', async () => {
    let storedRequest;
    await withRouter({
        env: {
            SUPABASE_URL: 'https://supabase.example',
            SUPABASE_SERVICE_ROLE_KEY: 'service-key',
            TELEGRAM_WORKER_SHARED_SECRET: 'test-secret-with-more-than-32-characters',
            CLIENT_BOT_USERNAME: 'DrDarSunClientBot'
        },
        fetch: async (url, init = {}) => {
            assert.equal(String(url), 'https://supabase.example/rest/v1/rpc/create_telegram_login_request');
            storedRequest = JSON.parse(init.body);
            return Response.json(null);
        }
    }, async baseUrl => {
        const response = await fetch(`${baseUrl}/login/request`, { method: 'POST' });
        assert.equal(response.status, 201);
        const result = await response.json();
        assert.match(result.id, /^[a-f0-9]{48}$/);
        assert.match(result.pollSecret, /^[a-f0-9]{64}$/);
        assert.equal(storedRequest.p_id, result.id);
        assert.equal(storedRequest.p_poll_token_hash, require('node:crypto').createHash('sha256').update(result.pollSecret).digest('hex'));
        assert.notEqual(storedRequest.p_poll_token_hash, result.pollSecret);
        assert.ok(Date.parse(storedRequest.p_expires_at) > Date.now());
        assert.ok(Date.parse(storedRequest.p_expires_at) <= Date.now() + 5 * 60 * 1000 + 1000);
        assert.equal(new URL(result.url).searchParams.get('start'), `login_${result.id}`);
        assert.equal(response.headers.get('cache-control'), 'no-store');
    });
});

test('login code delivery is bound to the linked private Telegram account and is derived server-side', async () => {
    let beginRequest;
    const requestId = 'a'.repeat(48);
    const chatId = '123456789';
    const secret = 'test-secret-with-more-than-32-characters';
    await withRouter({
        env: {
            CLIENT_BOT_TOKEN: 'client-bot-secret',
            SUPABASE_URL: 'https://supabase.example',
            SUPABASE_SERVICE_ROLE_KEY: 'service-key',
            TELEGRAM_WORKER_SHARED_SECRET: secret
        },
        fetch: async (url, init = {}) => {
            assert.equal(String(url), 'https://supabase.example/rest/v1/rpc/begin_telegram_login');
            beginRequest = JSON.parse(init.body);
            return Response.json(chatId);
        }
    }, async baseUrl => {
        const response = await fetch(`${baseUrl}/client/login/code`, {
            method: 'POST',
            headers: {
                Authorization: 'Bearer client-bot-secret',
                'X-Telegram-Chat-Id': chatId,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ id: requestId })
        });
        assert.equal(response.status, 200);
        const { code } = await response.json();
        assert.match(code, /^\d{6}$/);
        const digest = require('node:crypto').createHmac('sha256', secret)
            .update(`telegram-login-code:v1:${requestId}:${chatId}`)
            .digest();
        const expectedCode = String(Number(digest.readBigUInt64BE(0) % 1000000n)).padStart(6, '0');
        assert.equal(code, expectedCode);
        assert.equal(beginRequest.p_request_id, requestId);
        assert.equal(beginRequest.p_telegram_chat_id, chatId);
        assert.equal(beginRequest.p_code_hash, require('node:crypto').createHmac('sha256', secret)
            .update(`telegram-login-verify:v1:${requestId}:${code}`).digest('hex'));
    });
});

test('one-time Telegram login code is consumed before Supabase creates a session OTP', async () => {
    const crypto = require('node:crypto');
    let verification;
    let magiclinkRequested = false;
    await withRouter({
        env: {
            SUPABASE_URL: 'https://supabase.example',
            SUPABASE_SERVICE_ROLE_KEY: 'service-key',
            TELEGRAM_WORKER_SHARED_SECRET: 'test-secret-with-more-than-32-characters'
        },
        fetch: async (url, init = {}) => {
            if (String(url).endsWith('/rpc/verify_telegram_login')) {
                verification = JSON.parse(init.body);
                return Response.json([{
                    user_id: '00000000-0000-4000-8000-000000000001',
                    email: 'customer@example.com'
                }]);
            }
            if (String(url).endsWith('/auth/v1/admin/generate_link')) {
                magiclinkRequested = true;
                assert.deepEqual(JSON.parse(init.body), {
                    type: 'magiclink',
                    email: 'customer@example.com'
                });
                return Response.json({ email_otp: 'one-time-supabase-otp' });
            }
            throw new Error(`Unexpected request: ${url}`);
        }
    }, async baseUrl => {
        const id = 'b'.repeat(48);
        const pollSecret = 'c'.repeat(64);
        const code = '123456';
        const response = await fetch(`${baseUrl}/login/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, pollSecret, code })
        });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.deepEqual(await response.json(), {
            email: 'customer@example.com',
            emailOtp: 'one-time-supabase-otp'
        });
        assert.equal(magiclinkRequested, true);
        assert.equal(verification.p_request_id, id);
        assert.equal(verification.p_poll_token_hash, crypto.createHash('sha256').update(pollSecret).digest('hex'));
        assert.equal(verification.p_code_hash, crypto.createHmac('sha256', 'test-secret-with-more-than-32-characters')
            .update(`telegram-login-verify:v1:${id}:${code}`).digest('hex'));
    });
});

test('public client bot info exposes only a validated username link', async () => {
    await withRouter({
        env: {
            CLIENT_BOT_TOKEN: 'never-return-this-token',
            CLIENT_BOT_USERNAME: '@DrDarSunClientBot',
            SUPPORT_BOT_USERNAME: '@DrDarSunHelp'
        },
        fetch: async () => { throw new Error('Public bot info must not call Telegram or Supabase'); }
    }, async baseUrl => {
        const response = await fetch(`${baseUrl}/client/info`);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('cache-control'), 'public, max-age=300');
        assert.deepEqual(await response.json(), {
            available: true,
            url: 'https://t.me/DrDarSunClientBot',
            supportAvailable: true,
            supportUrl: 'https://t.me/DrDarSunHelp'
        });
    });

    await withRouter({
        env: {
            CLIENT_BOT_TOKEN: 'never-return-this-token',
            CLIENT_BOT_USERNAME: 'bad name',
            SUPPORT_BOT_USERNAME: '@bad username'
        }
    }, async baseUrl => {
        const response = await fetch(`${baseUrl}/client/info`);
        assert.deepEqual(await response.json(), { available: false, supportAvailable: false });
    });

    await withRouter({
        env: {
            CLIENT_BOT_USERNAME: '@DrDarSunClientBot'
        }
    }, async baseUrl => {
        const response = await fetch(`${baseUrl}/client/info`);
        assert.deepEqual(await response.json(), {
            available: true,
            url: 'https://t.me/DrDarSunClientBot',
            supportAvailable: true,
            supportUrl: 'https://t.me/darsunhelp'
        });
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

test('maintenance changes update the live site-status cache immediately', async () => {
    const changes = [];
    const env = {
        ADMIN_BOT_TOKEN: 'admin-token',
        MY_CHAT_ID: '42',
        SITE_MAINTENANCE_PASSWORD: 'a-secure-maintenance-password',
        SUPABASE_URL: 'https://supabase.example',
        SUPABASE_SERVICE_ROLE_KEY: 'service-key'
    };
    await withRouter({
        env,
        onMaintenanceChanged: settings => changes.push(settings),
        fetch: async (url, init = {}) => {
            if (String(url).includes('site_runtime_settings?') && init.method !== 'POST') {
                return Response.json([{ value: { enabled: false, mode: 'planned' } }]);
            }
            if (String(url).includes('site_runtime_settings?') && init.method === 'POST') {
                return Response.json([{ value: { enabled: true, mode: 'emergency' } }]);
            }
            if (String(url).includes('/telegram_admin_audit')) return new Response(null, { status: 204 });
            throw new Error(`Unexpected database request: ${url}`);
        }
    }, async baseUrl => {
        const response = await fetch(`${baseUrl}/admin/maintenance`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${env.ADMIN_BOT_TOKEN}`,
                'X-Telegram-Chat-Id': env.MY_CHAT_ID,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                enabled: true,
                mode: 'emergency',
                password: env.SITE_MAINTENANCE_PASSWORD
            })
        });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.deepEqual(await response.json(), { enabled: true, mode: 'emergency' });
    });

    assert.deepEqual(changes, [{ enabled: true, mode: 'emergency' }]);
});

test('admin product deletion validates IDs, deletes the row, and records the action', async () => {
    const calls = [];
    const env = {
        ADMIN_BOT_TOKEN: 'admin-token',
        MY_CHAT_ID: '42',
        SUPABASE_URL: 'https://supabase.example',
        SUPABASE_SERVICE_ROLE_KEY: 'service-key'
    };
    await withRouter({
        env,
        fetch: async (url, init = {}) => {
            calls.push({ url: String(url), init });
            if (String(url).includes('/products?id=eq.product-123')) {
                assert.equal(init.method, 'DELETE');
                assert.equal(init.headers.Prefer, 'return=representation');
                return Response.json([{ id: 'product-123', name: 'Товар' }]);
            }
            if (String(url).includes('/telegram_admin_audit')) {
                return new Response(null, { status: 204 });
            }
            throw new Error(`Unexpected database request: ${url}`);
        }
    }, async baseUrl => {
        const headers = {
            Authorization: 'Bearer admin-token',
            'X-Telegram-Chat-Id': '42'
        };
        const invalid = await fetch(`${baseUrl}/panel/products/invalid.id`, {
            method: 'DELETE',
            headers
        });
        assert.equal(invalid.status, 400);
        assert.equal(calls.length, 0);

        const response = await fetch(`${baseUrl}/panel/products/product-123`, {
            method: 'DELETE',
            headers
        });
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), {
            product: { id: 'product-123', name: 'Товар' }
        });
    });

    assert.equal(calls.length, 2);
    assert.match(calls[1].url, /telegram_admin_audit/);
    assert.match(calls[1].init.body, /product\.deleted/);
});

test('admin product updates validate and persist catalog options', async () => {
    const calls = [];
    const env = {
        ADMIN_BOT_TOKEN: 'admin-token',
        MY_CHAT_ID: '42',
        SUPABASE_URL: 'https://supabase.example',
        SUPABASE_SERVICE_ROLE_KEY: 'service-key'
    };
    await withRouter({
        env,
        fetch: async (url, init = {}) => {
            calls.push({ url: String(url), init });
            if (String(url).includes('/products?id=eq.product-123')) {
                assert.equal(init.method, 'PATCH');
                assert.deepEqual(JSON.parse(init.body), {
                    volume: '500 мл',
                    packaging_type: 'Банка',
                    pressing_type: 'Рафинированное',
                    shelf_life_months: 12
                });
                return Response.json([{
                    id: 'product-123',
                    name: 'Товар',
                    volume: '500 мл',
                    packaging_type: 'Банка',
                    pressing_type: 'Рафинированное',
                    shelf_life_months: 12
                }]);
            }
            if (String(url).includes('/telegram_admin_audit')) return new Response(null, { status: 204 });
            throw new Error(`Unexpected database request: ${url}`);
        }
    }, async baseUrl => {
        const headers = {
            Authorization: 'Bearer admin-token',
            'X-Telegram-Chat-Id': '42',
            'Content-Type': 'application/json'
        };
        const response = await fetch(`${baseUrl}/panel/products/product-123`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify({
                volume: '500',
                packaging_type: 'Банка',
                pressing_type: 'Рафинированное',
                shelf_life_months: 12
            })
        });
        assert.equal(response.status, 200);

        const invalid = await fetch(`${baseUrl}/panel/products/product-123`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ packaging_type: 'x'.repeat(81) })
        });
        assert.equal(invalid.status, 400);
        assert.equal(calls.length, 2);
    });
});

test('admin can publish a non-oil catalog product with gram-based packaging', async () => {
    const calls = [];
    const env = {
        ADMIN_BOT_TOKEN: 'admin-token',
        MY_CHAT_ID: '42',
        SUPABASE_URL: 'https://supabase.example',
        SUPABASE_SERVICE_ROLE_KEY: 'service-key'
    };
    await withRouter({
        env,
        fetch: async (url, init = {}) => {
            calls.push({ url: String(url), init });
            if (String(url).includes('/products?select=') && init.method === 'POST') {
                const body = JSON.parse(init.body);
                assert.deepEqual(body, {
                    name: 'Хумус классический',
                    category: 'Хумус',
                    description: 'На основе нута',
                    price: 350,
                    image_url: 'assets/images/encyclopedia/hummus.svg',
                    volume: '200 г',
                    packaging_type: 'Стеклянная банка',
                    pressing_type: null,
                    shelf_life_months: null
                });
                return Response.json([{ id: 'hummus-1', ...body }]);
            }
            if (String(url).includes('/telegram_admin_audit')) return new Response(null, { status: 204 });
            throw new Error(`Unexpected database request: ${url}`);
        }
    }, async baseUrl => {
        const response = await fetch(`${baseUrl}/panel/products`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${env.ADMIN_BOT_TOKEN}`,
                'X-Telegram-Chat-Id': '42',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                kind: 'hummus',
                name: 'Хумус классический',
                category: 'Хумус',
                description: 'На основе нута',
                price: 350,
                volume: '200 г',
                packaging_type: 'Стеклянная банка',
                image_url: 'assets/images/encyclopedia/hummus.svg'
            })
        });
        const result = await response.json();
        assert.equal(response.status, 201, JSON.stringify(result));
        assert.equal(result.product.id, 'hummus-1');
    });

    assert.equal(calls.length, 2);
    assert.match(calls[1].init.body, /product\.created/);
});

test('admin can list and delete public or personal notifications', async () => {
    const calls = [];
    const notificationId = 'c8011389-2799-4c12-b72d-d742c1087094';
    const env = {
        ADMIN_BOT_TOKEN: 'admin-token',
        MY_CHAT_ID: '42',
        SUPABASE_URL: 'https://supabase.example',
        SUPABASE_SERVICE_ROLE_KEY: 'service-key'
    };
    await withRouter({
        env,
        fetch: async (url, init = {}) => {
            calls.push({ url: String(url), init });
            if (String(url).includes('site_public_toasts?') && init.method !== 'DELETE') {
                return Response.json([{ id: notificationId, message: 'Public', kind: 'info' }]);
            }
            if (String(url).includes('site_toast_notifications?select=id,user_id')) {
                return Response.json([{ id: notificationId, user_id: 'user-id', message: 'Personal', kind: 'warning' }]);
            }
            if (String(url).includes('site_public_toasts?id=eq.') && init.method === 'DELETE') {
                return Response.json([{ id: notificationId, message: 'Public' }]);
            }
            if (String(url).includes('site_toast_notifications?id=eq.') && init.method === 'PATCH') {
                const body = JSON.parse(init.body);
                assert.deepEqual(Object.keys(body), ['dismissed_at']);
                assert.ok(Number.isFinite(Date.parse(body.dismissed_at)));
                assert.match(String(url), /dismissed_at=is\.null/);
                return Response.json([{ id: notificationId, message: 'Personal' }]);
            }
            if (String(url).includes('telegram_admin_audit')) return new Response(null, { status: 204 });
            throw new Error(`Unexpected database request: ${url}`);
        }
    }, async baseUrl => {
        const headers = {
            Authorization: 'Bearer admin-token',
            'X-Telegram-Chat-Id': '42'
        };
        const list = await fetch(`${baseUrl}/admin/toasts`, { headers });
        assert.equal(list.status, 200);
        assert.deepEqual(await list.json(), {
            publicToasts: [{ id: notificationId, message: 'Public', kind: 'info' }],
            personalToasts: [{ id: notificationId, user_id: 'user-id', message: 'Personal', kind: 'warning' }]
        });

        const invalid = await fetch(`${baseUrl}/admin/toasts/unknown/${notificationId}`, {
            method: 'DELETE',
            headers
        });
        assert.equal(invalid.status, 400);

        const deleted = await fetch(`${baseUrl}/admin/toasts/public/${notificationId}`, {
            method: 'DELETE',
            headers
        });
        assert.equal(deleted.status, 200);
        assert.deepEqual(await deleted.json(), { deleted: true, scope: 'public', id: notificationId });

        const dismissed = await fetch(`${baseUrl}/admin/toasts/personal/${notificationId}`, {
            method: 'DELETE',
            headers
        });
        assert.equal(dismissed.status, 200);
        assert.deepEqual(await dismissed.json(), { deleted: true, scope: 'personal', id: notificationId });
    });

    assert.equal(calls.filter(call => call.init.method === 'DELETE').length, 1);
    assert.equal(calls.filter(call => call.init.method === 'PATCH').length, 1);
    assert.equal(calls.filter(call => call.url.includes('telegram_admin_audit')).length, 2);
});

test('admin ticket endpoints are retired while support tickets remain separate', async () => {
    await withRouter({
        env: {
            ADMIN_BOT_TOKEN: 'admin-token',
            HELP_BOT_TOKEN: 'support-token',
            MY_CHAT_ID: '42',
            SUPABASE_URL: 'https://supabase.example',
            SUPABASE_SERVICE_ROLE_KEY: 'service-key'
        },
        fetch: async url => {
            if (String(url).includes('telegram_support_tickets?')) return Response.json([]);
            throw new Error('Retired admin routes must not query the database');
        }
    }, async baseUrl => {
        const adminHeaders = {
            Authorization: 'Bearer admin-token',
            'X-Telegram-Chat-Id': '42'
        };
        const responses = await Promise.all([
            fetch(`${baseUrl}/admin/tickets`, { headers: adminHeaders }),
            fetch(`${baseUrl}/admin/tickets/00000000-0000-0000-0000-000000000001/messages`, { headers: adminHeaders }),
            fetch(`${baseUrl}/admin/tickets/00000000-0000-0000-0000-000000000001`, {
                method: 'PATCH',
                headers: { ...adminHeaders, 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'closed' })
            }),
            fetch(`${baseUrl}/support/my-ticket`, { headers: { Authorization: 'Bearer support-token', 'X-Telegram-Chat-Id': '123' } })
        ]);
        assert.deepEqual(responses.map(response => response.status), [404, 404, 404, 200]);
    });
});

test('support API accepts the configured support bot token', async () => {
    const env = {
        HELP_BOT_TOKEN: 'support-token',
        SUPABASE_URL: 'https://supabase.example',
        SUPABASE_SERVICE_ROLE_KEY: 'service-key'
    };
    await withRouter({
        env,
        fetch: async url => {
            assert.match(String(url), /telegram_support_tickets\?/);
            return Response.json([]);
        }
    }, async baseUrl => {
        const response = await fetch(`${baseUrl}/support/my-ticket`, {
            headers: {
                Authorization: 'Bearer support-token',
                'X-Telegram-Chat-Id': '123'
            }
        });
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { ticket: null, messages: [] });
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
