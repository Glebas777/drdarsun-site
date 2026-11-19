const assert = require('node:assert/strict');
const { createHash, webcrypto } = require('node:crypto');
const { test } = require('node:test');

async function withPasswordServices(fetchImplementation, callback) {
    const previousFetch = globalThis.fetch;
    const previousCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto, writable: true });
    globalThis.fetch = fetchImplementation;
    try {
        return await callback();
    } finally {
        globalThis.fetch = previousFetch;
        if (previousCrypto) Object.defineProperty(globalThis, 'crypto', previousCrypto);
        else delete globalThis.crypto;
    }
}

test('new passwords require 12 characters and mixed character classes', async () => {
    const { getPasswordCriteria, validateNewPassword } = await import('../js/password-policy.mjs');
    assert.equal(getPasswordCriteria('Short1!').length, false);
    assert.equal(getPasswordCriteria('longpassword123!').uppercase, false);
    assert.equal(getPasswordCriteria('StrongPass123!').symbol, true);
    await assert.rejects(validateNewPassword('Short1!'), /12 символов/);
});

test('new passwords reject values found in the breach lookup', async () => {
    const { validateNewPassword } = await import('../js/password-policy.mjs');
    const password = 'StrongPassphrase!2026';
    const hash = createHash('sha1').update(password).digest('hex').toUpperCase();
    await withPasswordServices(async url => {
        assert.ok(String(url).endsWith(hash.slice(0, 5)));
        return { ok: true, text: async () => `${hash.slice(5)}:1` };
    }, () => assert.rejects(validateNewPassword(password), /найден в утечках/));
});

test('new passwords fail closed when the breach service is unavailable', async () => {
    const { validateNewPassword } = await import('../js/password-policy.mjs');
    await withPasswordServices(async () => { throw new Error('offline'); }, () =>
        assert.rejects(validateNewPassword('StrongPassphrase!2026'), /Не удалось проверить пароль/)
    );
});