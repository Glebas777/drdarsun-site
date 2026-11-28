function createTelegramNotificationSender(options = {}) {
    const env = options.env || process.env;
    const request = options.fetch || fetch;

    return async function sendTelegramNotification(userId, message) {
        if (typeof userId !== 'string' ||
            !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(userId)) {
            throw new Error('Telegram notification user ID is invalid.');
        }
        if (typeof message !== 'string' || !message.trim() || message.length > 3800) {
            throw new Error('Telegram notification message is invalid.');
        }

        const supabaseUrl = env.SUPABASE_URL?.replace(/\/$/, '');
        const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
        if (!supabaseUrl || !serviceRoleKey) {
            throw new Error('Telegram notification database configuration is missing.');
        }

        const targetResponse = await request(`${supabaseUrl}/rest/v1/rpc/get_telegram_notification_target`, {
            method: 'POST',
            headers: {
                apikey: serviceRoleKey,
                Authorization: `Bearer ${serviceRoleKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ p_user_id: userId }),
            signal: AbortSignal.timeout(8000)
        });
        const target = await targetResponse.json().catch(() => null);
        if (!targetResponse.ok) {
            console.error('Telegram notification target lookup failed:', targetResponse.status);
            throw new Error('Telegram notification target lookup failed.');
        }
        if (typeof target !== 'string' || !/^[0-9]{1,19}$/.test(target)) return false;

        const token = env.CLIENT_BOT_TOKEN;
        if (typeof token !== 'string' || !token.trim()) {
            throw new Error('Telegram client bot is not configured for notifications.');
        }

        const telegramResponse = await request(`https://api.telegram.org/bot${token.trim()}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: target,
                text: message.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
            }),
            signal: AbortSignal.timeout(8000)
        });
        const telegramResult = await telegramResponse.json().catch(() => null);
        if (!telegramResponse.ok || telegramResult?.ok !== true) {
            console.error('Telegram notification delivery failed:', telegramResponse.status);
            throw new Error('Telegram notification delivery failed.');
        }
        return true;
    };
}

module.exports = createTelegramNotificationSender;
