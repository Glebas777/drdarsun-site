const express = require('express');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const BOT_TOKEN_ENV = {
    client: 'CLIENT_BOT_TOKEN',
    admin: 'ADMIN_BOT_TOKEN',
    panel: 'PANEL_BOT_TOKEN',
    auth: 'CODE_BOT_TOKEN',
    support: 'HELP_BOT_TOKEN'
};
const SUPPORT_TOPICS = ['Заказ', 'Доставка', 'Оплата', 'Товар', 'Аккаунт', 'Другое'];
const ORDER_STATUSES = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];

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
    return /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value || '');
}

function createTelegramIntegrationRouter(options = {}) {
    const router = express.Router();
    const env = options.env || process.env;
    const request = options.fetch || fetch;
    const createTransport = options.createTransport || nodemailer.createTransport;
    const supabaseUrl = env.SUPABASE_URL?.replace(/\/$/, '');
    const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
    const anonKey = env.SUPABASE_ANON_KEY;

    async function databaseRequest(path, init = {}) {
        if (!supabaseUrl || !serviceRoleKey) {
            throw new Error('Telegram integration database configuration is missing.');
        }

        const response = await request(`${supabaseUrl}/rest/v1/${path}`, {
            ...init,
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
        const expectedChatId = req.telegramBotRole === 'admin'
            ? env.MY_CHAT_ID
            : (env.M_CHAT_ID || env.PANEL_CHAT_ID);
        const suppliedChatId = req.get('X-Telegram-Chat-Id') || '';

        if (!expectedChatId || !isValidChatId(suppliedChatId) || suppliedChatId !== expectedChatId) {
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

    router.post('/admin/email/send', authenticateBot, allowRoles('admin'), requireOwnerChat, withErrors('Telegram admin email send failed', async (req, res) => {
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
        res.json({ enabled: setting?.value?.enabled === true });
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
        if (!suppliedPassword || !safeEqual(suppliedPassword, configuredPassword)) {
            return res.status(403).json({ error: 'Неверный пароль подтверждения.' });
        }
        const settings = await databaseRequest('site_runtime_settings?on_conflict=setting_key', {
            method: 'POST',
            headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
            body: JSON.stringify({
                setting_key: 'site_maintenance',
                value: { enabled: req.body.enabled },
                updated_at: new Date().toISOString()
            })
        });
        res.setHeader('Cache-Control', 'no-store');
        res.json({ enabled: settings?.[0]?.value?.enabled === true });
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

    router.get('/integration/status', authenticateBot, (req, res) => {
        const capabilities = {
            client: ['link:confirm', 'support:create', 'catalog:read', 'orders:read:own'],
            admin: ['orders:read', 'support:read', 'reviews:moderate'],
            panel: ['orders:read', 'orders:create', 'orders:update', 'products:manage'],
            auth: ['link:confirm'],
            support: ['support:create', 'support:read', 'support:reply', 'support:update', 'catalog:read']
        };
        res.setHeader('Cache-Control', 'no-store');
        res.json({ bot: req.telegramBotRole, capabilities: capabilities[req.telegramBotRole] });
    });

    router.post('/link/start', authenticateSiteUser, withErrors('Telegram link request failed', async (req, res) => {
        if (!serviceRoleKey) throw new Error('Telegram integration database configuration is missing.');
        const code = crypto.randomBytes(8).toString('hex').toUpperCase();
        const codeHash = crypto.createHmac('sha256', serviceRoleKey).update(code).digest('hex');
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
        await databaseRequest('telegram_link_requests', {
            method: 'POST',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({
                code_hash: codeHash,
                user_id: req.siteUser.id,
                email: req.siteUser.email.toLowerCase(),
                expires_at: expiresAt
            })
        });
        res.setHeader('Cache-Control', 'no-store');
        res.status(201).json({ code, expiresAt });
    }));

    router.get('/link', authenticateSiteUser, withErrors('Telegram link status lookup failed', async (req, res) => {
        const [account] = await databaseRequest(`telegram_accounts?select=telegram_username,linked_at&user_id=eq.${encodeURIComponent(req.siteUser.id)}&limit=1`);
        res.json({ account: account || null });
    }));

    router.post('/link/confirm', authenticateBot, allowRoles('client', 'auth'), withErrors('Telegram link confirmation failed', async (req, res) => {
        const chatId = req.get('X-Telegram-Chat-Id') || '';
        const code = typeof req.body?.code === 'string' ? req.body.code.trim().toUpperCase() : '';
        const username = typeof req.body?.username === 'string'
            ? req.body.username.trim().replace(/^@/, '').slice(0, 64)
            : null;
        if (!isValidChatId(chatId) || !/^[A-F0-9]{16}$/.test(code)) {
            return res.status(400).json({ error: 'Укажите корректный код привязки и Telegram chat ID.' });
        }

        const codeHash = crypto.createHmac('sha256', serviceRoleKey)
            .update(code)
            .digest('hex');
        const linked = await databaseRequest('rpc/confirm_telegram_link', {
            method: 'POST',
            body: JSON.stringify({
                p_code_hash: codeHash,
                p_telegram_chat_id: chatId,
                p_telegram_username: username
            })
        });
        if (linked !== true) {
            return res.status(400).json({ error: 'Код истёк, уже использован или аккаунт уже связан с Telegram.' });
        }
        res.json({ success: true });
    }));

    router.delete('/link', authenticateSiteUser, withErrors('Telegram unlink failed', async (req, res) => {
        await databaseRequest(`telegram_accounts?user_id=eq.${encodeURIComponent(req.siteUser.id)}`, {
            method: 'DELETE',
            headers: { Prefer: 'return=minimal' }
        });
        res.json({ success: true });
    }));

    router.get('/client/catalog', authenticateBot, allowRoles('client', 'support'), withErrors('Telegram catalog lookup failed', async (req, res) => {
        const products = await databaseRequest('products?select=id,name,price,description,category&order=name.asc&limit=100');
        res.json({ products });
    }));

    router.get('/client/orders', authenticateBot, allowRoles('client'), withErrors('Telegram customer orders lookup failed', async (req, res) => {
        const chatId = req.get('X-Telegram-Chat-Id') || '';
        if (!isValidChatId(chatId)) return res.status(400).json({ error: 'Некорректный Telegram chat ID.' });
        const [account] = await databaseRequest(`telegram_accounts?select=user_id&telegram_chat_id=eq.${encodeURIComponent(chatId)}&limit=1`);
        if (!account) return res.json({ linked: false, orders: [] });
        const orders = await databaseRequest(`orders?select=id,items,total,status,created_at&user_id=eq.${encodeURIComponent(account.user_id)}&order=created_at.desc&limit=20`);
        res.json({ linked: true, orders });
    }));

    router.get('/support/my-ticket', authenticateBot, allowRoles('client', 'support'), withErrors('Telegram customer ticket lookup failed', async (req, res) => {
        const chatId = req.get('X-Telegram-Chat-Id') || '';
        if (!isValidChatId(chatId)) return res.status(400).json({ error: 'Некорректный Telegram chat ID.' });
        const [ticket] = await databaseRequest(`telegram_support_tickets?select=id,ticket_number,topic,status,created_at,updated_at&telegram_chat_id=eq.${encodeURIComponent(chatId)}&status=eq.open&order=created_at.desc&limit=1`);
        if (!ticket) return res.json({ ticket: null, messages: [] });
        const messages = await databaseRequest(`telegram_support_messages?select=sender_role,message,created_at&ticket_id=eq.${ticket.id}&order=created_at.desc&limit=12`);
        res.json({ ticket, messages: messages.reverse() });
    }));

    router.post('/support/tickets', authenticateBot, allowRoles('client', 'support'), withErrors('Telegram support ticket creation failed', async (req, res) => {
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

    router.post('/support/tickets/:id/message', authenticateBot, allowRoles('client', 'support'), withErrors('Telegram support message failed', async (req, res) => {
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

    router.post('/support/tickets/:id/close', authenticateBot, allowRoles('client', 'support'), withErrors('Telegram customer ticket close failed', async (req, res) => {
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

    router.get('/admin/tickets', authenticateBot, allowRoles('admin'), requireOwnerChat, withErrors('Telegram admin tickets lookup failed', async (req, res) => {
        const tickets = await databaseRequest('telegram_support_tickets?select=id,ticket_number,topic,telegram_chat_id,telegram_username,status,created_at,updated_at&status=eq.open&order=updated_at.desc&limit=50');
        if (tickets.length) {
            const ids = tickets.map(ticket => ticket.id).join(',');
            const messages = await databaseRequest(`telegram_support_messages?select=ticket_id,sender_role,message,created_at&ticket_id=in.(${ids})&order=created_at.desc&limit=200`);
            const latestMessages = new Map();
            for (const message of messages) {
                if (!latestMessages.has(message.ticket_id)) latestMessages.set(message.ticket_id, message);
            }
            for (const ticket of tickets) ticket.last_message = latestMessages.get(ticket.id) || null;
        }
        res.json({ tickets });
    }));

    router.get('/admin/tickets/:id/messages', authenticateBot, allowRoles('admin'), requireOwnerChat, withErrors('Telegram admin ticket messages lookup failed', async (req, res) => {
        if (!isUuid(req.params.id)) return res.status(400).json({ error: 'Некорректный номер обращения.' });
        const messages = await databaseRequest(`telegram_support_messages?select=sender_role,message,created_at&ticket_id=eq.${req.params.id}&order=created_at.asc&limit=200`);
        res.json({ messages });
    }));

    router.post('/admin/tickets/:id/reply', authenticateBot, allowRoles('admin'), requireOwnerChat, withErrors('Telegram admin ticket reply failed', async (req, res) => {
        if (!isUuid(req.params.id)) return res.status(400).json({ error: 'Некорректный номер обращения.' });
        const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
        const agentChatId = req.get('X-Telegram-Chat-Id') || '';
        if (!message || message.length > 4000 || !isValidChatId(agentChatId)) {
            return res.status(400).json({ error: 'Укажите ответ до 4000 символов.' });
        }
        const [ticket] = await databaseRequest(`telegram_support_tickets?select=telegram_chat_id&status=eq.open&id=eq.${req.params.id}&limit=1`);
        if (!ticket) return res.status(404).json({ error: 'Открытое обращение не найдено.' });
        const saved = await databaseRequest('rpc/add_telegram_support_message', {
            method: 'POST',
            body: JSON.stringify({
                p_ticket_id: req.params.id,
                p_sender_role: 'support',
                p_telegram_chat_id: agentChatId,
                p_message: message
            })
        });
        if (saved !== true) return res.status(404).json({ error: 'Обращение уже закрыто.' });
        const [updatedTicket] = await databaseRequest(`telegram_support_tickets?select=updated_at&id=eq.${req.params.id}&limit=1`);
        const updatedAt = updatedTicket?.updated_at || null;

        const helperToken = env.HELP_BOT_TOKEN;
        if (!helperToken) return res.status(202).json({ success: true, delivered: false, updated_at: updatedAt });
        try {
            const delivery = await request(`https://api.telegram.org/bot${helperToken}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: ticket.telegram_chat_id, text: `Ответ по вашему обращению:\n\n${message}` })
            });
            const result = await delivery.json().catch(() => null);
            if (!delivery.ok || !result?.ok) {
                console.error('Telegram admin ticket reply delivery failed:', delivery.status);
                return res.status(202).json({ success: true, delivered: false, updated_at: updatedAt });
            }
        } catch {
            console.error('Telegram admin ticket reply delivery failed.');
            return res.status(202).json({ success: true, delivered: false, updated_at: updatedAt });
        }
        res.json({ success: true, delivered: true, updated_at: updatedAt });
    }));

    router.patch('/admin/tickets/:id', authenticateBot, allowRoles('admin'), requireOwnerChat, withErrors('Telegram admin ticket update failed', async (req, res) => {
        if (!isUuid(req.params.id)) return res.status(400).json({ error: 'Некорректный номер обращения.' });
        if (req.body?.status !== 'closed') return res.status(400).json({ error: 'Администратор может закрыть обращение.' });
        const updated = await databaseRequest(`telegram_support_tickets?id=eq.${req.params.id}&status=eq.open`, {
            method: 'PATCH',
            headers: { Prefer: 'return=representation' },
            body: JSON.stringify({ status: 'closed', updated_at: new Date().toISOString() })
        });
        if (!updated?.length) return res.status(404).json({ error: 'Открытое обращение не найдено.' });
        res.json({ success: true });
    }));

    router.get('/admin/reviews', authenticateBot, allowRoles('admin'), requireOwnerChat, withErrors('Telegram review moderation lookup failed', async (req, res) => {
        const reviews = await databaseRequest('brand_reviews?select=id,user_name,rating,review_text,created_at&status=eq.pending&order=created_at.asc&limit=50');
        res.json({ reviews });
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
        res.json({ success: true });
    }));

    router.get('/panel/orders', authenticateBot, allowRoles('panel'), requireOwnerChat, withErrors('Telegram panel orders lookup failed', async (req, res) => {
        const offset = Math.max(0, Math.min(100000, Number.parseInt(req.query.offset, 10) || 0));
        const orders = await databaseRequest(`orders?select=id,items,total,status,created_at&order=created_at.desc&limit=100&offset=${offset}`);
        res.json({ orders });
    }));

    router.post('/panel/orders', authenticateBot, allowRoles('panel'), requireOwnerChat, withErrors('Telegram order creation failed', async (req, res) => {
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
        res.status(201).json({ order });
    }));

    router.patch('/panel/orders/:id', authenticateBot, allowRoles('panel'), requireOwnerChat, withErrors('Telegram order update failed', async (req, res) => {
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
        const [order] = await databaseRequest(`orders?id=eq.${encodeURIComponent(orderId)}&select=id,items,total,status,created_at`, {
            method: 'PATCH',
            headers: { Prefer: 'return=representation' },
            body: JSON.stringify(update)
        });
        if (!order) return res.status(404).json({ error: 'Заказ не найден.' });
        res.json({ order });
    }));

    router.get('/panel/products', authenticateBot, allowRoles('panel'), requireOwnerChat, withErrors('Telegram product lookup failed', async (req, res) => {
        const products = await databaseRequest('products?select=id,name,price,description,category,image_url&order=name.asc&limit=200');
        res.json({ products });
    }));

    router.post('/panel/products', authenticateBot, allowRoles('panel'), requireOwnerChat, withErrors('Telegram product creation failed', async (req, res) => {
        const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
        const category = typeof req.body?.category === 'string' ? req.body.category.trim() : '';
        const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';
        const imageUrl = typeof req.body?.image_url === 'string' ? req.body.image_url.trim() : '';
        const price = Number(req.body?.price);
        if (!name || name.length > 160 || !category || category.length > 80 || description.length > 2000 || imageUrl.length > 2000 || !Number.isFinite(price) || price < 0 || price > 10000000) {
            return res.status(400).json({ error: 'Проверьте название, категорию, описание и цену товара.' });
        }
        const [product] = await databaseRequest('products?select=id,name,price,description,category,image_url', {
            method: 'POST',
            headers: { Prefer: 'return=representation' },
            body: JSON.stringify({ name, category, description, price, image_url: imageUrl })
        });
        if (!product) throw new Error('Product was not created.');
        res.status(201).json({ product });
    }));

    router.patch('/panel/products/:id', authenticateBot, allowRoles('panel'), requireOwnerChat, withErrors('Telegram product update failed', async (req, res) => {
        const productId = typeof req.params.id === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(req.params.id)
            ? req.params.id
            : '';
        if (!productId) return res.status(400).json({ error: 'Некорректный ID товара.' });
        const update = {};
        for (const field of ['name', 'category', 'description', 'image_url']) {
            if (req.body?.[field] !== undefined) {
                if (typeof req.body[field] !== 'string') return res.status(400).json({ error: `Поле ${field} должно быть текстом.` });
                const value = req.body[field].trim();
                const maxLength = field === 'name' ? 160 : field === 'category' ? 80 : 2000;
                if ((field !== 'description' && field !== 'image_url' && !value) || value.length > maxLength) {
                    return res.status(400).json({ error: `Проверьте поле ${field}.` });
                }
                update[field] = value;
            }
        }
        if (req.body?.price !== undefined) {
            const price = Number(req.body.price);
            if (!Number.isFinite(price) || price < 0 || price > 10000000) return res.status(400).json({ error: 'Проверьте цену.' });
            update.price = price;
        }
        if (!Object.keys(update).length) return res.status(400).json({ error: 'Нет полей для изменения.' });
        const [product] = await databaseRequest(`products?id=eq.${encodeURIComponent(productId)}&select=id,name,price,description,category,image_url`, {
            method: 'PATCH',
            headers: { Prefer: 'return=representation' },
            body: JSON.stringify(update)
        });
        if (!product) return res.status(404).json({ error: 'Товар не найден.' });
        res.json({ product });
    }));

    return router;
}

module.exports = createTelegramIntegrationRouter;
