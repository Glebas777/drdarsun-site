const test = require('node:test');
const assert = require('node:assert/strict');
const { createPayment, getPayment, isYooKassaConfigured } = require('../yookassa-api');

const credentials = { YU_KASSA_SHOP_ID: '123456', YU_KASSA_SECRET: 'private-test-secret' };

test('online checkout is enabled only when both YooKassa secrets are configured', () => {
    assert.equal(isYooKassaConfigured({}), false);
    assert.equal(isYooKassaConfigured({ YU_KASSA_SHOP_ID: '123456' }), false);
    assert.equal(isYooKassaConfigured(credentials), true);
});

test('payment creation uses server credentials, idempotency, exact amount and an allowlisted return URL', async () => {
    let request;
    const payment = await createPayment({
        env: credentials,
        order: { id: 'order-42', total: 1250.5 },
        user: { id: 'user-42' },
        paymentMethod: 'sbp',
        requestId: '01234567-89ab-cdef-0123-456789abcdef',
        fetch: async (url, options) => {
            request = { url, options };
            return Response.json({
                id: 'payment-42',
                status: 'pending',
                confirmation: { confirmation_url: 'https://yookassa.ru/checkout/payments/payment-42' }
            });
        }
    });

    assert.equal(request.url, 'https://api.yookassa.ru/v3/payments');
    assert.equal(request.options.headers['Idempotence-Key'], '01234567-89ab-cdef-0123-456789abcdef');
    assert.match(request.options.headers.Authorization, /^Basic /);
    assert.equal(Buffer.from(request.options.headers.Authorization.slice(6), 'base64').toString(), '123456:private-test-secret');
    const body = JSON.parse(request.options.body);
    assert.deepEqual(body.amount, { value: '1250.50', currency: 'RUB' });
    assert.equal(body.payment_method_data.type, 'sbp');
    assert.equal(body.metadata.order_id, 'order-42');
    assert.equal(body.metadata.user_id, 'user-42');
    assert.equal(new URL(body.confirmation.return_url).origin, 'https://drdarsun.ru');
    assert.deepEqual(payment, {
        id: 'payment-42',
        status: 'pending',
        confirmationUrl: 'https://yookassa.ru/checkout/payments/payment-42',
        amount: { value: '1250.50', currency: 'RUB' }
    });
});

test('payment creation rejects provider errors and unexpected confirmation URLs', async () => {
    await assert.rejects(() => createPayment({
        env: credentials,
        order: { id: 'order-42', total: 10 },
        user: { id: 'user-42' },
        paymentMethod: 'card',
        fetch: async () => Response.json({ type: 'error' }, { status: 400 })
    }), /Не удалось создать платёж/);

    await assert.rejects(() => createPayment({
        env: credentials,
        order: { id: 'order-42', total: 10 },
        user: { id: 'user-42' },
        paymentMethod: 'card',
        fetch: async () => Response.json({
            id: 'payment-42',
            status: 'pending',
            confirmation: { confirmation_url: 'javascript:alert(1)' }
        })
    }), /ссылка не получена/);
});

test('ambiguous provider failures retain the order for idempotent retry', async () => {
    await assert.rejects(createPayment({
        env: credentials,
        order: { id: 'order-42', total: 10 },
        user: { id: 'user-42' },
        paymentMethod: 'card',
        fetch: async () => { throw new Error('network timeout'); }
    }), error => error.paymentMayExist === true);

    await assert.rejects(createPayment({
        env: credentials,
        order: { id: 'order-42', total: 10 },
        user: { id: 'user-42' },
        paymentMethod: 'card',
        fetch: async () => Response.json({ type: 'temporary_error' }, { status: 503 })
    }), error => error.paymentMayExist === true);

    await assert.rejects(createPayment({
        env: credentials,
        order: { id: 'order-42', total: 10 },
        user: { id: 'user-42' },
        paymentMethod: 'card',
        fetch: async () => Response.json({ type: 'invalid_request' }, { status: 400 })
    }), error => error.paymentMayExist === false);
});

test('payment verification fetches an authoritative provider-side object', async () => {
    let request;
    const payment = await getPayment({
        env: credentials,
        paymentId: 'payment-42',
        fetch: async (url, options) => {
            request = { url, options };
            return Response.json({ id: 'payment-42', status: 'succeeded' });
        }
    });
    assert.equal(request.url, 'https://api.yookassa.ru/v3/payments/payment-42');
    assert.equal(request.options.headers.Authorization.startsWith('Basic '), true);
    assert.deepEqual(payment, { id: 'payment-42', status: 'succeeded' });
});
