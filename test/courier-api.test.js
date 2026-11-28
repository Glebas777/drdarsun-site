const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { once } = require('node:events');
const createCourierApi = require('../courier-api');

const userId = '123e4567-e89b-42d3-a456-426614174000';
const orderId = '37';

async function startServer(router) {
    const app = express();
    app.use(express.json());
    app.use('/api/courier', router);
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    return {
        server,
        url: `http://127.0.0.1:${server.address().port}/api/courier`
    };
}

function response(data, status = 200) {
    return Response.json(data, { status });
}

function makeFetch({
    courier = { user_id: userId, name: 'Курьер', phone: null, status: 'active' },
    order,
    telegramTarget = null
} = {}) {
    const requests = [];
    const fetch = async (url, init = {}) => {
        const parsed = new URL(url);
        requests.push({ url: parsed, init });
        if (parsed.hostname === 'api.telegram.org') return response({ ok: true, result: { message_id: 1 } });
        if (parsed.pathname.endsWith('/rest/v1/rpc/get_telegram_notification_target')) return response(telegramTarget);
        if (parsed.pathname.endsWith('/auth/v1/user')) return response({ id: userId });
        if (parsed.pathname.endsWith('/rest/v1/couriers')) return response(courier ? [courier] : []);
        if (parsed.pathname.endsWith('/rest/v1/orders') && init.method === 'PATCH') {
            return response([{ ...order, ...(JSON.parse(init.body)), courier_id: userId }]);
        }
        if (parsed.pathname.endsWith('/rest/v1/orders')) return response(order ? [order] : []);
        throw new Error(`Unexpected request: ${url}`);
    };
    fetch.requests = requests;
    return fetch;
}

test('courier API refuses requests without a verified courier bearer session', async t => {
    const server = await startServer(createCourierApi({
        env: {
            SUPABASE_URL: 'https://database.example',
            SUPABASE_ANON_KEY: 'public-key',
            SUPABASE_SERVICE_ROLE_KEY: 'server-key'
        },
        fetch: makeFetch()
    }));
    t.after(() => new Promise(resolve => server.server.close(resolve)));

    const response = await fetch(`${server.url}/orders`);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'Войдите под аккаунтом курьера.' });
});

