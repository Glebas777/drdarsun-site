const test = require('node:test');
const assert = require('node:assert/strict');
const { processTelegramUpdate, sendToUser, getBotState } = require('../telegram-bots');

function createFetch() {
    const calls = [];
    const fetch = async (url, init = {}) => {
        calls.push({ url: String(url), init });
        if (String(url).includes('api.telegram.org')) {
            return Response.json({ ok: true, result: { message_id: calls.length } });
        }
        throw new Error(`Unexpected request: ${url}`);
    };
    return { fetch, calls };
}

function privateMessage(chatId, text) {
    return {
        update_id: chatId,
        message: {
            message_id: chatId,
            text,
            chat: { id: chatId, type: 'private' },
            from: { id: chatId }
        }
    };
}

test('sendToUser sends through the configured role token with a 10-second timeout', async () => {
    const { fetch, calls } = createFetch();
    const result = await sendToUser('admin', 777, 'Серверный ответ', { parse_mode: 'HTML' }, {
        env: { ADMIN_BOT_TOKEN: 'admin-token' },
        fetch
    });

    assert.equal(result.message_id, 1);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.telegram.org/botadmin-token/sendMessage');
    assert.ok(calls[0].init.signal);
});

test('Telegram retries a 429 once after retry_after', async () => {
    let telegramCalls = 0;
    const fetch = async () => {
        telegramCalls++;
        if (telegramCalls === 1) {
            return Response.json({
                ok: false,
                description: 'Too Many Requests',
                parameters: { retry_after: 0.01 }
            }, { status: 429 });
        }
        return Response.json({ ok: true, result: { message_id: telegramCalls } });
    };

    await processTelegramUpdate('admin', privateMessage(891, '/start'), {
        env: { ADMIN_BOT_TOKEN: 'admin-token', MY_CHAT_ID: '891' },
        fetch
    });

    assert.equal(telegramCalls, 2);
});

test('admin API requests use the Worker shared secret', async () => {
    const calls = [];
    const fetch = async (url, init = {}) => {
        const requestUrl = String(url);
        calls.push({ url: requestUrl, init });
        if (requestUrl.includes('api.telegram.org')) {
            return Response.json({ ok: true, result: { message_id: calls.length } });
        }
        if (requestUrl.endsWith('/api/telegram/admin/orders?offset=0')) {
            return Response.json({ orders: [] });
        }
        if (requestUrl.endsWith('/api/gigachat')) {
            assert.equal(init.headers['X-Telegram-Worker-Secret'], 'shared-secret');
            return Response.json({
                reply: 'Здравствуйте!',
                escalation: { required: false, topic: 'Другое' }
            });
        }
        throw new Error(`Unexpected request: ${requestUrl}`);
    };

    await processTelegramUpdate('admin', privateMessage(892, '/orders'), {
        env: {
            ADMIN_BOT_TOKEN: 'admin-token',
            MY_CHAT_ID: '892',
            TELEGRAM_WORKER_SHARED_SECRET: 'shared-secret',
            BOT_API_BASE_URL: 'https://backend.example'
        },
        fetch
    });

    assert.ok(calls.some(call => call.url.includes('/api/telegram/panel/orders') || call.url.includes('/panel/orders')));
});

test('product pagination keeps the API page intact for nonzero offsets', async () => {
    const requests = [];
    const fetch = async (url, init = {}) => {
        const requestUrl = String(url);
        requests.push({ url: requestUrl, init });
        if (requestUrl.includes('/panel/products?')) {
            const offset = Number(new URL(requestUrl).searchParams.get('offset'));
            return Response.json({
                products: Array.from({ length: 8 }, (_, index) => ({
                    id: `product-${offset + index}`,
                    name: `Product ${offset + index}`,
                    price: 10,
                    volume: '250 мл',
                    packaging_type: 'стекло',
                    pressing_type: 'холодный отжим'
                })),
                hasMore: offset === 0
            });
        }
        if (requestUrl.includes('api.telegram.org')) {
            return Response.json({ ok: true, result: { message_id: requests.length } });
        }
        throw new Error(`Unexpected request: ${requestUrl}`);
    };
    const env = { ADMIN_BOT_TOKEN: 'admin-token', MY_CHAT_ID: '552' };

    await processTelegramUpdate('admin', privateMessage(552, '/products'), { env, fetch });
    await processTelegramUpdate('admin', {
        update_id: 553,
        callback_query: {
            id: 'products-next',
            data: 'p:products:next',
            message: { chat: { id: 552, type: 'private' }, message_id: 553 }
        }
    }, { env, fetch });

    assert.ok(requests.some(request => request.url.includes('/panel/products?limit=8&offset=8')));
    assert.equal(getBotState('panel', 552).products.length, 8);
    assert.equal(getBotState('panel', 552).products[0].name, 'Product 8');
});

