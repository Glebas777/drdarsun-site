const express = require('express');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const rateLimit = require('express-rate-limit');
const createTelegramNotificationSender = require('./telegram-notifications');
const {
    OIL_TYPES,
    PACKAGING_TYPES,
    PRESSING_TYPES,
    SHELF_LIFE_MONTHS,
    VOLUME_OPTIONS
} = require('./oil-product-options');

const BOT_TOKEN_ENV = {
    admin: 'ADMIN_BOT_TOKEN',
    support: 'HELP_BOT_TOKEN',
    client: 'CLIENT_BOT_TOKEN'
};
const SUPPORT_TELEGRAM_USERNAME = 'darsunhelp';
const telegramLoginRequestLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 8,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Слишком много попыток. Попробуйте позже.' }
});
const telegramLinkRequestLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 8,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Слишком много попыток. Попробуйте позже.' }
});
const telegramLoginVerifyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 12,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Слишком много попыток. Попробуйте позже.' }
});
const SUPPORT_TOPICS = ['Заказ', 'Доставка', 'Оплата', 'Товар', 'Аккаунт', 'Другое'];
const ORDER_STATUSES = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];
const NON_OIL_PRODUCT_CATEGORIES = {
    urbech: 'Урбеч',
    hummus: 'Хумус',
    milk: 'Растительное молоко'
};

function safeEqual(left, right) {
    const leftHash = crypto.createHash('sha256').update(left).digest();
    const rightHash = crypto.createHash('sha256').update(right).digest();
    return crypto.timingSafeEqual(leftHash, rightHash);
}

function isValidChatId(value) {
    if (!/^-?\d{1,19}$/.test(value || '')) return false;
    const chatId = BigInt(value);
    return chatId >= -9223372036854775808n && chatId <= 9223372036854775807n;
}

function isUuid(value) {
    return typeof value === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
}

function safeMessageText(value, maxLength) {
    return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, maxLength);
}

