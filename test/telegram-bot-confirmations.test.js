const assert = require('node:assert/strict');
const { test } = require('node:test');
const { processTelegramUpdate } = require('../telegram-bots');

const reviewId = 'c0ffee00-0000-4000-8000-000000000001';
const ticketId = 'c0ffee00-0000-4000-8000-000000000002';
const telegramCalls = [];
const backendCalls = [];

async function mockFetch(url, init = {}) {
    const parsed = new URL(url);
    if (parsed.hostname === 'api.telegram.org') {
        telegramCalls.push({ method: parsed.pathname.split('/').at(-1), body: JSON.parse(init.body || '{}') });
        return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 321 } }) };
    }
    backendCalls.push({ path: parsed.pathname, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
    if (parsed.pathname === '/api/telegram/support/my-ticket') {
        return { ok: true, status: 200, json: async () => ({ ticket: { id: ticketId, ticket_number: 27 }, messages: [] }) };
    }
    if (parsed.pathname === '/api/telegram/panel/orders' && !init.method) {
        return { ok: true, status: 200, json: async () => ({ orders: [{ id: 'order-123', items: [], total: 0, status: 'pending', created_at: '2026-11-18T12:00:00Z' }], hasMore: false }) };
    }
    return { ok: true, status: 200, json: async () => ({ success: true }) };
}

function callback(data, chatId, messageId) {
    return {
        update_id: messageId,
        callback_query: {
            id: `callback-${messageId}`,
            data,
            from: { id: chatId, is_bot: false },
            message: { message_id: messageId, chat: { id: chatId, type: 'private' } }
        }
    };
}

test('admin review moderation requires a second confirmation callback', async () => {
    telegramCalls.length = 0;
    backendCalls.length = 0;
    const env = { ADMIN_BOT_TOKEN: 'admin-test-token', MY_CHAT_ID: '123456789', BOT_API_BASE_URL: 'https://api.example.test' };

    await processTelegramUpdate('admin', callback(`adm:ra:${reviewId}`, 123456789, 11), { env, fetch: mockFetch });
    assert.equal(backendCalls.length, 0);
    assert.ok(telegramCalls.some(call => call.method === 'sendMessage' && call.body.text.includes('Опубликовать этот отзыв?')));

    await processTelegramUpdate('admin', callback('adm:review:confirm', 123456789, 12), { env, fetch: mockFetch });
    assert.equal(backendCalls.length, 1);
    assert.equal(backendCalls[0].method, 'PATCH');
    assert.equal(backendCalls[0].body.status, 'approved');
});

test('panel order status requires a second confirmation callback', async () => {
    telegramCalls.length = 0;
    backendCalls.length = 0;
    const env = { PANEL_BOT_TOKEN: 'panel-test-token', PANEL_CHAT_ID: '987654321', BOT_API_BASE_URL: 'https://api.example.test' };

    await processTelegramUpdate('panel', {
        update_id: 20,
        message: { message_id: 20, text: '📦 Заказы', from: { id: 987654321 }, chat: { id: 987654321, type: 'private' } }
    }, { env, fetch: mockFetch });
    backendCalls.length = 0;
    await processTelegramUpdate('panel', callback('p:o:0:shipped', 987654321, 21), { env, fetch: mockFetch });
    assert.equal(backendCalls.length, 0);
    assert.ok(telegramCalls.some(call => call.method === 'sendMessage' && call.body.text.includes('Подтвердите новый статус заказа')));

    await processTelegramUpdate('panel', callback('p:status:confirm', 987654321, 22), { env, fetch: mockFetch });
    assert.equal(backendCalls.length, 1);
    assert.equal(backendCalls[0].method, 'PATCH');
    assert.equal(backendCalls[0].body.status, 'shipped');
});

test('support ticket closure rechecks the active ticket after a confirmation step', async () => {
    telegramCalls.length = 0;
    backendCalls.length = 0;
    const env = { HELP_BOT_TOKEN: 'support-test-token', BOT_API_BASE_URL: 'https://api.example.test' };

    await processTelegramUpdate('support', callback('s:close', 555123, 31), { env, fetch: mockFetch });
    assert.equal(backendCalls.filter(call => call.method === 'POST').length, 0);
    assert.ok(telegramCalls.some(call => call.method === 'sendMessage' && call.body.text.includes('Закрыть обращение №27?')));

    await processTelegramUpdate('support', callback('s:close:confirm', 555123, 32), { env, fetch: mockFetch });
    const closeCalls = backendCalls.filter(call => call.path.endsWith(`/support/tickets/${ticketId}/close`) && call.method === 'POST');
    assert.equal(closeCalls.length, 1);
});

test('admin can choose either maintenance mode and the selected mode reaches the API', async () => {
    telegramCalls.length = 0;
    backendCalls.length = 0;
    const chatId = 111222333;
    const env = {
        ADMIN_BOT_TOKEN: 'admin-test-token',
        MY_CHAT_ID: String(chatId),
        BOT_API_BASE_URL: 'https://api.example.test',
        SITE_MAINTENANCE_PASSWORD: 'test-maintenance-password'
    };

    await processTelegramUpdate('admin', callback('adm:maintenance', chatId, 41), { env, fetch: mockFetch });
    const menuMessage = telegramCalls.find(call =>
        call.method === 'sendMessage' && call.body.text.includes('Состояние сайта:')
    );
    const maintenanceOptions = menuMessage.body.reply_markup.inline_keyboard.flat()
        .map(button => button.callback_data);
    assert.ok(maintenanceOptions.includes('adm:maint:planned'));
    assert.ok(maintenanceOptions.includes('adm:maint:emergency'));
    assert.ok(maintenanceOptions.includes('adm:maint:off'));

    await processTelegramUpdate('admin', callback('adm:maint:emergency', chatId, 42), { env, fetch: mockFetch });
    assert.equal(require('../telegram-bots').getBotState('admin', String(chatId)).mode, 'emergency');

    await processTelegramUpdate('admin', {
        update_id: 43,
        message: {
            message_id: 43,
            text: env.SITE_MAINTENANCE_PASSWORD,
            from: { id: chatId },
            chat: { id: chatId, type: 'private' }
        }
    }, { env, fetch: mockFetch });

    const updateRequest = backendCalls.find(call =>
        call.path === '/api/telegram/admin/maintenance' && call.method === 'POST'
    );
    assert.equal(updateRequest.body.enabled, true);
    assert.equal(updateRequest.body.mode, 'emergency');
    assert.equal(require('../telegram-bots').getBotState('admin', String(chatId)).flow, undefined);
});

test('messages from one Telegram chat are processed serially', async () => {
    const chatId = 777000111;
    let activeTelegramRequests = 0;
    let maximumConcurrentRequests = 0;
    const sentMessages = [];
    const env = {
        CLIENT_BOT_TOKEN: 'client-test-token',
        BOT_API_BASE_URL: 'https://api.example.test'
    };
    const delayedFetch = async (url, init = {}) => {
        const parsed = new URL(url);
        if (parsed.hostname === 'api.telegram.org') {
            activeTelegramRequests += 1;
            maximumConcurrentRequests = Math.max(maximumConcurrentRequests, activeTelegramRequests);
            sentMessages.push(JSON.parse(init.body).text);
            await new Promise(resolve => setTimeout(resolve, 30));
            activeTelegramRequests -= 1;
            return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }) };
        }
        return { ok: true, status: 200, json: async () => ({ success: true }) };
    };
    const update = (updateId, text) => ({
        update_id: updateId,
        message: {
            message_id: updateId,
            text,
            from: { id: chatId },
            chat: { id: chatId, type: 'private' }
        }
    });

    await Promise.all([
        processTelegramUpdate('client', update(51, '/start'), { env, fetch: delayedFetch }),
        processTelegramUpdate('client', update(52, '/start'), { env, fetch: delayedFetch })
    ]);

    assert.equal(maximumConcurrentRequests, 1);
    assert.equal(sentMessages.length, 2);
});
