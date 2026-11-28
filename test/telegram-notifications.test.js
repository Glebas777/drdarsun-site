const test = require('node:test');
const assert = require('node:assert/strict');
const createTelegramNotificationSender = require('../telegram-notifications');

const userId = '00000000-0000-4000-8000-000000000001';

test('Telegram notifications are sent only to a linked chat with notifications enabled', async () => {
    const calls = [];
    const sender = createTelegramNotificationSender({
        env: {
            SUPABASE_URL: 'https://supabase.example',
            SUPABASE_SERVICE_ROLE_KEY: 'service-key',
            CLIENT_BOT_TOKEN: 'client-token'
        },
        fetch: async (url, init = {}) => {
            calls.push({ url: String(url), init });
            if (String(url).endsWith('/rpc/get_telegram_notification_target')) {
                assert.deepEqual(JSON.parse(init.body), { p_user_id: userId });
                return Response.json('123456789');
            }
            if (String(url).endsWith('/sendMessage')) {
                return Response.json({ ok: true, result: { message_id: 7 } });
            }
            throw new Error(`Unexpected request: ${url}`);
        }
    });

    assert.equal(await sender(userId, 'Заказ создан.'), true);
    assert.equal(calls.length, 2);
    assert.deepEqual(JSON.parse(calls[1].init.body), {
        chat_id: '123456789',
        text: 'Заказ создан.'
    });
});

test('Telegram notifications are skipped when the account is not opted in or linked', async () => {
    const calls = [];
    const sender = createTelegramNotificationSender({
        env: {
            SUPABASE_URL: 'https://supabase.example',
            SUPABASE_SERVICE_ROLE_KEY: 'service-key',
            CLIENT_BOT_TOKEN: 'client-token'
        },
        fetch: async (url, init = {}) => {
            calls.push({ url: String(url), init });
            return Response.json(null);
        }
    });

    assert.equal(await sender(userId, 'Не отправлять.'), false);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.endsWith('/rpc/get_telegram_notification_target'));
});

test('Telegram notification sender rejects invalid IDs and reports database errors', async () => {
    const sender = createTelegramNotificationSender({
        env: {
            SUPABASE_URL: 'https://supabase.example',
            SUPABASE_SERVICE_ROLE_KEY: 'service-key',
            CLIENT_BOT_TOKEN: 'client-token'
        },
        fetch: async () => Response.json({ message: 'database unavailable' }, { status: 503 })
    });

    await assert.rejects(sender('not-a-uuid', 'message'), /user ID is invalid/);
    await assert.rejects(sender(userId, 'message'), /target lookup failed/);
});