function createTelegramIntegrationRouter(options = {}) {
    const router = express.Router();
    const env = options.env || process.env;
    const request = options.fetch || fetch;
    const onMaintenanceChanged = options.onMaintenanceChanged;
    const createTransport = options.createTransport || nodemailer.createTransport;
    const supabaseUrl = env.SUPABASE_URL?.replace(/\/$/, '');
    const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
    const anonKey = env.SUPABASE_ANON_KEY;
    const sendTelegramNotification = createTelegramNotificationSender({ env, fetch: request });

    async function databaseRequest(path, init = {}) {
        if (!supabaseUrl || !serviceRoleKey) {
            throw new Error('Telegram integration database configuration is missing.');
        }

        const response = await request(`${supabaseUrl}/rest/v1/${path}`, {
            ...init,
            signal: init.signal || AbortSignal.timeout(10000),
            headers: {
                'apikey': serviceRoleKey,
                'Authorization': `Bearer ${serviceRoleKey}`,
                'Content-Type': 'application/json',
                ...(init.headers || {})
            }
        });
        const result = await response.json().catch(() => null);
        if (!response.ok) {
            console.error('Telegram integration database request failed:', response.status, result?.message || result?.code || 'Unknown error');
            throw new Error('Telegram integration database request failed.');
        }
        return result;
    }

    async function writeTelegramAudit(req, action, entityType, entityId, details = {}) {
        const chatId = req.get('X-Telegram-Chat-Id') || '';
        try {
            await databaseRequest('telegram_admin_audit', {
                method: 'POST',
                headers: { Prefer: 'return=minimal' },
                body: JSON.stringify({
                    actor_role: req.telegramBotRole,
                    actor_chat_id: chatId,
                    action,
                    entity_type: entityType,
                    entity_id: String(entityId).slice(0, 120),
                    details
                })
            });
        } catch (error) {
            console.warn('Telegram admin audit write failed:', error.message);
        }
    }

    function authenticateBot(req, res, next) {
        const match = /^Bearer ([^\s]+)$/.exec(req.get('Authorization') || '');
        if (!match) return res.status(401).json({ error: 'Требуется токен Telegram-бота.' });

        const matchingRoles = Object.entries(BOT_TOKEN_ENV).filter(([, variable]) => {
            const configuredToken = env[variable];
            return typeof configuredToken === 'string' && configuredToken.length > 0 &&
                safeEqual(match[1], configuredToken);
        }).map(([role]) => role);
        if (matchingRoles.length !== 1) return res.status(401).json({ error: 'Недействительный токен Telegram-бота.' });

        req.telegramBotRole = matchingRoles[0];
        next();
    }

    function allowRoles(...roles) {
        return (req, res, next) => {
            if (!roles.includes(req.telegramBotRole)) {
                return res.status(403).json({ error: 'У этого бота нет доступа к операции.' });
            }
            next();
        };
    }

    function requireOwnerChat(req, res, next) {
        const ownerChatId = String(env.MY_CHAT_ID || env.PANEL_CHAT_ID || env.M_CHAT_ID || '').trim();
        const suppliedChatId = req.get('X-Telegram-Chat-Id') || '';

        if (!ownerChatId || !isValidChatId(suppliedChatId) || suppliedChatId !== ownerChatId) {
            return res.status(403).json({ error: 'Этот Telegram-аккаунт не имеет доступа.' });
        }
        next();
    }

    async function getAdminUsersByEmail(emailQuery) {
        if (!supabaseUrl || !serviceRoleKey) throw new Error('Email delivery is not configured.');
        const users = [];
        for (let page = 1; page <= 100; page++) {
            const query = new URLSearchParams({
                page: String(page),
                per_page: '100',
                ...(emailQuery ? { filter: emailQuery } : {})
            });
            const response = await request(`${supabaseUrl}/auth/v1/admin/users?${query}`, {
                headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
                signal: AbortSignal.timeout(10000)
            });
            const result = await response.json().catch(() => null);
            if (!response.ok || !Array.isArray(result?.users)) {
                console.error('Admin email recipient lookup failed:', response.status);
                throw new Error('Не удалось получить список аккаунтов.');
            }
            users.push(...result.users);
            if (result.users.length < 100) return users;
        }
        if (emailQuery) return users;
        throw new Error('Превышен лимит получателей для одной рассылки. Разделите аудиторию.');
    }

    router.post('/admin/toasts/send', authenticateBot, allowRoles('admin'), requireOwnerChat, withErrors('Telegram admin toast send failed', async (req, res) => {
        const target = typeof req.body?.target === 'string' ? req.body.target.trim().toLowerCase() : '';
        const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
        const kind = req.body?.kind;
        const durationSeconds = Number(req.body?.durationSeconds);
        if (!message || message.length > 500) {
            return res.status(400).json({ error: 'Текст уведомления должен содержать от 1 до 500 символов.' });
        }
        if (!/^(all|[^\s@]+@[^\s@]+\.[^\s@]+)$/.test(target)) {
            return res.status(400).json({ error: 'Укажите точный email аккаунта или all.' });
        }
        if (!['info', 'success', 'warning', 'error'].includes(kind)) {
            return res.status(400).json({ error: 'Выберите стиль уведомления.' });
        }
        if (!Number.isInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > 3600) {
            return res.status(400).json({ error: 'Срок показа должен быть от 1 до 3600 секунд.' });
        }

        const expiresAt = new Date(Date.now() + durationSeconds * 1000).toISOString();
        if (target === 'all') {
            await databaseRequest(`site_public_toasts?expires_at=lt.${encodeURIComponent(new Date().toISOString())}`, {
                method: 'DELETE',
                headers: { Prefer: 'return=minimal' }
            });
            await databaseRequest('site_public_toasts', {
                method: 'POST',
                headers: { Prefer: 'return=minimal' },
                body: JSON.stringify({ message, kind, expires_at: expiresAt })
            });
            await writeTelegramAudit(req, 'toast.broadcast', 'toast', 'public', {
                kind,
                durationSeconds,
                audience: 'all-visitors'
            });
            return res.json({ sent: 1, durationSeconds, broadcast: true });
        }

        const users = await getAdminUsersByEmail(target);
        const recipients = users.filter(user => user.email?.toLowerCase() === target);
        if (recipients.length !== 1) {
            return res.status(404).json({ error: 'Аккаунт с таким email не найден.' });
        }
        const userIds = [...new Set(recipients.map(user => user.id).filter(isUuid))];
        if (!userIds.length) return res.json({ sent: 0, durationSeconds });

        let sent = 0;
        for (let offset = 0; offset < userIds.length; offset += 500) {
            const batch = userIds.slice(offset, offset + 500);
            await databaseRequest('site_toast_notifications', {
                method: 'POST',
                headers: { Prefer: 'return=minimal' },
                body: JSON.stringify(batch.map(user_id => ({
                    user_id,
                    message,
                    kind,
                    expires_at: expiresAt
                })))
            });
            sent += batch.length;
        }
        await Promise.all(userIds.map(userId => notifyTelegramUser(
            userId,
            `Уведомление Dr. DarSun:\n${message}`,
            'Personal toast'
        )));
        await writeTelegramAudit(req, 'toast.sent', 'toast', target, {
            kind,
            durationSeconds,
            audience: target,
            recipientCount: sent
        });
        res.json({ sent, durationSeconds });
    }));

    router.get('/admin/toasts', authenticateBot, allowRoles('admin'), requireOwnerChat, withErrors('Telegram admin toast lookup failed', async (_req, res) => {
        const [publicToasts, personalToasts] = await Promise.all([
            databaseRequest('site_public_toasts?select=id,message,kind,expires_at,created_at&order=created_at.desc&limit=10'),
            databaseRequest('site_toast_notifications?select=id,user_id,message,kind,expires_at,created_at&dismissed_at=is.null&order=created_at.desc&limit=10')
        ]);
        res.setHeader('Cache-Control', 'no-store');
        res.json({
            publicToasts: Array.isArray(publicToasts) ? publicToasts : [],
            personalToasts: Array.isArray(personalToasts) ? personalToasts : []
        });
    }));

    router.delete('/admin/toasts/:scope/:id', authenticateBot, allowRoles('admin'), requireOwnerChat, withErrors('Telegram admin toast deletion failed', async (req, res) => {
        const { scope } = req.params;
        const toastId = req.params.id;
        if (!['public', 'personal'].includes(scope) || !isUuid(toastId)) {
            return res.status(400).json({ error: 'Некорректное уведомление.' });
        }

        const table = scope === 'public' ? 'site_public_toasts' : 'site_toast_notifications';
        const deleted = await databaseRequest(
            `${table}?id=eq.${encodeURIComponent(toastId)}${scope === 'personal' ? '&dismissed_at=is.null' : ''}&select=id,message`,
            {
                method: scope === 'personal' ? 'PATCH' : 'DELETE',
                headers: { Prefer: 'return=representation' },
                ...(scope === 'personal' ? { body: JSON.stringify({ dismissed_at: new Date().toISOString() }) } : {})
            }
        );
        const [notification] = Array.isArray(deleted) ? deleted : [];
        if (!notification) return res.status(404).json({ error: 'Уведомление не найдено.' });

        await writeTelegramAudit(req, 'toast.deleted', `toast.${scope}`, toastId, {
            message: String(notification.message || '').slice(0, 120)
        });
        res.json({ deleted: true, scope, id: toastId });
    }));

    router.post('/admin/email/send', authenticateBot, allowRoles('admin'), requireOwnerChat, (req, res) => {
        return res.status(410).json({ error: 'Email-рассылка отключена. Используйте уведомления-тосты.' });
    });

    router.use('/admin/email', authenticateBot, allowRoles('admin'), requireOwnerChat, (req, res, next) => {
        if (req.path.startsWith('/send')) {
            return res.status(410).json({ error: 'Email-рассылка отключена. Используйте уведомления-тосты.' });
        }
        next();
    });

    router.post('/admin/email/send-legacy', authenticateBot, allowRoles('admin'), requireOwnerChat, (req, res) => {
        return res.status(410).json({ error: 'Email-рассылка отключена. Используйте уведомления-тосты.' });
    });

    router.post('/admin/email/send-legacy-disabled', authenticateBot, allowRoles('admin'), requireOwnerChat, withErrors('Telegram admin email send failed', async (req, res) => {
        const target = typeof req.body?.target === 'string' ? req.body.target.trim().toLowerCase() : '';
        const subject = typeof req.body?.subject === 'string' ? req.body.subject.trim() : '';
        const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
        if (!subject || subject.length > 150 || !text || text.length > 4000) {
            return res.status(400).json({ error: 'Тема — до 150, текст — от 1 до 4000 символов.' });
        }
        if (!/^(all|[^\s@]+@[^\s@]+\.[^\s@]+)$/.test(target)) {
            return res.status(400).json({ error: 'Укажите точный email аккаунта или all.' });
        }
        if (!env.MAIL_SEND_USER || !env.MAIL_SEND_PASS) {
            return res.status(503).json({ error: 'Почта не настроена: задайте MAIL_SEND_USER и MAIL_SEND_PASS.' });
        }

        const transport = createTransport({
            host: 'smtp.yandex.ru',
            port: 465,
            secure: true,
            auth: { user: env.MAIL_SEND_USER, pass: env.MAIL_SEND_PASS },
            connectionTimeout: 10000,
            greetingTimeout: 10000,
            socketTimeout: 20000
        });
        let recipients;
        if (target === 'all') {
            const subscribedIds = new Set();
            for (let offset = 0; ; offset += 1000) {
                const subscribed = await databaseRequest(`notification_settings?select=user_id&email_enabled=eq.true&limit=1000&offset=${offset}`);
                for (const record of subscribed || []) subscribedIds.add(record.user_id);
                if (!subscribed || subscribed.length < 1000) break;
            }
            const users = await getAdminUsersByEmail('');
            recipients = users
                .filter(user => subscribedIds.has(user.id) && user.email && user.email_confirmed_at)
                .map(user => user.email);
        } else {
            const users = await getAdminUsersByEmail(target);
            const matches = users.filter(user => user.email?.toLowerCase() === target && user.email_confirmed_at);
            if (matches.length !== 1) return res.status(404).json({ error: 'Подтверждённый аккаунт с таким email не найден.' });
            recipients = [matches[0].email];
        }
        recipients = [...new Set(recipients)];
        if (!recipients.length) return res.status(200).json({ sent: 0, failed: 0, message: 'Нет подтверждённых подписчиков.' });

        let sent = 0;
        let failed = 0;
        const html = `<div style="font-family:Arial,sans-serif;line-height:1.6"><p>${text.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]).replace(/\n/g, '<br>')}</p><hr><small>Письмо отправлено Dr. DarSun. Настройки email-уведомлений доступны в профиле.</small></div>`;
        for (let offset = 0; offset < recipients.length; offset += 10) {
            const batch = recipients.slice(offset, offset + 10);
            const outcomes = await Promise.allSettled(batch.map(to => transport.sendMail({
                from: env.MAIL_SEND_USER,
                to,
                subject,
                text,
                html
            })));
            sent += outcomes.filter(outcome => outcome.status === 'fulfilled').length;
            failed += outcomes.filter(outcome => outcome.status === 'rejected').length;
        }
        if (failed) console.error('Admin email broadcast had delivery failures:', { sent, failed });
        res.json({ sent, failed });
    }));

    router.get('/admin/maintenance', authenticateBot, allowRoles('admin'), requireOwnerChat, withErrors('Telegram maintenance status lookup failed', async (req, res) => {
        const [setting] = await databaseRequest('site_runtime_settings?select=value&setting_key=eq.site_maintenance&limit=1');
        res.setHeader('Cache-Control', 'no-store');
        const mode = ['planned', 'emergency'].includes(setting?.value?.mode)
            ? setting.value.mode
            : 'planned';
        res.json({ enabled: setting?.value?.enabled === true, mode });
    }));

    router.post('/admin/maintenance', authenticateBot, allowRoles('admin'), requireOwnerChat, withErrors('Telegram maintenance update failed', async (req, res) => {
        const configuredPassword = env.SITE_MAINTENANCE_PASSWORD;
        const suppliedPassword = typeof req.body?.password === 'string' ? req.body.password : '';
        if (!configuredPassword || configuredPassword.length < 16) {
            return res.status(503).json({ error: 'Техперерыв не настроен: задайте SITE_MAINTENANCE_PASSWORD (минимум 16 символов).' });
        }
        if (typeof req.body?.enabled !== 'boolean') {
            return res.status(400).json({ error: 'Укажите новое состояние техперерыва.' });
        }
        const requestedMode = req.body?.mode;
        if (req.body.enabled && !['planned', 'emergency'].includes(requestedMode)) {
            return res.status(400).json({ error: 'Выберите режим плановых или срочных работ.' });
        }
        if (!suppliedPassword || !safeEqual(suppliedPassword, configuredPassword)) {
            return res.status(403).json({ error: 'Неверный пароль подтверждения.' });
        }
        const [currentSetting] = await databaseRequest('site_runtime_settings?select=value&setting_key=eq.site_maintenance&limit=1');
        const mode = req.body.enabled
            ? requestedMode
            : ['planned', 'emergency'].includes(currentSetting?.value?.mode)
                ? currentSetting.value.mode
                : 'planned';
        const settings = await databaseRequest('site_runtime_settings?on_conflict=setting_key', {
            method: 'POST',
            headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
            body: JSON.stringify({
                setting_key: 'site_maintenance',
                value: { enabled: req.body.enabled, mode },
                updated_at: new Date().toISOString()
            })
        });
        await writeTelegramAudit(req, 'maintenance.changed', 'maintenance', 'site', { enabled: req.body.enabled, mode });
        res.setHeader('Cache-Control', 'no-store');
        const updatedSettings = {
            enabled: settings?.[0]?.value?.enabled === true,
            mode: ['planned', 'emergency'].includes(settings?.[0]?.value?.mode)
                ? settings[0].value.mode
                : mode
        };
        onMaintenanceChanged?.(updatedSettings);
        res.json(updatedSettings);
    }));

    async function authenticateSiteUser(req, res, next) {
        const authorization = req.get('Authorization') || '';
        if (!authorization.startsWith('Bearer ') || !supabaseUrl || !anonKey) {
            return res.status(401).json({ error: 'Войдите на сайт и повторите попытку.' });
        }

        try {
            const response = await request(`${supabaseUrl}/auth/v1/user`, {
                headers: { apikey: anonKey, Authorization: authorization }
            });
            const user = await response.json().catch(() => null);
            if (!response.ok || !user?.id || !user?.email) {
                return res.status(401).json({ error: 'Сессия сайта истекла. Войдите снова.' });
            }
            req.siteUser = user;
            next();
        } catch (error) {
            console.error('Telegram site session validation failed:', error);
            res.status(503).json({ error: 'Не удалось проверить сессию сайта.' });
        }
    }

    function withErrors(label, handler) {
        return async (req, res) => {
            try {
                await handler(req, res);
            } catch (error) {
                console.error(`${label}:`, error);
                if (!res.headersSent) res.status(503).json({ error: 'Сервис временно недоступен. Попробуйте позже.' });
            }
        };
    }

    async function notifyTelegramUser(userId, message, eventName) {
        try {
            await sendTelegramNotification(userId, message);
        } catch (error) {
            console.warn(`${eventName} Telegram notification was not delivered:`, error.message);
        }
    }

    function getClientBotUrl(startPayload = '') {
        const username = typeof env.CLIENT_BOT_USERNAME === 'string'
            ? env.CLIENT_BOT_USERNAME.trim().replace(/^@/, '')
            : '';
        if (!/^[A-Za-z0-9_]{5,32}$/.test(username)) return null;
        const url = new URL(`https://t.me/${username}`);
        if (startPayload) url.searchParams.set('start', startPayload);
        return url.toString();
    }

    router.get('/client/info', (req, res) => {
        const getBotUrl = usernameValue => {
            const username = typeof usernameValue === 'string'
                ? usernameValue.trim().replace(/^@/, '')
                : '';
            return /^[A-Za-z0-9_]{5,32}$/.test(username)
                ? `https://t.me/${username}`
                : null;
        };
        const clientUrl = getBotUrl(env.CLIENT_BOT_USERNAME);
        const supportUrl = getBotUrl(env.SUPPORT_BOT_USERNAME || SUPPORT_TELEGRAM_USERNAME);
        res.setHeader('Cache-Control', 'public, max-age=300');
        res.json({
            available: Boolean(clientUrl),
            ...(clientUrl ? { url: clientUrl } : {}),
            supportAvailable: Boolean(supportUrl),
            ...(supportUrl ? { supportUrl } : {})
        });
    });

    router.get('/link', authenticateSiteUser, withErrors('Telegram account link status lookup failed', async (req, res) => {
        const [account] = await databaseRequest(
            `telegram_accounts?select=telegram_username,linked_at&user_id=eq.${encodeURIComponent(req.siteUser.id)}&limit=1`
        );
        res.setHeader('Cache-Control', 'no-store');
        res.json({
            linked: Boolean(account),
            account: account ? {
                telegram_username: account.telegram_username || null,
                linked_at: account.linked_at
            } : null
        });
    }));

    router.post('/link/start', telegramLinkRequestLimiter, authenticateSiteUser, withErrors('Telegram account link request failed', async (req, res) => {
        const url = getClientBotUrl();
        if (!url) return res.status(503).json({ error: 'Привязка Telegram временно недоступна.' });

        const code = crypto.randomBytes(24).toString('hex');
        const codeHash = crypto.createHash('sha256').update(code).digest('hex');
        await databaseRequest('rpc/start_telegram_account_link', {
            method: 'POST',
            body: JSON.stringify({
                p_user_id: req.siteUser.id,
                p_email: req.siteUser.email,
                p_code_hash: codeHash
            })
        });

        const botUrl = new URL(url);
        botUrl.searchParams.set('start', `link_${code}`);
        res.setHeader('Cache-Control', 'no-store');
        res.status(201).json({
            url: botUrl.toString(),
            expiresInSeconds: 600
        });
    }));

    router.delete('/link', authenticateSiteUser, withErrors('Telegram account unlink failed', async (req, res) => {
        await databaseRequest('rpc/unlink_telegram_account', {
            method: 'POST',
            body: JSON.stringify({ p_user_id: req.siteUser.id })
        });
        res.setHeader('Cache-Control', 'no-store');
        res.json({ success: true });
    }));

    router.get('/notifications', authenticateSiteUser, withErrors('Telegram notification settings lookup failed', async (req, res) => {
        const [settings] = await databaseRequest(
            `notification_settings?select=telegram_enabled&user_id=eq.${encodeURIComponent(req.siteUser.id)}&limit=1`
        );
        res.setHeader('Cache-Control', 'no-store');
        res.json({ telegramEnabled: settings?.telegram_enabled === true });
    }));

    router.patch('/notifications', authenticateSiteUser, withErrors('Telegram notification settings update failed', async (req, res) => {
        if (typeof req.body?.telegramEnabled !== 'boolean') {
            return res.status(400).json({ error: 'Укажите, включить или отключить Telegram-уведомления.' });
        }
        if (req.body.telegramEnabled && !env.CLIENT_BOT_TOKEN) {
            return res.status(503).json({ error: 'Telegram-уведомления временно недоступны.' });
        }
        const updated = await databaseRequest('rpc/set_telegram_notifications', {
            method: 'POST',
            body: JSON.stringify({
                p_user_id: req.siteUser.id,
                p_enabled: req.body.telegramEnabled
            })
        });
        if (updated !== true) {
            return res.status(409).json({ error: 'Сначала привяжите Telegram к аккаунту.' });
        }
        if (req.body.telegramEnabled) {
            await notifyTelegramUser(req.siteUser.id, 'Уведомления Dr. DarSun включены. Важные сообщения по заказам и личные уведомления будут приходить сюда.', 'Settings');
        }
        res.setHeader('Cache-Control', 'no-store');
        res.json({ telegramEnabled: req.body.telegramEnabled });
    }));

    router.post('/client/link/confirm', authenticateBot, allowRoles('client'), withErrors('Telegram account link confirmation failed', async (req, res) => {
        const code = typeof req.body?.code === 'string' ? req.body.code : '';
        const chatId = req.get('X-Telegram-Chat-Id') || '';
        const username = typeof req.body?.username === 'string'
            ? req.body.username.trim().replace(/^@/, '').slice(0, 64)
            : null;
        if (!/^[a-f0-9]{48}$/.test(code) || !/^[0-9]{1,19}$/.test(chatId)) {
            return res.status(400).json({ error: 'Ссылка привязки повреждена или устарела.' });
        }
        const confirmed = await databaseRequest('rpc/confirm_telegram_link', {
            method: 'POST',
            body: JSON.stringify({
                p_code_hash: crypto.createHash('sha256').update(code).digest('hex'),
                p_telegram_chat_id: chatId,
                p_telegram_username: username
            })
        });
        if (confirmed !== true) {
            return res.status(409).json({ error: 'Ссылка недействительна, истекла или уже использована.' });
        }
        res.setHeader('Cache-Control', 'no-store');
        res.json({ success: true });
    }));

    router.post('/login/request', telegramLoginRequestLimiter, withErrors('Telegram login request creation failed', async (_req, res) => {
        const url = getClientBotUrl();
        if (!url || typeof env.TELEGRAM_WORKER_SHARED_SECRET !== 'string' ||
            env.TELEGRAM_WORKER_SHARED_SECRET.length < 32) {
            return res.status(503).json({ error: 'Вход через Telegram временно недоступен.' });
        }
        const id = crypto.randomBytes(24).toString('hex');
        const pollSecret = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
        await databaseRequest('rpc/create_telegram_login_request', {
            method: 'POST',
            body: JSON.stringify({
                p_id: id,
                p_poll_token_hash: crypto.createHash('sha256').update(pollSecret).digest('hex'),
                p_expires_at: expiresAt
            })
        });
        const botUrl = new URL(url);
        botUrl.searchParams.set('start', `login_${id}`);
        res.setHeader('Cache-Control', 'no-store');
        res.status(201).json({
            id,
            pollSecret,
            url: botUrl.toString(),
            expiresAt
        });
    }));

    router.post('/login/verify', telegramLoginVerifyLimiter, withErrors('Telegram login code verification failed', async (req, res) => {
        const id = typeof req.body?.id === 'string' ? req.body.id : '';
        const pollSecret = typeof req.body?.pollSecret === 'string' ? req.body.pollSecret : '';
        const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
        if (!/^[a-f0-9]{48}$/.test(id) ||
            !/^[a-f0-9]{64}$/.test(pollSecret) ||
            !/^\d{6}$/.test(code)) {
            return res.status(400).json({ error: 'Проверьте ссылку входа и шестизначный код.' });
        }
        const secret = env.TELEGRAM_WORKER_SHARED_SECRET;
        if (typeof secret !== 'string' || secret.length < 32) {
            return res.status(503).json({ error: 'Вход через Telegram временно недоступен.' });
        }

        const pollTokenHash = crypto.createHash('sha256').update(pollSecret).digest('hex');
        const codeHash = crypto.createHmac('sha256', secret)
            .update(`telegram-login-verify:v1:${id}:${code}`)
            .digest('hex');
        const verified = await databaseRequest('rpc/verify_telegram_login', {
            method: 'POST',
            body: JSON.stringify({
                p_request_id: id,
                p_poll_token_hash: pollTokenHash,
                p_code_hash: codeHash
            })
        });
        const account = Array.isArray(verified) ? verified[0] : null;
        if (!account?.user_id || typeof account.email !== 'string') {
            return res.status(401).json({ error: 'Код неверный, истёк или уже использован. Запросите новый.' });
        }

        const linkResponse = await request(`${supabaseUrl}/auth/v1/admin/generate_link`, {
            method: 'POST',
            headers: {
                apikey: serviceRoleKey,
                Authorization: `Bearer ${serviceRoleKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ type: 'magiclink', email: account.email }),
            signal: AbortSignal.timeout(10000)
        });
        const link = await linkResponse.json().catch(() => null);
        if (!linkResponse.ok || typeof link?.email_otp !== 'string') {
            console.error('Supabase Telegram login session creation failed:', linkResponse.status);
            return res.status(503).json({ error: 'Не удалось завершить вход. Запросите новый код.' });
        }
        res.setHeader('Cache-Control', 'no-store');
        res.json({ email: account.email, emailOtp: link.email_otp });
    }));

    router.delete('/login/:id', withErrors('Telegram login request cancellation failed', async (req, res) => {
        const id = req.params.id;
        const pollSecret = req.get('X-Telegram-Login-Poll-Token') || '';
        if (!/^[a-f0-9]{48}$/.test(id) || !/^[a-f0-9]{64}$/.test(pollSecret)) {
            return res.status(400).json({ error: 'Некорректный запрос входа.' });
        }
        const query = new URLSearchParams({
            id: `eq.${id}`,
            poll_token_hash: `eq.${crypto.createHash('sha256').update(pollSecret).digest('hex')}`,
            status: 'in.(pending,code_sent)'
        });
        await databaseRequest(`telegram_login_requests?${query}`, {
            method: 'DELETE',
            headers: { Prefer: 'return=minimal' }
        });
        res.json({ success: true });
    }));

    router.post('/client/login/code', authenticateBot, allowRoles('client'), withErrors('Telegram login code issue failed', async (req, res) => {
        const id = typeof req.body?.id === 'string' ? req.body.id : '';
        const chatId = req.get('X-Telegram-Chat-Id') || '';
        const secret = env.TELEGRAM_WORKER_SHARED_SECRET;
        if (!/^[a-f0-9]{48}$/.test(id) ||
            !/^[0-9]{1,19}$/.test(chatId) ||
            typeof secret !== 'string' || secret.length < 32) {
            return res.status(400).json({ error: 'Ссылка входа недействительна или устарела.' });
        }
        const digest = crypto.createHmac('sha256', secret)
            .update(`telegram-login-code:v1:${id}:${chatId}`)
            .digest();
        const code = String(Number(digest.readBigUInt64BE(0) % 1000000n)).padStart(6, '0');
        const codeHash = crypto.createHmac('sha256', secret)
            .update(`telegram-login-verify:v1:${id}:${code}`)
            .digest('hex');
        const acceptedChatId = await databaseRequest('rpc/begin_telegram_login', {
            method: 'POST',
            body: JSON.stringify({
                p_request_id: id,
                p_telegram_chat_id: chatId,
                p_code_hash: codeHash
            })
        });
        if (acceptedChatId !== chatId) {
            return res.status(409).json({ error: 'Вход не подтверждён. Проверьте привязку аккаунта и создайте новую ссылку.' });
        }
        res.setHeader('Cache-Control', 'no-store');
        res.json({ code });
    }));

    router.get('/integration/status', authenticateBot, (req, res) => {
        const capabilities = {
            admin: ['orders:read', 'orders:update', 'products:manage', 'reviews:moderate'],
            support: ['tickets:manage'],
            client: []
        };
        res.setHeader('Cache-Control', 'no-store');
        res.json({ bot: req.telegramBotRole, capabilities: capabilities[req.telegramBotRole] });
    });

    router.get('/support/my-ticket', authenticateBot, allowRoles('support'), withErrors('Telegram customer ticket lookup failed', async (req, res) => {
        const chatId = req.get('X-Telegram-Chat-Id') || '';
        if (!isValidChatId(chatId)) return res.status(400).json({ error: 'Некорректный Telegram chat ID.' });
        const [ticket] = await databaseRequest(`telegram_support_tickets?select=id,ticket_number,topic,status,created_at,updated_at&telegram_chat_id=eq.${encodeURIComponent(chatId)}&status=eq.open&order=created_at.desc&limit=1`);
        if (!ticket) return res.json({ ticket: null, messages: [] });
        const messages = await databaseRequest(`telegram_support_messages?select=sender_role,message,created_at&ticket_id=eq.${ticket.id}&order=created_at.desc&limit=12`);
        res.json({ ticket, messages: messages.reverse() });
    }));

    router.post('/support/tickets', authenticateBot, allowRoles('support'), withErrors('Telegram support ticket creation failed', async (req, res) => {
        const chatId = req.get('X-Telegram-Chat-Id') || '';
        const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
        const topic = SUPPORT_TOPICS.includes(req.body?.topic) ? req.body.topic : 'Другое';
        const username = typeof req.body?.username === 'string'
            ? req.body.username.trim().replace(/^@/, '').slice(0, 64)
            : null;
        if (!isValidChatId(chatId) || !message || message.length > 4000) {
            return res.status(400).json({ error: 'Укажите Telegram chat ID и сообщение до 4000 символов.' });
        }
        const ticketId = await databaseRequest('rpc/create_telegram_support_ticket', {
            method: 'POST',
            body: JSON.stringify({
                p_telegram_chat_id: chatId,
                p_telegram_username: username,
                p_message: message,
                p_topic: topic
            })
        });
        if (!ticketId || typeof ticketId.ticket_id !== 'string') throw new Error('Support ticket was not created.');
        res.status(ticketId.existing ? 200 : 201).json({
            id: ticketId.ticket_id,
            number: ticketId.ticket_number,
            topic,
            existing: Boolean(ticketId.existing)
        });
    }));

    router.post('/support/tickets/:id/message', authenticateBot, allowRoles('support'), withErrors('Telegram support message failed', async (req, res) => {
        if (!isUuid(req.params.id)) return res.status(400).json({ error: 'Некорректный номер обращения.' });
        const chatId = req.get('X-Telegram-Chat-Id') || '';
        const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
        if (!isValidChatId(chatId) || !message || message.length > 4000) {
            return res.status(400).json({ error: 'Укажите Telegram chat ID и сообщение до 4000 символов.' });
        }
        const saved = await databaseRequest('rpc/add_telegram_support_message', {
            method: 'POST',
            body: JSON.stringify({
                p_ticket_id: req.params.id,
                p_sender_role: 'customer',
                p_telegram_chat_id: chatId,
                p_message: message
            })
        });
        if (saved !== true) return res.status(404).json({ error: 'Открытое обращение не найдено.' });
        res.json({ success: true });
    }));

    router.post('/support/tickets/:id/close', authenticateBot, allowRoles('support'), withErrors('Telegram customer ticket close failed', async (req, res) => {
        if (!isUuid(req.params.id)) return res.status(400).json({ error: 'Некорректный номер обращения.' });
        const chatId = req.get('X-Telegram-Chat-Id') || '';
        if (!isValidChatId(chatId)) return res.status(400).json({ error: 'Некорректный Telegram chat ID.' });
        const updated = await databaseRequest(`telegram_support_tickets?id=eq.${req.params.id}&telegram_chat_id=eq.${encodeURIComponent(chatId)}&status=eq.open`, {
            method: 'PATCH',
            headers: { Prefer: 'return=representation' },
            body: JSON.stringify({ status: 'closed', updated_at: new Date().toISOString() })
        });
        if (!updated?.length) return res.status(404).json({ error: 'Открытое обращение не найдено.' });
        res.json({ success: true });
    }));

    router.get('/support/tickets', authenticateBot, allowRoles('support'), withErrors('Telegram support ticket lookup failed', async (req, res) => {
        const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
        const status = req.query.status === 'closed' ? 'closed' : 'open';
        const tickets = await databaseRequest(`telegram_support_tickets?select=id,ticket_number,topic,telegram_chat_id,telegram_username,status,created_at,updated_at&status=eq.${status}&order=updated_at.desc&limit=${limit}`);
        res.json({ tickets });
    }));

    router.get('/support/tickets/:id/messages', authenticateBot, allowRoles('support'), withErrors('Telegram support messages lookup failed', async (req, res) => {
        if (!isUuid(req.params.id)) return res.status(400).json({ error: 'Некорректный номер обращения.' });
        const messages = await databaseRequest(`telegram_support_messages?select=id,ticket_id,sender_role,message,created_at&ticket_id=eq.${req.params.id}&order=created_at.asc&limit=200`);
        res.json({ messages });
    }));

    router.post('/support/tickets/:id/reply', authenticateBot, allowRoles('support'), withErrors('Telegram support reply failed', async (req, res) => {
        if (!isUuid(req.params.id)) return res.status(400).json({ error: 'Некорректный номер обращения.' });
        const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
        const agentChatId = req.get('X-Telegram-Chat-Id') || '';
        if (!message || message.length > 4000 || !isValidChatId(agentChatId)) {
            return res.status(400).json({ error: 'Укажите Telegram chat ID оператора и сообщение до 4000 символов.' });
        }
        const saved = await databaseRequest('rpc/add_telegram_support_message', {
            method: 'POST',
            body: JSON.stringify({
                p_ticket_id: req.params.id,
                p_sender_role: 'support',
                p_telegram_chat_id: agentChatId,
                p_message: message
            })
        });
        if (saved !== true) return res.status(404).json({ error: 'Обращение не найдено или закрыто.' });
        res.json({ success: true });
    }));

    router.patch('/support/tickets/:id', authenticateBot, allowRoles('support'), withErrors('Telegram support ticket update failed', async (req, res) => {
        if (!isUuid(req.params.id)) return res.status(400).json({ error: 'Некорректный номер обращения.' });
        const status = req.body?.status;
        if (!['open', 'closed'].includes(status)) return res.status(400).json({ error: 'Статус должен быть open или closed.' });
        const updated = await databaseRequest(`telegram_support_tickets?id=eq.${req.params.id}`, {
            method: 'PATCH',
            headers: { Prefer: 'return=representation' },
            body: JSON.stringify({ status, updated_at: new Date().toISOString() })
        });
        if (!updated?.length) return res.status(404).json({ error: 'Обращение не найдено.' });
        res.json({ success: true });
    }));

    router.get('/admin/orders', authenticateBot, allowRoles('admin'), requireOwnerChat, withErrors('Telegram admin orders lookup failed', async (req, res) => {
        const offset = Math.max(0, Math.min(100000, Number.parseInt(req.query.offset, 10) || 0));
        const orders = await databaseRequest(`orders?select=id,user_id,items,total,status,created_at&order=created_at.desc&limit=100&offset=${offset}`);
        res.json({ orders });
    }));

    router.get('/admin/reviews', authenticateBot, allowRoles('admin'), requireOwnerChat, withErrors('Telegram review moderation lookup failed', async (req, res) => {
        const offset = Math.max(0, Math.min(100000, Number.parseInt(req.query.offset, 10) || 0));
        const reviews = await databaseRequest(`brand_reviews?select=id,user_name,rating,review_text,created_at,product_id&status=eq.pending&order=created_at.asc&limit=11&offset=${offset}`);
        const page = reviews.slice(0, 10);
        const productIds = [...new Set(page
            .map(review => review.product_id)
            .filter(id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(id)))];
        const products = productIds.length
            ? await databaseRequest(`products?select=id,name&id=in.(${productIds.join(',')})`)
            : [];
        const productNames = new Map(products.map(product => [product.id, product.name]));
        res.json({
            reviews: page.map(review => ({
                ...review,
                product_name: review.product_id ? productNames.get(review.product_id) || 'Товар удалён' : null
            })),
            offset,
            hasMore: reviews.length > 10
        });
    }));

    router.patch('/admin/reviews/:id', authenticateBot, allowRoles('admin'), requireOwnerChat, withErrors('Telegram review moderation failed', async (req, res) => {
        if (!isUuid(req.params.id)) return res.status(400).json({ error: 'Некорректный ID отзыва.' });
        const status = req.body?.status;
        if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'Выберите approve или reject.' });
        const updated = await databaseRequest(`brand_reviews?id=eq.${req.params.id}&status=eq.pending`, {
            method: 'PATCH',
            headers: { Prefer: 'return=representation' },
            body: JSON.stringify({ status, updated_at: new Date().toISOString() })
        });
        if (!updated?.length) return res.status(404).json({ error: 'Отзыв не найден или уже обработан.' });
        await writeTelegramAudit(req, 'review.moderated', 'review', req.params.id, { status });
        res.json({ success: true });
    }));

    router.get('/panel/orders', authenticateBot, allowRoles('panel', 'admin'), requireOwnerChat, withErrors('Telegram panel orders lookup failed', async (req, res) => {
        const offset = Math.max(0, Math.min(100000, Number.parseInt(req.query.offset, 10) || 0));
        const status = ORDER_STATUSES.includes(req.query.status) ? req.query.status : '';
        const statusFilter = status ? `&status=eq.${status}` : '';
        const orders = await databaseRequest(`orders?select=id,items,total,status,created_at,customer_name,customer_email,delivery_address&order=created_at.desc&limit=11&offset=${offset}${statusFilter}`);
        res.json({ orders: orders.slice(0, 10), status, offset, hasMore: orders.length > 10 });
    }));

    router.get('/panel/audit', authenticateBot, allowRoles('panel', 'admin'), requireOwnerChat, withErrors('Telegram admin audit lookup failed', async (req, res) => {
        const offset = Math.max(0, Math.min(100000, Number.parseInt(req.query.offset, 10) || 0));
        const entries = await databaseRequest(`telegram_admin_audit?select=id,actor_role,action,entity_type,entity_id,details,created_at&order=created_at.desc&limit=21&offset=${offset}`);
        res.json({ entries: entries.slice(0, 20), offset, hasMore: entries.length > 20 });
    }));

    router.post('/panel/orders', authenticateBot, allowRoles('panel', 'admin'), requireOwnerChat, withErrors('Telegram order creation failed', async (req, res) => {
        const userId = typeof req.body?.user_id === 'string' ? req.body.user_id : '';
        const itemsInput = req.body?.items;
        if (!isUuid(userId) || !Array.isArray(itemsInput) || itemsInput.length < 1 || itemsInput.length > 20) {
            return res.status(400).json({ error: 'Укажите UUID пользователя и от 1 до 20 товарных позиций.' });
        }
        const products = await databaseRequest('products?select=id,name,price&limit=500');
        const items = [];
        for (const item of itemsInput) {
            const product = products.find(candidate => String(candidate.id) === String(item?.product_id));
            const quantity = Number(item?.quantity);
            const price = Number(product?.price);
            if (!product || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 99 || !Number.isFinite(price) || price < 0) {
                return res.status(400).json({ error: 'Проверьте товары и количество: товар должен существовать, количество — от 1 до 99.' });
            }
            items.push({
                product_id: product.id,
                name: String(product.name || '').slice(0, 200),
                price,
                quantity
            });
        }
        const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
        if (!Number.isSafeInteger(Math.round(total * 100))) return res.status(400).json({ error: 'Слишком большая сумма заказа.' });
        const [order] = await databaseRequest('orders?select=id,user_id,items,total,status,created_at', {
            method: 'POST',
            headers: { Prefer: 'return=representation' },
            body: JSON.stringify({ user_id: userId, items, total, status: 'pending' })
        });
        if (!order) throw new Error('Order was not created.');
        await notifyTelegramUser(
            order.user_id,
            `Создан заказ №${order.id}. Статус: ${order.status}. Сумма: ${order.total} ₽.`,
            'Order created'
        );
        await writeTelegramAudit(req, 'order.created', 'order', order.id, {
            item_count: items.length,
            total
        });
        res.status(201).json({ order });
    }));

    router.patch('/panel/orders/:id', authenticateBot, allowRoles('panel', 'admin'), requireOwnerChat, withErrors('Telegram order update failed', async (req, res) => {
        const orderId = typeof req.params.id === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(req.params.id)
            ? req.params.id
            : '';
        if (!orderId) return res.status(400).json({ error: 'Некорректный номер заказа.' });
        const update = {};
        if (req.body?.status !== undefined) {
            if (!ORDER_STATUSES.includes(req.body.status)) {
                return res.status(400).json({ error: `Статус должен быть одним из: ${ORDER_STATUSES.join(', ')}.` });
            }
            update.status = req.body.status;
        }
        if (req.body?.items !== undefined) {
            if (!Array.isArray(req.body.items) || req.body.items.length < 1 || req.body.items.length > 20) {
                return res.status(400).json({ error: 'Укажите от 1 до 20 товарных позиций.' });
            }
            const products = await databaseRequest('products?select=id,name,price&limit=500');
            update.items = [];
            for (const item of req.body.items) {
                const product = products.find(candidate => String(candidate.id) === String(item?.product_id));
                const quantity = Number(item?.quantity);
                const price = Number(product?.price);
                if (!product || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 99 || !Number.isFinite(price) || price < 0) {
                    return res.status(400).json({ error: 'Проверьте товары и количество: товар должен существовать, количество — от 1 до 99.' });
                }
                update.items.push({ product_id: product.id, name: String(product.name || '').slice(0, 200), price, quantity });
            }
            update.total = update.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
        }
        if (!Object.keys(update).length) return res.status(400).json({ error: 'Нет полей для изменения.' });
        const [previousOrder] = await databaseRequest(`orders?id=eq.${encodeURIComponent(orderId)}&select=id,user_id,status,items,total&limit=1`);
        const [order] = await databaseRequest(`orders?id=eq.${encodeURIComponent(orderId)}&select=id,user_id,items,total,status,created_at`, {
            method: 'PATCH',
            headers: { Prefer: 'return=representation' },
            body: JSON.stringify(update)
        });
        if (!order) return res.status(404).json({ error: 'Заказ не найден.' });
        if (previousOrder?.status !== order.status) {
            await notifyTelegramUser(
                order.user_id,
                `Обновлён статус заказа №${order.id}: ${order.status}.`,
                'Order status'
            );
        }
        await writeTelegramAudit(req, 'order.updated', 'order', orderId, {
            fields: Object.keys(update),
            previous_status: previousOrder?.status || null,
            status: order.status,
            total: order.total
        });
        res.json({ order });
    }));

    router.get('/panel/products', authenticateBot, allowRoles('panel', 'admin'), requireOwnerChat, withErrors('Telegram product lookup failed', async (req, res) => {
        const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 8));
        const offset = Math.min(100000, Math.max(0, Number.parseInt(req.query.offset, 10) || 0));
        const rows = await databaseRequest(`products?select=id,name,price,description,category,image_url,volume,packaging_type,pressing_type,shelf_life_months&order=name.asc,id.asc&limit=${limit + 1}&offset=${offset}`);
        res.json({ products: rows.slice(0, limit), hasMore: rows.length > limit, offset });
    }));

    router.get('/panel/oil-types', authenticateBot, allowRoles('panel', 'admin'), requireOwnerChat, (_req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        res.json({
            oils: OIL_TYPES,
            packagingTypes: PACKAGING_TYPES,
            pressingTypes: PRESSING_TYPES,
            shelfLifeMonths: SHELF_LIFE_MONTHS,
            volumes: VOLUME_OPTIONS
        });
    });

    router.post('/panel/products', authenticateBot, allowRoles('panel', 'admin'), requireOwnerChat, withErrors('Telegram product creation failed', async (req, res) => {
        const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
        const category = typeof req.body?.category === 'string' ? req.body.category.trim() : '';
        const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';
        const imageUrl = typeof req.body?.image_url === 'string' ? req.body.image_url.trim() : '';
        const productKind = typeof req.body?.kind === 'string' ? req.body.kind : 'oil';
        const volume = productKind === 'oil' ? Number(req.body?.volume) : String(req.body?.volume || '').trim();
        const packagingType = typeof req.body?.packaging_type === 'string' ? req.body.packaging_type : '';
        const pressingType = typeof req.body?.pressing_type === 'string' ? req.body.pressing_type : '';
        const shelfLifeMonths = req.body?.shelf_life_months == null ? null : Number(req.body.shelf_life_months);
        const price = Number(req.body?.price);
        const oil = OIL_TYPES.find(candidate => candidate.id === req.body?.oil_id);
        const sharedInvalid = !name || name.length > 160 || !category || category.length > 80 ||
            description.length > 2000 || /[\u0000-\u001f\u007f]/.test(name + category + description) ||
            imageUrl.length > 2000 ||
            (imageUrl && !/^(?:https?:\/\/\S+|assets\/images\/(?:oils\/[a-z-]+|encyclopedia\/[a-z-]+)\.svg)$/i.test(imageUrl)) ||
            !Number.isFinite(price) || price <= 0 || price > 10000000;
        if (sharedInvalid) {
            return res.status(400).json({ error: 'Проверьте название, описание, изображение и цену товара.' });
        }

        let productData;
        if (productKind === 'oil') {
            if (!oil || !Number.isSafeInteger(volume) || volume < 10 || volume > 5000 ||
                name !== `${oil.name} · ${volume} мл` || category !== oil.category ||
                !PACKAGING_TYPES.includes(packagingType) ||
                !PRESSING_TYPES.includes(pressingType) || !SHELF_LIFE_MONTHS.includes(shelfLifeMonths)) {
                return res.status(400).json({ error: 'Проверьте масло, объём, упаковку, отжим, срок хранения и цену.' });
            }
            productData = {
                name,
                category,
                description,
                price,
                image_url: imageUrl || oil.image_url,
                volume: `${volume} мл`,
                packaging_type: packagingType,
                pressing_type: pressingType,
                shelf_life_months: shelfLifeMonths
            };
        } else {
            const expectedCategory = NON_OIL_PRODUCT_CATEGORIES[productKind];
            const volumeMatch = /^(\d{1,4})\s*(мл|г)$/i.exec(volume);
            const amount = volumeMatch ? Number(volumeMatch[1]) : Number.NaN;
            if (!expectedCategory || category !== expectedCategory || !Number.isSafeInteger(amount) ||
                amount < 10 || amount > 5000 || !packagingType || packagingType.length > 80 ||
                /[\u0000-\u001f\u007f]/.test(packagingType) ||
                pressingType.length > 80 || /[\u0000-\u001f\u007f]/.test(pressingType) ||
                (shelfLifeMonths !== null && (!Number.isSafeInteger(shelfLifeMonths) || shelfLifeMonths < 1 || shelfLifeMonths > 60))) {
                return res.status(400).json({ error: 'Проверьте категорию, фасовку, упаковку и срок хранения товара.' });
            }
            const imageName = productKind === 'milk' ? 'plant-milk' : productKind;
            productData = {
                name,
                category,
                description,
                price,
                image_url: imageUrl || `assets/images/encyclopedia/${imageName}.svg`,
                volume: `${amount} ${volumeMatch[2].toLowerCase()}`,
                packaging_type: packagingType,
                pressing_type: pressingType || null,
                shelf_life_months: shelfLifeMonths
            };
        }

        const [product] = await databaseRequest('products?select=id,name,price,description,category,image_url,volume,packaging_type,pressing_type,shelf_life_months', {
            method: 'POST',
            headers: { Prefer: 'return=representation' },
            body: JSON.stringify(productData)
        });
        if (!product) throw new Error('Product was not created.');
        await writeTelegramAudit(req, 'product.created', 'product', product.id, {
            name: product.name,
            category: product.category,
            price: product.price,
            volume: product.volume,
            packaging_type: product.packaging_type,
            pressing_type: product.pressing_type,
            shelf_life_months: product.shelf_life_months
        });
        res.status(201).json({ product });
    }));

    router.patch('/panel/products/:id', authenticateBot, allowRoles('panel', 'admin'), requireOwnerChat, withErrors('Telegram product update failed', async (req, res) => {
        const productId = typeof req.params.id === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(req.params.id)
            ? req.params.id
            : '';
        if (!productId) return res.status(400).json({ error: 'Некорректный ID товара.' });
        const update = {};
        for (const field of ['name', 'category', 'description', 'image_url', 'packaging_type', 'pressing_type']) {
            if (req.body?.[field] !== undefined) {
                if (typeof req.body[field] !== 'string') return res.status(400).json({ error: `Поле ${field} должно быть текстом.` });
                const value = req.body[field].trim();
                const maxLength = field === 'name' ? 160 : field === 'category' ? 80 : 2000;
                if ((field !== 'description' && field !== 'image_url' && !value) || value.length > maxLength) {
                    return res.status(400).json({ error: `Проверьте поле ${field}.` });
                }
                if (field === 'image_url' && value &&
                    !/^(?:https?:\/\/\S+|assets\/images\/(?:oils\/[a-z-]+|encyclopedia\/[a-z-]+)\.svg)$/i.test(value)) {
                    return res.status(400).json({ error: 'Укажите URL изображения или путь к иллюстрации продукции.' });
                }
                if (field === 'packaging_type' && value.length > 80) {
                    return res.status(400).json({ error: 'Название упаковки должно быть не длиннее 80 символов.' });
                }
                if (field === 'pressing_type' && (value.length > 80 || /[\u0000-\u001f\u007f]/.test(value))) {
                    return res.status(400).json({ error: 'Способ обработки должен быть не длиннее 80 символов.' });
                }
                update[field] = value;
            }
        }
        if (req.body?.price !== undefined) {
            const price = Number(req.body.price);
            if (!Number.isFinite(price) || price < 0 || price > 10000000) return res.status(400).json({ error: 'Проверьте цену.' });
            update.price = price;
        }
        if (req.body?.volume !== undefined) {
            const volume = typeof req.body.volume === 'string'
                ? /^(\d{1,4})\s*(мл|г)?$/i.exec(req.body.volume.trim())
                : null;
            const volumeMl = volume ? Number(volume[1]) : Number.NaN;
            if (!Number.isSafeInteger(volumeMl) || volumeMl < 10 || volumeMl > 5000) {
                return res.status(400).json({ error: 'Укажите фасовку целым числом от 10 до 5000 г или мл.' });
            }
            update.volume = `${volumeMl} ${(volume[2] || 'мл').toLowerCase()}`;
        }
        if (req.body?.shelf_life_months !== undefined) {
            const shelfLifeMonths = req.body.shelf_life_months === null ? null : Number(req.body.shelf_life_months);
            if (shelfLifeMonths !== null && (!Number.isSafeInteger(shelfLifeMonths) || shelfLifeMonths < 1 || shelfLifeMonths > 60)) {
                return res.status(400).json({ error: 'Срок хранения должен быть от 1 до 60 месяцев или пустым.' });
            }
            update.shelf_life_months = shelfLifeMonths;
        }
        if (!Object.keys(update).length) return res.status(400).json({ error: 'Нет полей для изменения.' });
        const [product] = await databaseRequest(`products?id=eq.${encodeURIComponent(productId)}&select=id,name,price,description,category,image_url,volume,packaging_type,pressing_type,shelf_life_months`, {
            method: 'PATCH',
            headers: { Prefer: 'return=representation' },
            body: JSON.stringify(update)
        });
        if (!product) return res.status(404).json({ error: 'Товар не найден.' });
        await writeTelegramAudit(req, 'product.updated', 'product', productId, {
            name: product.name,
            fields: Object.keys(update),
            price: product.price
        });
        res.json({ product });
    }));

    router.delete('/panel/products/:id', authenticateBot, allowRoles('panel', 'admin'), requireOwnerChat, withErrors('Telegram product deletion failed', async (req, res) => {
        const productId = typeof req.params.id === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(req.params.id)
            ? req.params.id
            : '';
        if (!productId) return res.status(400).json({ error: 'Некорректный ID товара.' });

        const [product] = await databaseRequest(`products?id=eq.${encodeURIComponent(productId)}&select=id,name`, {
            method: 'DELETE',
            headers: { Prefer: 'return=representation' }
        });
        if (!product) return res.status(404).json({ error: 'Товар не найден.' });

        await writeTelegramAudit(req, 'product.deleted', 'product', productId, {
            name: product.name
        });
        res.json({ product });
    }));

    return router;
}

module.exports = createTelegramIntegrationRouter;
