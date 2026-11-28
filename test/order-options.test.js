const test = require('node:test');
const assert = require('node:assert/strict');
const getOrderOptions = require('../order-options');

test('checkout remains closed by default', () => {
    assert.deepEqual(getOrderOptions({}), { cash: false, card: false, sbp: false });
});

test('the single CASH_ORDERS_ENABLED flag opens only cash-on-delivery', () => {
    assert.deepEqual(getOrderOptions({ CASH_ORDERS_ENABLED: 'true' }), {
        cash: true,
        card: false,
        sbp: false
    });
});

test('online methods open only after both YooKassa secrets are configured', () => {
    assert.deepEqual(getOrderOptions({
        CASH_ORDERS_ENABLED: 'true',
        YU_KASSA_SHOP_ID: '123456',
        YU_KASSA_SECRET: 'server-only-secret'
    }), { cash: true, card: true, sbp: true });

    assert.deepEqual(getOrderOptions({
        ORDER_INTAKE_ENABLED: 'true',
        YU_KASSA_SHOP_ID: '123456'
    }), { cash: false, card: false, sbp: false });
});
