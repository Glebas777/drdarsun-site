const assert = require('node:assert/strict');
const { test } = require('node:test');
const { processTelegramUpdate } = require('../telegram-bots');

async function mockFetch(url, init = {}) {
    const parsed = new URL(url);
    if (parsed.hostname === 'api.telegram.org') {
        return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }) };
    }
    if (parsed.pathname === '/api/telegram/panel/orders') {
        return { ok: true, status: 200, json: async () => ({ orders: [], status: '', offset: 0, hasMore: false }) };
    }
    throw new Error(`Unexpected API call: ${parsed.pathname}`);
}

function message(chatId) {
    return {
        update_id: 1,
        message: {
            message_id: 1,
            text: '📦 Заказы',
            chat: { id: chatId, type: 'private' },
            from: { id: chatId }
        }
    };
}

test('panel bot accepts both owner and legacy panel chat IDs', async () => {
    const env = {
        PANEL_BOT_TOKEN: 'panel-test-token',
        M_CHAT_ID: '647428798',
        PANEL_CHAT_ID: '8329766596',
        BOT_API_BASE_URL: 'https://api.example.test'
    };

    await assert.doesNotReject(() => processTelegramUpdate('panel', message(8329766596), { env, fetch: mockFetch }));
    await assert.doesNotReject(() => processTelegramUpdate('panel', message(647428798), { env, fetch: mockFetch }));
});

test('panel bot rejects a non-listed chat ID', async () => {
    let forwarded = false;
    const env = {
        PANEL_BOT_TOKEN: 'panel-test-token',
        M_CHAT_ID: '647428798',
        PANEL_CHAT_ID: '8329766596',
        BOT_API_BASE_URL: 'https://api.example.test'
    };
    const fetchWithTracking = async (url, init = {}) => {
        forwarded = true;
        return mockFetch(url, init);
    };

    await processTelegramUpdate('panel', message(123456789), { env, fetch: fetchWithTracking });
    assert.equal(forwarded, false);
});
