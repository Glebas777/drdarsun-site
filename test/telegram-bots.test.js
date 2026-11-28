const test = require('node:test');
const assert = require('node:assert/strict');
const { processTelegramUpdate, sendToUser, getBotState, setBotState } = require('../telegram-bots');

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

test('client bot welcome message explains account linking, Telegram notifications, and login codes', async () => {
    const { fetch, calls } = createFetch();
    await processTelegramUpdate('client', privateMessage(778, '/start'), {
        env: {
            CLIENT_BOT_TOKEN: 'client-token',
            SUPPORT_BOT_USERNAME: 'darsunhelp'
        },
        fetch
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.telegram.org/botclient-token/sendMessage');
    const payload = JSON.parse(calls[0].init.body);
    assert.match(payload.text, /привяжите его в личном кабинете/i);
    assert.match(payload.text, /выбранные уведомления/i);
    assert.match(payload.text, /одноразовому коду/i);
    assert.deepEqual(payload.reply_markup.inline_keyboard[0].map(button => button.url), [
        'https://drdarsun.ru/catalog.html',
        'https://t.me/darsunhelp'
    ]);
});

test('client bot confirms an account-link deep link through the authenticated site API', async () => {
    const calls = [];
    const code = 'a'.repeat(48);
    const fetch = async (url, init = {}) => {
        calls.push({ url: String(url), init });
        if (String(url).endsWith('/api/telegram/client/link/confirm')) {
            assert.deepEqual(JSON.parse(init.body), { code, username: null });
            assert.equal(init.headers['X-Telegram-Chat-Id'], '780');
            assert.equal(init.headers.Authorization, 'Bearer client-token');
            return Response.json({ success: true });
        }
        if (String(url).includes('api.telegram.org')) {
            return Response.json({ ok: true, result: { message_id: calls.length } });
        }
        throw new Error(`Unexpected request: ${url}`);
    };

    await processTelegramUpdate('client', privateMessage(780, `/start link_${code}`), {
        env: {
            CLIENT_BOT_TOKEN: 'client-token',
            BOT_API_BASE_URL: 'https://backend.example'
        },
        fetch
    });

    assert.ok(calls.some(call => call.url.endsWith('/api/telegram/client/link/confirm')));
    const message = calls.find(call => call.url.endsWith('/sendMessage'));
    assert.match(JSON.parse(message.init.body).text, /Telegram подключён/);
});

test('client bot returns login codes only after the backend validates the linked chat', async () => {
    const calls = [];
    const id = 'b'.repeat(48);
    const fetch = async (url, init = {}) => {
        calls.push({ url: String(url), init });
        if (String(url).endsWith('/api/telegram/client/login/code')) {
            assert.deepEqual(JSON.parse(init.body), { id });
            assert.equal(init.headers['X-Telegram-Chat-Id'], '781');
            return Response.json({ code: '042615' });
        }
        if (String(url).includes('api.telegram.org')) {
            return Response.json({ ok: true, result: { message_id: calls.length } });
        }
        throw new Error(`Unexpected request: ${url}`);
    };

    await processTelegramUpdate('client', privateMessage(781, `/start login_${id}`), {
        env: {
            CLIENT_BOT_TOKEN: 'client-token',
            BOT_API_BASE_URL: 'https://backend.example'
        },
        fetch
    });

    const message = calls.find(call => call.url.endsWith('/sendMessage'));
    assert.match(JSON.parse(message.init.body).text, /042615/);
    assert.match(JSON.parse(message.init.body).text, /одноразовый/);
});

test('client bot links support to the provided account username by default', async () => {
    const { fetch, calls } = createFetch();
    await processTelegramUpdate('client', privateMessage(779, '/start'), {
        env: { CLIENT_BOT_TOKEN: 'client-token' },
        fetch
    });

    const payload = JSON.parse(calls[0].init.body);
    assert.deepEqual(payload.reply_markup.inline_keyboard, [[
        { text: 'Открыть каталог', url: 'https://drdarsun.ru/catalog.html' },
        { text: 'Поддержка', url: 'https://t.me/darsunhelp' }
    ]]);
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

test('admin API requests use the configured bot token', async () => {
    const calls = [];
    const fetch = async (url, init = {}) => {
        const requestUrl = String(url);
        calls.push({ url: requestUrl, init });
        if (requestUrl.includes('api.telegram.org')) {
            return Response.json({ ok: true, result: { message_id: calls.length } });
        }
        if (requestUrl.endsWith('/api/telegram/panel/orders?offset=0')) {
            assert.equal(init.headers.Authorization, 'Bearer admin-token');
            assert.equal(init.headers['X-Telegram-Chat-Id'], '892');
            return Response.json({ orders: [] });
        }
        throw new Error(`Unexpected request: ${requestUrl}`);
    };

    await processTelegramUpdate('admin', privateMessage(892, '/orders'), {
        env: {
            ADMIN_BOT_TOKEN: 'admin-token',
            MY_CHAT_ID: '892',
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

test('admin bot requires explicit confirmation before deleting a product', async () => {
    const calls = [];
    let productIsDeleted = false;
    const product = {
        id: 'product-1',
        name: 'Льняное масло',
        category: 'Семенные масла',
        price: 560,
        volume: '250 мл',
        packaging_type: 'Тёмное стекло',
        pressing_type: 'Холодный отжим',
        shelf_life_months: 6
    };
    const previousProduct = { id: 'product-previous', name: 'Масло подсолнечное', price: 400 };
    const fetch = async (url, init = {}) => {
        const requestUrl = String(url);
        calls.push({ url: requestUrl, init });
        if (requestUrl.includes('/panel/products?')) {
            const offset = Number(new URL(requestUrl).searchParams.get('offset'));
            return Response.json({
                products: offset === 0 && productIsDeleted ? [previousProduct] : productIsDeleted ? [] : [product],
                hasMore: false
            });
        }
        if (requestUrl.includes('/panel/products/product-1') && init.method === 'DELETE') {
            productIsDeleted = true;
            return Response.json({ product: { id: 'product-1', name: 'Льняное масло' } });
        }
        if (requestUrl.includes('api.telegram.org')) return Response.json({ ok: true, result: { message_id: calls.length } });
        throw new Error(`Unexpected request: ${requestUrl}`);
    };
    const env = { ADMIN_BOT_TOKEN: 'admin-token', MY_CHAT_ID: '39554' };
    setBotState('panel', 39554, { flow: 'products-list', products: [product], offset: 8, hasNext: false });
    const callback = (updateId, data) => ({
        update_id: updateId,
        callback_query: {
            id: `delete-${updateId}`,
            data,
            message: { chat: { id: 39554, type: 'private' }, message_id: updateId }
        }
    });

    await processTelegramUpdate('admin', callback(555, 'p:pe:0'), { env, fetch });
    await processTelegramUpdate('admin', callback(556, 'p:pd:0'), { env, fetch });
    assert.equal(getBotState('panel', 39554).flow, 'confirm-product-delete');
    assert.equal(calls.some(call => call.init.method === 'DELETE'), false);

    await processTelegramUpdate('admin', callback(557, 'p:product:delete:confirm'), { env, fetch });
    assert.ok(calls.some(call => call.init.method === 'DELETE' && call.url.includes('/panel/products/product-1')));
    assert.equal(getBotState('panel', 39554).offset, 0);
    assert.equal(getBotState('panel', 39554).products[0].id, previousProduct.id);
});

test('admin bot can edit a product volume after confirmation', async () => {
    const calls = [];
    const fetch = async (url, init = {}) => {
        const requestUrl = String(url);
        calls.push({ url: requestUrl, init });
        if (requestUrl.includes('/panel/products/product-2') && init.method === 'PATCH') {
            return Response.json({ product: { id: 'product-2', name: 'Масло · 500 мл', volume: '500 мл' } });
        }
        if (requestUrl.includes('api.telegram.org')) return Response.json({ ok: true, result: { message_id: calls.length } });
        throw new Error(`Unexpected request: ${requestUrl}`);
    };
    const chatId = 39555;
    const env = { ADMIN_BOT_TOKEN: 'admin-token', MY_CHAT_ID: String(chatId) };
    const product = { id: 'product-2', name: 'Масло · 250 мл', price: 500 };
    setBotState('panel', chatId, { flow: 'products-list', products: [product], offset: 0 });
    const callback = (updateId, data) => ({
        update_id: updateId,
        callback_query: {
            id: `edit-${updateId}`,
            data,
            message: { chat: { id: chatId, type: 'private' }, message_id: updateId }
        }
    });

    await processTelegramUpdate('admin', callback(39556, 'p:pe:0'), { env, fetch });
    await processTelegramUpdate('admin', callback(39557, 'p:pf:0:volume'), { env, fetch });
    await processTelegramUpdate('admin', {
        update_id: 39558,
        message: { message_id: 39558, text: '500 мл', chat: { id: chatId, type: 'private' }, from: { id: chatId } }
    }, { env, fetch });
    assert.equal(getBotState('panel', chatId).flow, 'confirm-product-update');
    await processTelegramUpdate('admin', callback(39559, 'p:product:update:confirm'), { env, fetch });

    const updateRequest = calls.find(call => call.init.method === 'PATCH');
    assert.ok(updateRequest);
    assert.deepEqual(JSON.parse(updateRequest.init.body), { volume: '500 мл' });
    assert.deepEqual(getBotState('panel', chatId), {});
});

test('admin bot confirms notification deletion before calling the delete API', async () => {
    const calls = [];
    const notificationId = 'c8011389-2799-4c12-b72d-d742c1087094';
    const fetch = async (url, init = {}) => {
        const requestUrl = String(url);
        calls.push({ url: requestUrl, init });
        if (requestUrl.includes('/admin/toasts') && init.method === 'DELETE') {
            return Response.json({ deleted: true });
        }
        if (requestUrl.endsWith('/admin/toasts')) {
            return Response.json({
                publicToasts: [{ id: notificationId, message: 'Public notice', kind: 'info', expires_at: null }],
                personalToasts: []
            });
        }
        if (requestUrl.includes('api.telegram.org')) return Response.json({ ok: true, result: { message_id: calls.length } });
        throw new Error(`Unexpected request: ${requestUrl}`);
    };
    const env = {
        ADMIN_BOT_TOKEN: 'admin-token',
        MY_CHAT_ID: '39811',
        BOT_API_BASE_URL: 'https://backend.example'
    };
    const callback = (updateId, data) => ({
        update_id: updateId,
        callback_query: {
            id: `toast-${updateId}`,
            data,
            message: { chat: { id: 39811, type: 'private' }, message_id: updateId }
        }
    });

    await processTelegramUpdate('admin', privateMessage(39811, '/toasts'), { env, fetch });
    const listMessage = calls
        .filter(call => call.url.endsWith('/sendMessage'))
        .map(call => JSON.parse(call.init.body))
        .find(message => message.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data === `adm:td:public:${notificationId}`);
    assert.ok(listMessage);

    await processTelegramUpdate('admin', callback(39812, `adm:td:public:${notificationId}`), { env, fetch });
    assert.equal(getBotState('admin', 39811).flow, 'confirm-toast-delete');
    assert.equal(calls.some(call => call.init.method === 'DELETE'), false);

    await processTelegramUpdate('admin', callback(39813, 'adm:toast:delete:confirm'), { env, fetch });
    assert.ok(calls.some(call => call.url.endsWith(`/admin/toasts/public/${notificationId}`) && call.init.method === 'DELETE'));
    assert.equal(getBotState('admin', 39811).flow, 'admin-toasts');
});

test('admin order command accepts a status filter and shares durable panel state', async () => {
    const calls = [];
    const fetch = async (url, init = {}) => {
        const requestUrl = String(url);
        calls.push({ url: requestUrl, init });
        if (requestUrl.includes('/panel/orders?')) return Response.json({ orders: [] });
        if (requestUrl.includes('api.telegram.org')) return Response.json({ ok: true, result: { message_id: calls.length } });
        throw new Error(`Unexpected request: ${requestUrl}`);
    };

    await processTelegramUpdate('admin', privateMessage(893, '/orders processing'), {
        env: { ADMIN_BOT_TOKEN: 'admin-token', MY_CHAT_ID: '893' },
        fetch
    });

    assert.ok(calls.some(call => call.url.endsWith('/panel/orders?offset=0&status=processing')));
    assert.equal(getBotState('admin', 893).flow, 'orders-list');
    assert.equal(getBotState('panel', 893).status, 'processing');
    setBotState('admin', 893, { flow: 'confirm-order', orderId: 'order-1' });
    assert.deepEqual(getBotState('panel', 893), { flow: 'confirm-order', orderId: 'order-1' });
});

test('admin bot can start the panel product wizard and select an oil', async () => {
    const calls = [];
    const fetch = async (url, init = {}) => {
        const requestUrl = String(url);
        calls.push({ url: requestUrl, init });
        if (requestUrl.endsWith('/panel/oil-types')) {
            return Response.json({
                oils: [{ id: 'oil-1', name: 'Кедровое', category: 'Ореховые', image_url: '' }],
                packagingTypes: ['Стекло'],
                pressingTypes: ['Холодный отжим'],
                shelfLifeMonths: [12],
                volumes: [250]
            });
        }
        if (requestUrl.includes('api.telegram.org')) {
            return Response.json({ ok: true, result: { message_id: calls.length } });
        }
        throw new Error(`Unexpected request: ${requestUrl}`);
    };
    const env = { ADMIN_BOT_TOKEN: 'admin-token', MY_CHAT_ID: '894' };

    await processTelegramUpdate('admin', privateMessage(894, '/newproduct'), { env, fetch });
    assert.equal(getBotState('admin', 894).flow, 'new-product-kind');

    await processTelegramUpdate('admin', {
        update_id: 8941,
        callback_query: {
            id: 'select-oil-type',
            data: 'p:product-type:oil',
            message: { chat: { id: 894, type: 'private' }, message_id: 8941 }
        }
    }, { env, fetch });
    assert.equal(getBotState('admin', 894).flow, 'new-product-oil');

    await processTelegramUpdate('admin', {
        update_id: 895,
        callback_query: {
            id: 'select-oil',
            data: 'p:oil:0',
            message: { chat: { id: 894, type: 'private' }, message_id: 895 }
        }
    }, { env, fetch });

    assert.equal(getBotState('panel', 894).flow, 'new-product-packaging');
    assert.equal(getBotState('admin', 894).product.name, 'Кедровое');
    assert.ok(calls.some(call => call.url.endsWith('/panel/oil-types')));
});

test('admin bot starts a non-oil product flow from the selected category', async () => {
    const fetch = async (url) => {
        if (String(url).endsWith('/panel/oil-types')) return Response.json({ oils: [] });
        if (String(url).includes('api.telegram.org')) return Response.json({ ok: true, result: { message_id: 1 } });
        throw new Error(`Unexpected request: ${url}`);
    };
    const env = { ADMIN_BOT_TOKEN: 'admin-token', MY_CHAT_ID: '895' };

    await processTelegramUpdate('admin', privateMessage(895, '/newproduct'), { env, fetch });
    await processTelegramUpdate('admin', {
        update_id: 8951,
        callback_query: {
            id: 'select-hummus',
            data: 'p:product-type:hummus',
            message: { chat: { id: 895, type: 'private' }, message_id: 8951 }
        }
    }, { env, fetch });

    const state = getBotState('panel', 895);
    assert.equal(state.flow, 'new-product-general-name');
    assert.equal(state.product.kind, 'hummus');
    assert.equal(state.product.category, 'Хумус');
    assert.equal(state.product.image_url, 'assets/images/encyclopedia/hummus.svg');
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

test('account-code and separate panel roles remain retired', async () => {
    for (const role of ['auth', 'panel']) {
        await assert.rejects(
            processTelegramUpdate(role, privateMessage(702, '/start'), { env: {} }),
            /Unknown Telegram bot role/
        );
    }
});

test('support bot remains available to customers without an admin chat ID', async () => {
    const { fetch, calls } = createFetch();
    const result = await processTelegramUpdate('support', privateMessage(703, '/start'), {
        env: { HELP_BOT_TOKEN: 'support-token' },
        fetch
    });

    assert.equal(result.processed, true);
    assert.equal(calls[0].url, 'https://api.telegram.org/botsupport-token/sendMessage');
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
