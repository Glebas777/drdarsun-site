const test = require('node:test');
const assert = require('node:assert/strict');
const getAllowedSiteOrigins = require('../site-origin-policy');

test('assistant origin policy shares default site origins and configured CORS origins', () => {
    const origins = getAllowedSiteOrigins({
        CORS_ALLOWED_ORIGINS: 'https://shop.example, https://preview.example '
    });

    assert.equal(origins.has('https://drdarsun.ru'), true);
    assert.equal(origins.has('https://www.drdarsun.ru'), true);
    assert.equal(origins.has('https://drdarsun-site-main.layero.app'), true);
    assert.equal(origins.has('https://shop.example'), true);
    assert.equal(origins.has('https://preview.example'), true);
    assert.equal(origins.has('https://unknown.example'), false);
});
