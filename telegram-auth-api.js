const express = require('express');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const GENERIC_REQUEST_MESSAGE = 'Если этот username привязан к аккаунту, код отправлен в Telegram.';

function createTelegramAuthRouter(options = {}) {
    const router = express.Router();
    const env = options.env || process.env;
    const request = options.fetch || fetch;
    const supabaseUrl = env.SUPABASE_URL?.replace(/\/$/, '');
    const anonKey = env.SUPABASE_ANON_KEY;
    const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
    const accountCooldowns = new Map();

    async function databaseRequest(path) {
        if (!supabaseUrl || !serviceRoleKey) throw new Error('Telegram authentication is not configured.');
        const response = await request(`${supabaseUrl}/rest/v1/${path}`, {
            headers: {
                apikey: serviceRoleKey,
                Authorization: `Bearer ${serviceRoleKey}`
            },
            signal: AbortSignal.timeout(10000)
        });
        const result = await response.json().catch(() => null);
        if (!response.ok) {
            console.error('Telegram authentication database lookup failed:', response.status);
            throw new Error('Telegram authentication database lookup failed.');
        }
        return result;
    }

    async function findAccount(username) {
        const query = new URLSearchParams({
            select: 'user_id,telegram_chat_id,telegram_username',
            telegram_username: `ilike.${username.replaceAll('_', '\\_')}`,
            limit: '2'
        });
        const accounts = await databaseRequest(`telegram_accounts?${query}`);
        return Array.isArray(accounts) && accounts.length === 1 ? accounts[0] : null;
    }

    async function getUserEmail(userId) {
        const response = await request(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
            headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
            signal: AbortSignal.timeout(10000)
        });
        const result = await response.json().catch(() => null);
        if (!response.ok || (typeof result?.user?.email !== 'string' && typeof result?.email !== 'string')) {
            console.error('Telegram authentication account lookup failed:', response.status);
            throw new Error('Telegram authentication account lookup failed.');
        }
        return result.user?.email || result.email;
    }

    async function sendCode(chatId, code) {
        const tokens = [...new Set([env.CODE_BOT_TOKEN, env.CLIENT_BOT_TOKEN].filter(Boolean))];
        for (const token of tokens) {
            try {
                const response = await request(`https://api.telegram.org/bot${token}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: chatId,
                        text: `Код Dr. DarSun: ${code}\n\nНикому не пересылайте его. Если вы не запрашивали код, просто проигнорируйте сообщение.`
                    }),
                    signal: AbortSignal.timeout(10000)
                });
                const result = await response.json().catch(() => null);
                if (response.ok && result?.ok) return true;
                console.warn('Telegram authentication code delivery failed:', response.status);
            } catch (error) {
                console.warn('Telegram authentication code delivery failed:', error.name || 'RequestError');
            }
        }
        return false;
    }

    router.post('/request', async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        const username = typeof req.body?.username === 'string'
            ? req.body.username.trim().replace(/^@/, '').toLowerCase()
            : '';
        const mode = req.body?.mode;
        if (!/^[a-z0-9_]{5,32}$/.test(username) || !['login', 'recovery'].includes(mode)) {
            return res.status(400).json({ error: 'Введите корректный Telegram username.' });
        }
        if (!supabaseUrl || !anonKey || !serviceRoleKey) {
            console.error('Telegram authentication is unavailable: Supabase configuration is incomplete.');
            return res.status(503).json({ error: 'Вход через Telegram временно недоступен.' });
        }

        let cooldownUserId;
        try {
            const account = await findAccount(username);
            if (account) {
                const lastRequested = accountCooldowns.get(account.user_id) || 0;
                if (Date.now() - lastRequested >= 60_000) {
                    if (accountCooldowns.size > 5000) {
                        for (const [userId, requestedAt] of accountCooldowns) {
                            if (Date.now() - requestedAt >= 60_000) accountCooldowns.delete(userId);
                        }
                    }
                    accountCooldowns.set(account.user_id, Date.now());
                    cooldownUserId = account.user_id;
                    const email = await getUserEmail(account.user_id);
                    const linkResponse = await request(`${supabaseUrl}/auth/v1/admin/generate_link`, {
                        method: 'POST',
                        headers: {
                            apikey: serviceRoleKey,
                            Authorization: `Bearer ${serviceRoleKey}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            type: mode === 'recovery' ? 'recovery' : 'magiclink',
                            email
                        }),
                        signal: AbortSignal.timeout(10000)
                    });
                    const link = await linkResponse.json().catch(() => null);
                    if (!linkResponse.ok || typeof link?.email_otp !== 'string') {
                        accountCooldowns.delete(account.user_id);
                        console.error('Supabase Telegram OTP creation failed:', linkResponse.status, link?.code || 'Unknown error');
                        throw new Error('Could not create Telegram OTP.');
                    }
                    const delivered = await sendCode(account.telegram_chat_id, link.email_otp);
                    if (!delivered) {
                        accountCooldowns.delete(account.user_id);
                        console.warn('Telegram authentication code could not be delivered by configured bots.');
                    }
                }
            }
            return res.status(202).json({ message: GENERIC_REQUEST_MESSAGE });
        } catch (error) {
            if (cooldownUserId) accountCooldowns.delete(cooldownUserId);
            console.error('Telegram authentication request failed:', error);
            return res.status(503).json({ error: 'Не удалось отправить код. Попробуйте позже.' });
        }
    });

    router.post('/verify', async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        const username = typeof req.body?.username === 'string'
            ? req.body.username.trim().replace(/^@/, '').toLowerCase()
            : '';
        const mode = req.body?.mode;
        const token = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
        if (!/^[a-z0-9_]{5,32}$/.test(username) || !['login', 'recovery'].includes(mode) || !/^\d{6}$/.test(token)) {
            return res.status(400).json({ error: 'Проверьте username и шестизначный код.' });
        }
        if (!supabaseUrl || !anonKey || !serviceRoleKey) {
            console.error('Telegram authentication is unavailable: Supabase configuration is incomplete.');
            return res.status(503).json({ error: 'Вход через Telegram временно недоступен.' });
        }

        try {
            const account = await findAccount(username);
            if (!account) return res.status(400).json({ error: 'Код неверный или устарел.' });
            const email = await getUserEmail(account.user_id);
            const response = await request(`${supabaseUrl}/auth/v1/verify`, {
                method: 'POST',
                headers: {
                    apikey: anonKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    email,
                    token,
                    type: mode === 'recovery' ? 'recovery' : 'magiclink'
                }),
                signal: AbortSignal.timeout(10000)
            });
            const session = await response.json().catch(() => null);
            if (!response.ok || typeof session?.access_token !== 'string' || typeof session?.refresh_token !== 'string') {
                return res.status(400).json({ error: 'Код неверный или устарел.' });
            }
            accountCooldowns.delete(account.user_id);
            return res.json({
                session: {
                    access_token: session.access_token,
                    refresh_token: session.refresh_token
                }
            });
        } catch (error) {
            console.error('Telegram authentication verification failed:', error);
            return res.status(503).json({ error: 'Не удалось проверить код. Попробуйте позже.' });
        }
    });

    return router;
}

module.exports = createTelegramAuthRouter;