test('duplicate order entries keep distinct action indexes', async () => {
    const calls = [];
    const duplicatedOrder = {
        id: 'order-duplicate',
        status: 'pending',
        total: 25,
        items: []
    };
    const fetch = async (url, init = {}) => {
        const requestUrl = String(url);
        calls.push({ url: requestUrl, init, at: Date.now() });
        if (requestUrl.includes('/panel/orders?')) {
            return Response.json({ orders: [duplicatedOrder, duplicatedOrder], hasMore: false });
        }
        if (requestUrl.includes('api.telegram.org')) {
            return Response.json({ ok: true, result: { message_id: calls.length } });
        }
        throw new Error(`Unexpected request: ${requestUrl}`);
    };

    await processTelegramUpdate('admin', privateMessage(554, '/orders'), {
        env: { ADMIN_BOT_TOKEN: 'admin-token', MY_CHAT_ID: '554' },
        fetch
    });
    const sentCalls = calls.filter(call => call.url.endsWith('/sendMessage'));
    const sentMessages = sentCalls.map(call => JSON.parse(call.init.body));

    assert.equal(sentMessages.length, 3);
    assert.equal(sentMessages[0].reply_markup.inline_keyboard[0][0].callback_data, 'p:o:0:pending');
    assert.equal(sentMessages[1].reply_markup.inline_keyboard[0][0].callback_data, 'p:o:1:pending');
    assert.ok(sentCalls[1].at - sentCalls[0].at >= 900);
    assert.ok(sentCalls[2].at - sentCalls[1].at >= 900);
});

test('long messages attach reply markup only to the final chunk', async () => {
    const calls = [];
    const fetch = async (url, init = {}) => {
        const requestUrl = String(url);
        calls.push({ url: requestUrl, init });
        if (requestUrl.includes('/panel/audit?')) {
            return Response.json({
                entries: Array.from({ length: 20 }, (_, index) => ({
                    id: `audit-${index}`,
                    created_at: '2026-01-01T00:00:00Z',
                    action: 'order.updated',
                    entity_type: 'order',
                    entity_id: String(index),
                    details: { value: 'x'.repeat(280) }
                })),
                hasMore: true
            });
        }
        if (requestUrl.includes('api.telegram.org')) {
            return Response.json({ ok: true, result: { message_id: calls.length } });
        }
        throw new Error(`Unexpected request: ${requestUrl}`);
    };

    await processTelegramUpdate('admin', privateMessage(555, '/history'), {
        env: { ADMIN_BOT_TOKEN: 'admin-token', MY_CHAT_ID: '555' },
        fetch
    });
    const sentMessages = calls
        .filter(call => call.url.endsWith('/sendMessage'))
        .map(call => JSON.parse(call.init.body));

    assert.ok(sentMessages.length > 1);
    assert.ok(sentMessages.slice(0, -1).every(message => !message.reply_markup));
    assert.ok(sentMessages.at(-1).reply_markup);
});

test('admin bot silently ignores chats that are not configured owners', async () => {
    const { fetch, calls } = createFetch();
    const env = {
        ADMIN_BOT_TOKEN: 'admin-token',
        PANEL_BOT_TOKEN: 'panel-token',
        MY_CHAT_ID: '42'
    };

    const adminResult = await processTelegramUpdate('admin', privateMessage(99, '/start'), { env, fetch });

    assert.equal(adminResult.reason, 'chat-not-allowed');
    assert.equal(calls.length, 0);
});

test('admin bot accepts the shared MY_CHAT_ID', async () => {
    const { fetch, calls } = createFetch();
    const result = await processTelegramUpdate('admin', privateMessage(42, '/start'), {
        env: { ADMIN_BOT_TOKEN: 'admin-token', MY_CHAT_ID: '42' },
        fetch
    });

    assert.equal(result.processed, true);
    assert.equal(calls.filter(call => call.url.includes('sendMessage')).length, 1);
});

test('admin ignores an outsider chat', async () => {
    const outsiderFetch = createFetch();
    const outsider = await processTelegramUpdate('admin', privateMessage(99, '/start'), {
        env: { ADMIN_BOT_TOKEN: 'admin-token', MY_CHAT_ID: '42' },
        fetch: outsiderFetch.fetch
    });
    assert.equal(outsider.reason, 'chat-not-allowed');
    assert.equal(outsiderFetch.calls.length, 0);

    const ownerFetch = createFetch();
    const owner = await processTelegramUpdate('admin', privateMessage(42, '/start'), {
        env: { ADMIN_BOT_TOKEN: 'admin-token', MY_CHAT_ID: '42' },
        fetch: ownerFetch.fetch
    });
    assert.equal(owner.processed, true);
});

test('retired Telegram roles are rejected', async () => {
    await assert.rejects(
        processTelegramUpdate('auth', privateMessage(702, '/start'), { env: {} }),
        /Unknown Telegram bot role/
    );
});

test('removed admin export command does not query the database or upload a document', async () => {
    const calls = [];
    const fetch = async (url, init = {}) => {
        calls.push({ url: String(url), init });
        if (String(url).includes('api.telegram.org')) {
            return Response.json({ ok: true, result: { message_id: calls.length } });
        }
        throw new Error(`Unexpected request: ${url}`);
    };
    const result = await processTelegramUpdate('admin', privateMessage(42, '/backup'), {
        env: {
            ADMIN_BOT_TOKEN: 'admin-token',
            MY_CHAT_ID: '42',
            BOT_API_BASE_URL: 'https://backend.example'
        },
        fetch
    });

    assert.equal(result.processed, true);
    assert.equal(calls.some(call => call.url.endsWith('/sendDocument')), false);
    assert.equal(calls.some(call => call.url.includes('/api/telegram/admin/')), false);
});
