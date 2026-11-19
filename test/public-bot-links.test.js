const assert = require('node:assert/strict');
const { test } = require('node:test');

function filterPublicBots(bots) {
    return (Array.isArray(bots) ? bots : []).filter(bot =>
        ['client', 'support', 'auth'].includes(bot?.role) &&
        typeof bot.username === 'string' &&
        /^https:\/\/t\.me\/[A-Za-z0-9_]+$/.test(bot.url)
    );
}

test('public site lists only customer, code and support bots', () => {
    const result = filterPublicBots([
        { role: 'client', label: 'Клиентский бот', username: 'client_bot', url: 'https://t.me/client_bot' },
        { role: 'auth', label: 'Бот привязки', username: 'code_bot', url: 'https://t.me/code_bot' },
        { role: 'support', label: 'Бот-помощник', username: 'support_bot', url: 'https://t.me/support_bot' },
        { role: 'admin', label: 'Админ', username: 'admin_bot', url: 'https://t.me/admin_bot' },
        { role: 'panel', label: 'Панель', username: 'panel_bot', url: 'https://t.me/panel_bot' }
    ]);
    assert.deepEqual(result.map(bot => bot.role), ['client', 'auth', 'support']);
});

test('public bot filter rejects malformed Telegram URLs', () => {
    const result = filterPublicBots([
        { role: 'client', username: 'client_bot', url: 'javascript:alert(1)' },
        { role: 'support', username: 'support_bot', url: 'http://t.me/support_bot' }
    ]);
    assert.equal(result.length, 0);
});