test('courier order list is scoped to the courier and omits customer email', async t => {
    const fetchImpl = makeFetch({
        order: {
            id: orderId,
            courier_id: userId,
            status: 'accepted',
            customer_name: 'Покупатель',
            customer_phone: '+79990000000',
            delivery_address: 'Москва, улица Примерная, 1',
            total: 1400,
            payment_method: 'cash'
        }
    });
    const server = await startServer(createCourierApi({
        env: {
            SUPABASE_URL: 'https://database.example',
            SUPABASE_ANON_KEY: 'public-key',
            SUPABASE_SERVICE_ROLE_KEY: 'server-key'
        },
        fetch: fetchImpl
    }));
    t.after(() => new Promise(resolve => server.server.close(resolve)));

    const response = await fetch(`${server.url}/orders`, {
        headers: { Authorization: 'Bearer session-token' }
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.orders[0].customer_phone, '+79990000000');
    assert.equal('customer_email' in body.orders[0], false);
    const query = fetchImpl.requests.at(-1).url.searchParams;
    assert.match(query.get('or'), new RegExp(userId));
    assert.equal(query.get('select').includes('customer_email'), false);
});

test('courier claims an unassigned pending cash order atomically', async t => {
    const fetchImpl = makeFetch({
        order: { id: orderId, status: 'pending', payment_method: 'cash', courier_id: null }
    });
    const server = await startServer(createCourierApi({
        env: {
            SUPABASE_URL: 'https://database.example',
            SUPABASE_ANON_KEY: 'public-key',
            SUPABASE_SERVICE_ROLE_KEY: 'server-key'
        },
        fetch: fetchImpl
    }));
    t.after(() => new Promise(resolve => server.server.close(resolve)));

    const response = await fetch(`${server.url}/orders/${orderId}`, {
        method: 'PATCH',
        headers: { Authorization: 'Bearer session-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'accepted' })
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).order.courier_id, userId);
    const update = fetchImpl.requests.at(-1);
    assert.equal(update.init.method, 'PATCH');
    assert.equal(update.url.searchParams.get('courier_id'), 'is.null');
    assert.equal(update.url.searchParams.get('status'), 'eq.pending');
    assert.deepEqual(JSON.parse(update.init.body), { status: 'accepted', courier_id: userId });
});

test('courier status updates notify the linked customer when Telegram notifications are enabled', async t => {
    const fetchImpl = makeFetch({
        order: { id: orderId, user_id: userId, status: 'pending', payment_method: 'cash', courier_id: null },
        telegramTarget: '123456789'
    });
    const server = await startServer(createCourierApi({
        env: {
            SUPABASE_URL: 'https://database.example',
            SUPABASE_ANON_KEY: 'public-key',
            SUPABASE_SERVICE_ROLE_KEY: 'server-key',
            CLIENT_BOT_TOKEN: 'client-token'
        },
        fetch: fetchImpl
    }));
    t.after(() => new Promise(resolve => server.server.close(resolve)));

    const response = await fetch(`${server.url}/orders/${orderId}`, {
        method: 'PATCH',
        headers: { Authorization: 'Bearer courier-session', 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'accepted' })
    });
    assert.equal(response.status, 200);
    const notificationLookup = fetchImpl.requests.find(request =>
        request.url.pathname.endsWith('/rest/v1/rpc/get_telegram_notification_target')
    );
    assert.deepEqual(JSON.parse(notificationLookup.init.body), { p_user_id: userId });
    const telegramRequest = fetchImpl.requests.find(request => request.url.hostname === 'api.telegram.org');
    assert.deepEqual(JSON.parse(telegramRequest.init.body), {
        chat_id: '123456789',
        text: `Обновлён статус заказа №${orderId}: accepted.`
    });
});

test('courier can claim an online order only after payment marks it paid', async t => {
    const fetchImpl = makeFetch({
        order: { id: orderId, status: 'paid', payment_method: 'card', courier_id: null }
    });
    const server = await startServer(createCourierApi({
        env: {
            SUPABASE_URL: 'https://database.example',
            SUPABASE_ANON_KEY: 'public-key',
            SUPABASE_SERVICE_ROLE_KEY: 'server-key'
        },
        fetch: fetchImpl
    }));
    t.after(() => new Promise(resolve => server.server.close(resolve)));

    const response = await fetch(`${server.url}/orders/${orderId}`, {
        method: 'PATCH',
        headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'accepted' })
    });
    assert.equal(response.status, 200);
    const orderLookup = fetchImpl.requests.find(request =>
        request.url.pathname.endsWith('/rest/v1/orders') && request.init.method !== 'PATCH'
    );
    assert.match(orderLookup.url.searchParams.get('or'), /status\.eq\.paid/);
    const update = fetchImpl.requests.at(-1);
    assert.equal(update.url.searchParams.get('status'), 'eq.paid');
    assert.equal(update.url.searchParams.get('courier_id'), 'is.null');
});

test('courier cannot mark an online-payment order as cash-paid', async t => {
    const fetchImpl = makeFetch({
        order: { id: orderId, status: 'delivered', payment_method: 'card', courier_id: userId }
    });
    const server = await startServer(createCourierApi({
        env: {
            SUPABASE_URL: 'https://database.example',
            SUPABASE_ANON_KEY: 'public-key',
            SUPABASE_SERVICE_ROLE_KEY: 'server-key'
        },
        fetch: fetchImpl
    }));
    t.after(() => new Promise(resolve => server.server.close(resolve)));

    const response = await fetch(`${server.url}/orders/${orderId}`, {
        method: 'PATCH',
        headers: { Authorization: 'Bearer session-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'paid' })
    });
    assert.equal(response.status, 409);
    assert.equal(fetchImpl.requests.some(request => request.init.method === 'PATCH'), false);
});
