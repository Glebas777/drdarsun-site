let nodeFetchPromise;
const fetch = globalThis.fetch || ((...args) => {
    nodeFetchPromise ||= import('node-fetch').then(({ default: nodeFetch }) => nodeFetch);
    return nodeFetchPromise.then(nodeFetch => nodeFetch(...args));
});
const crypto = require('crypto');
const {
    PACKAGING_TYPES,
    PRESSING_TYPES,
    SHELF_LIFE_MONTHS,
    VOLUME_OPTIONS
} = require('./oil-product-options');

const BOT_DEFINITIONS = [
    { role: 'admin', tokenEnv: 'ADMIN_BOT_TOKEN', usernameEnv: 'ADMIN_BOT_USERNAME' },
    { role: 'support', tokenEnv: 'HELP_BOT_TOKEN', usernameEnv: 'SUPPORT_BOT_USERNAME' },
    { role: 'client', tokenEnv: 'CLIENT_BOT_TOKEN', usernameEnv: 'CLIENT_BOT_USERNAME' }
];
const SUPPORT_TELEGRAM_USERNAME = 'darsunhelp';
const TOPICS = ['Заказ', 'Доставка', 'Оплата', 'Товар', 'Аккаунт', 'Другое'];
const ORDER_STATUSES = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];
const STATE_TTL = 30 * 60 * 1000;
const USAGE_WINDOW = 5 * 60 * 1000;
const NOTIFICATION_TTL = 7 * 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL = 5 * 60 * 1000;
const TELEGRAM_CHAT_SEND_INTERVAL = 1000;
const MAINTENANCE_MODE_LABELS = {
    planned: 'плановые работы',
    emergency: 'срочный техперерыв'
};
const states = new Map();
const updateQueues = new Map();
const updateRateLimits = new Map();
const telegramSendQueues = new Map();
const telegramLastSendAt = new Map();
const histories = new Map();
const assistantUsage = new Map();
const supportUsage = new Map();
const botUsernames = new Map();
const notified = { reviews: new Map() };
const configuredUsernameEnvs = new WeakSet();
let lastCleanupAt = 0;

function stateKey(role, chatId) {
    return `${role}:${chatId}`;
}

function durableStateRole(role) {
    return role === 'panel' ? 'admin' : role;
}

function getState(role, chatId) {
    const entry = states.get(stateKey(durableStateRole(role), chatId));
    if (!entry) return {};
    entry.lastUsedAt = Date.now();
    return entry.value;
}

function setState(role, chatId, state) {
    const key = stateKey(durableStateRole(role), chatId);
    if (state && Object.keys(state).length) states.set(key, { value: state, lastUsedAt: Date.now() });
    else states.delete(key);
}

function getHistory(chatId) {
    const entry = histories.get(chatId);
    if (!entry) return [];
    entry.lastUsedAt = Date.now();
    return entry.value;
}

function setHistory(chatId, history) {
    if (history.length) histories.set(chatId, { value: history, lastUsedAt: Date.now() });
    else histories.delete(chatId);
}

function cleanupExpiredEntries(now) {
    for (const [key, entry] of states) {
        if (now - entry.lastUsedAt >= STATE_TTL) states.delete(key);
    }
    for (const [key, entry] of histories) {
        if (now - entry.lastUsedAt >= STATE_TTL) histories.delete(key);
    }
    for (const [key, timestamp] of telegramLastSendAt) {
        if (now - timestamp >= STATE_TTL) telegramLastSendAt.delete(key);
    }
    for (const [key, timestamps] of assistantUsage) {
        const active = timestamps.filter(timestamp => now - timestamp < USAGE_WINDOW);
        if (active.length) assistantUsage.set(key, active);
        else assistantUsage.delete(key);
    }
    for (const [key, timestamps] of supportUsage) {
        const active = timestamps.filter(timestamp => now - timestamp < USAGE_WINDOW);
        if (active.length) supportUsage.set(key, active);
        else supportUsage.delete(key);
    }
    for (const [key, timestamps] of updateRateLimits) {
        const active = timestamps.filter(timestamp => now - timestamp < 5000);
        if (active.length) updateRateLimits.set(key, active);
        else updateRateLimits.delete(key);
    }
    for (const [key, notifiedAt] of notified.reviews) {
        if (now - notifiedAt >= NOTIFICATION_TTL) notified.reviews.delete(key);
    }
}

function cleanupExpiredEntriesIfDue() {
    const now = Date.now();
    if (now - lastCleanupAt < CLEANUP_INTERVAL) return;
    lastCleanupAt = now;
    cleanupExpiredEntries(now);
}

function cacheConfiguredBotUsernames(env) {
    if (!env || (typeof env !== 'object' && typeof env !== 'function') ||
        configuredUsernameEnvs.has(env)) return;
    configuredUsernameEnvs.add(env);
    for (const candidate of BOT_DEFINITIONS) {
        const configuredUsername = candidate.usernameEnv ? env[candidate.usernameEnv] : '';
        const username = candidate.role === 'support' && !configuredUsername
            ? SUPPORT_TELEGRAM_USERNAME
            : configuredUsername;
        if (typeof username === 'string' && /^[A-Za-z0-9_]{5,32}$/.test(username.trim())) {
            botUsernames.set(candidate.role, username.trim());
        } else {
            botUsernames.delete(candidate.role);
        }
    }
}

cacheConfiguredBotUsernames(process.env);

function isPrivateUpdate(update) {
    const chat = update.message?.chat || update.callback_query?.message?.chat;
    return chat?.type === 'private';
}

function updateChatId(update) {
    const chat = update.message?.chat || update.callback_query?.message?.chat;
    return chat?.id === undefined ? '' : String(chat.id);
}

function allowChatUpdate(role, chatId) {
    const now = Date.now();
    const key = stateKey(role, chatId);
    const recent = (updateRateLimits.get(key) || []).filter(timestamp => now - timestamp < 5000);
    if (recent.length >= 4) {
        updateRateLimits.set(key, recent);
        return false;
    }
    recent.push(now);
    updateRateLimits.set(key, recent);

    if (updateRateLimits.size > 10000) {
        for (const [candidate, timestamps] of updateRateLimits) {
            if (!timestamps.some(timestamp => now - timestamp < 5000)) updateRateLimits.delete(candidate);
        }
    }
    return true;
}

function configuredPanelChatIds(env) {
    const ownerChatId = String(env.MY_CHAT_ID || env.PANEL_CHAT_ID || env.M_CHAT_ID || '').trim();
    return ownerChatId ? [ownerChatId] : [];
}

function ownerAllowed(role, chatId, env) {
    if (role === 'admin' || role === 'panel') return configuredPanelChatIds(env).includes(chatId);
    return true;
}

function menuKeyboard(role) {
    if (role === 'support') {
        return {
            keyboard: [
                [{ text: '🧾 Частые вопросы' }, { text: '🆘 Нужен оператор' }],
                [{ text: '📨 Моё обращение' }],
                [{ text: '📂 Выбрать тему' }]
            ],
            resize_keyboard: true
        };
    }
    if (role === 'admin') {
        return {
            keyboard: [
                [{ text: '✍️ Отзывы' }, { text: '📋 Уведомления' }],
                [{ text: '📦 Заказы' }, { text: '➕ Новый заказ' }],
                [{ text: '🛍 Товары' }, { text: '➕ Новый товар' }],
                [{ text: '🧾 История' }, { text: '🛠 Техперерыв' }],
                [{ text: '🔔 Создать уведомление' }]
            ],
            resize_keyboard: true
        };
    }
    if (role === 'panel') {
        return {
            keyboard: [
                [{ text: '📦 Заказы' }, { text: '➕ Новый заказ' }],
                [{ text: '🛍 Товары' }, { text: '➕ Новый товар' }],
                [{ text: '🧾 История' }]
            ],
            resize_keyboard: true
        };
    }
    return { keyboard: [], resize_keyboard: true };
}

function inline(rows) {
    return { inline_keyboard: rows };
}

async function showAdminMaintenanceMenu(bot, chatId) {
    const { enabled, mode } = await bot.callApi('/admin/maintenance', chatId);
    const status = enabled
        ? `включён режим: ${MAINTENANCE_MODE_LABELS[mode] || MAINTENANCE_MODE_LABELS.planned}`
        : 'сайт работает';
    await bot.send(chatId, `Состояние сайта: ${status}.\nВыберите действие:`, {
        reply_markup: inline([
            [{ text: '🛠 Плановые работы', callback_data: 'adm:maint:planned' }],
            [{ text: '🚨 Срочный перерыв', callback_data: 'adm:maint:emergency' }],
            [{ text: '▶️ Возобновить сайт', callback_data: 'adm:maint:off' }]
        ])
    });
}

function safeText(value, maxLength = 1000) {
    return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, maxLength);
}

function safeError(error, token) {
    return safeText(error?.message || 'Unknown error', 300)
        .replaceAll(token, '[redacted]')
        .replace(/https:\/\/api\.telegram\.org\/bot[^/\s]+/g, 'https://api.telegram.org/bot[redacted]');
}

function userFacingError(error) {
    const message = error?.message || '';
    if (/Backend 401 at|недействительный токен Telegram/i.test(message)) {
        return 'Бот не прошёл авторизацию в API. Администратору нужно проверить соответствие токена этой роли в настройках backend.';
    }
    if (/Backend 403 at|не имеет доступа/i.test(message)) {
        return 'Для этого действия нет доступа. Проверьте, что вы используете нужного бота и правильный Telegram-аккаунт.';
    }
    if (/Backend 400 at/.test(message)) return `Запрос не принят: ${safeText(message, 500)}`;
    if (/Telegram .* failed \(401\)/.test(message)) return 'Токен этого бота недействителен. Администратору нужно проверить токен в настройках backend.';
    if (/Telegram .* failed \(400\)/.test(message)) return `Telegram не принял запрос: ${safeText(message, 500)}`;
    if (/Сервис временно недоступен|Помощник временно недоступен/.test(message)) return message;
    return 'Не удалось выполнить действие. Проверьте ввод и попробуйте ещё раз.';
}

function isRetryableBotError(error) {
    if (error?.retryable === true) return true;
    const status = Number(error?.apiStatus ?? error?.telegramStatus);
    return [408, 425, 429].includes(status) || status >= 500;
}

function formatOrders(orders) {
    if (!orders?.length) return 'Заказов пока нет.';
    return orders.slice(0, 10).map(order => {
        const id = safeText(order.id, 40);
        const total = Number.isFinite(Number(order.total)) ? `${Number(order.total)} ₽` : 'сумма не указана';
        const status = safeText(order.status || 'в обработке', 40);
        const date = order.created_at ? new Date(order.created_at).toLocaleDateString('ru-RU') : '';
        return `№ ${id}\n${total} · ${status}${date ? ` · ${date}` : ''}`;
    }).join('\n\n');
}

function createBotClient(config, env, request, processContext = null) {
    const token = env[config.tokenEnv];
    const apiBase = (env.BOT_API_BASE_URL || `http://127.0.0.1:${env.PORT || 3000}`).replace(/\/+$/, '');
    const baseTelegramUrl = `https://api.telegram.org/bot${token}`;

    async function telegram(method, body) {
        for (let attempt = 0; attempt < 2; attempt++) {
            let response;
            try {
                response = await request(`${baseTelegramUrl}/${method}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                    signal: AbortSignal.timeout(body?.timeout ? (body.timeout + 10) * 1000 : 15000)
                });
            } catch (error) {
                error.retryable = true;
                throw error;
            }
            const result = await response.json().catch(() => null);
            if (response.ok && result?.ok) return result.result;

            const error = new Error(`Telegram ${method} failed (${response.status}): ${safeText(result?.description || 'unknown error', 240)}`);
            error.telegramStatus = response.status;
            error.telegramMethod = method;
            error.retryAfter = result?.parameters?.retry_after;
            if (response.status === 429 && Number.isFinite(error.retryAfter) &&
                error.retryAfter > 0 && attempt === 0) {
                await new Promise(resolve => setTimeout(resolve, error.retryAfter * 1000));
                continue;
            }
            throw error;
        }
        throw new Error(`Telegram ${method} failed after retry.`);
    }

    async function callApi(path, chatId, init = {}) {
        const method = String(init.method || 'GET').toUpperCase();
        if (method !== 'GET' && processContext) processContext.sideEffectAttempted = true;
        let response;
        try {
            response = await request(`${apiBase}/api/telegram${path}`, {
            ...init,
            headers: {
                Authorization: `Bearer ${token}`,
                'X-Telegram-Chat-Id': String(chatId),
                'Content-Type': 'application/json',
                ...(init.headers || {})
            },
                signal: AbortSignal.timeout(15000)
            });
        } catch (error) {
            error.retryable = true;
            throw error;
        }
        const result = await response.json().catch(() => null);
        if (!response.ok) {
            const error = new Error(`Backend ${response.status} at ${path}: ${safeText(result?.error || 'unknown error', 240)}`);
            error.apiStatus = response.status;
            error.apiPath = path;
            throw error;
        }
        return result;
    }

    async function send(chatId, text, options = {}) {
        const value = String(text || '').trim() || 'Не удалось подготовить ответ.';
        for (let start = 0; start < value.length; start += 3900) {
            const end = Math.min(start + 3900, value.length);
            const payload = {
                chat_id: chatId,
                text: value.slice(start, end),
                disable_web_page_preview: true,
                ...(end === value.length ? options : {})
            };
            const key = `${config.role}:${chatId}`;
            const previous = telegramSendQueues.get(key) || Promise.resolve();
            const current = previous.catch(() => {}).then(async () => {
                const elapsed = Date.now() - (telegramLastSendAt.get(key) || 0);
                if (elapsed < TELEGRAM_CHAT_SEND_INTERVAL) {
                    await new Promise(resolve => setTimeout(resolve, TELEGRAM_CHAT_SEND_INTERVAL - elapsed));
                }
                try {
                    return await telegram('sendMessage', payload);
                } finally {
                    telegramLastSendAt.set(key, Date.now());
                }
            });
            telegramSendQueues.set(key, current);
            try {
                await current;
            } finally {
                if (telegramSendQueues.get(key) === current) telegramSendQueues.delete(key);
            }
        }
    }

    async function answerCallback(callbackId, text = '') {
        await telegram('answerCallbackQuery', { callback_query_id: callbackId, text: safeText(text, 180) });
    }

    async function editCallbackMessage(callback, text, replyMarkup) {
        await telegram('editMessageText', {
            chat_id: callback.message.chat.id,
            message_id: callback.message.message_id,
            text: String(text || '').slice(0, 3900),
            disable_web_page_preview: true,
            ...(replyMarkup ? { reply_markup: replyMarkup } : {})
        });
    }

    return {
        token,
        telegram,
        callApi,
        send,
        answerCallback,
        editCallbackMessage,
        apiBase,
        request,
        sharedSecret: env.TELEGRAM_WORKER_SHARED_SECRET
    };
}

function getBotDefinition(role) {
    return BOT_DEFINITIONS.find(definition => definition.role === role);
}

function createBotForRole(role, env, request, processContext) {
    const definition = getBotDefinition(role);
    const token = definition && typeof env[definition.tokenEnv] === 'string'
        ? env[definition.tokenEnv].trim()
        : '';
    if (!definition || !token) throw new Error(`Telegram ${role} bot is not configured.`);

    cacheConfiguredBotUsernames(env);

    return createBotClient({ ...definition, tokenEnv: '__NORMALIZED_TOKEN' }, {
        ...env,
        __NORMALIZED_TOKEN: token
    }, request, processContext);
}

async function processTelegramUpdateNow(role, update, options = {}) {
    if (!getBotDefinition(role)) throw new Error('Unknown Telegram bot role.');
    const env = options.env || process.env;
    const request = options.fetch || fetch;
    const config = { role };
    if (!isPrivateUpdate(update)) return { ignored: true };

    const chatId = updateChatId(update);
    if (!chatId) return { ignored: true };
    if (!ownerAllowed(role, chatId, env)) {
        return { ignored: true, reason: 'chat-not-allowed' };
    }
    if (!allowChatUpdate(role, chatId)) {
        console.warn(`Telegram ${role} update throttled for chat ${chatId}.`);
        return { ignored: true, reason: 'rate-limited' };
    }
    const processContext = { sideEffectAttempted: false };
    const bot = createBotForRole(role, env, request, processContext);
    try {
        if (update.callback_query) {
            await handleCallback(config, bot, update.callback_query, chatId);
        } else if (update.message) {
            await handleMessage(config, bot, update.message);
        }
    } catch (error) {
        console.error(`Telegram ${role} update failed:`, safeError(error, bot.token));
        if (options.retryOnFailure && !processContext.sideEffectAttempted && isRetryableBotError(error)) throw error;
        try {
            await bot.send(chatId, userFacingError(error));
        } catch (notificationError) {
            console.error(`Telegram ${role} error notification failed:`, safeError(notificationError, bot.token));
        }
    }
    return { processed: true };
}

function processTelegramUpdate(role, update, options = {}) {
    cleanupExpiredEntriesIfDue();
    const chatId = updateChatId(update);
    if (!chatId) return processTelegramUpdateNow(role, update, options);

    const key = stateKey(role, chatId);
    const previous = updateQueues.get(key) || Promise.resolve();
    const current = previous
        .catch(() => {})
        .then(() => processTelegramUpdateNow(role, update, options));
    updateQueues.set(key, current);
    return current.finally(() => {
        if (updateQueues.get(key) === current) updateQueues.delete(key);
    });
}

async function getMyTicket(bot, chatId) {
    return bot.callApi('/support/my-ticket', chatId);
}

function ticketContactLink(number) {
    return `mailto:drdarsunhelper@gmail.com?subject=${encodeURIComponent(`Обращение №${number}`)}`;
}

const SUPPORT_FAQ = {
    account: 'Для восстановления доступа используйте ссылку «Забыли пароль?» на странице входа. Не отправляйте пароли и коды подтверждения в чаты.',
    orders: 'Актуальные сведения о заказе можно уточнить у оператора поддержки.',
    notifications: 'Уведомления о заказах доступны на электронной почте в настройках профиля.',
    storage: 'После открытия следуйте условиям на этикетке. Масла обычно берегут от света, тепла и воздуха; урбеч, хумус и растительные напитки храните строго по маркировке.',
    products: 'Мы рассказываем о нескольких направлениях: растительные масла, урбеч из семян и орехов, хумус на основе нута и растительные напитки из семян или орехов. У хумуса своя основа — нут; состав конкретного продукта смотрите на этикетке. Наличие и цены уточняйте в каталоге сайта.'
};

async function showSupportFaq(bot, chatId, topic) {
    if (topic && SUPPORT_FAQ[topic]) {
        await bot.send(chatId, SUPPORT_FAQ[topic], { reply_markup: inline([[{ text: 'Все вопросы', callback_data: 's:faq' }]]) });
        return;
    }
    await bot.send(chatId, 'Выберите вопрос:', {
        reply_markup: inline([
            [{ text: 'Доступ к аккаунту', callback_data: 's:faq:account' }],
            [{ text: 'Заказы', callback_data: 's:faq:orders' }],
            [{ text: 'Уведомления', callback_data: 's:faq:notifications' }],
            [{ text: 'Продукты', callback_data: 's:faq:products' }],
            [{ text: 'Хранение продуктов', callback_data: 's:faq:storage' }]
        ])
    });
}

async function createTicket(bot, chatId, user, message, topic) {
    const result = await bot.callApi('/support/tickets', chatId, {
        method: 'POST',
        body: JSON.stringify({ message, topic, username: user?.username || '' })
    });
    const link = ticketContactLink(result.number);
    await bot.send(chatId,
        `Обращение №${result.number} создано${result.existing ? ' и добавлено к вашему активному обращению' : ''}.\nТема: ${topic}\n\nЕсли хотите написать лично, откройте чат с поддержкой — номер уже будет в сообщении:\n${link}`,
        { reply_markup: inline([[{ text: 'Написать на почту', url: link }]]) }
    );
    setState('support', chatId, {});
}

async function supportMessage(bot, chatId, user, message) {
    const now = Date.now();
    const supportAttempts = (supportUsage.get(chatId) || []).filter(timestamp => now - timestamp < USAGE_WINDOW);
    if (supportAttempts.length >= 20) {
        supportUsage.set(chatId, supportAttempts);
        await bot.send(chatId, 'Слишком много сообщений за короткое время. Подождите несколько минут или воспользуйтесь FAQ.');
        return;
    }
    supportAttempts.push(now);
    supportUsage.set(chatId, supportAttempts);

    const state = getState('support', chatId);
    if (state.awaitingTopicMessage) {
        await createTicket(bot, chatId, user, message, state.topic || 'Другое');
        return;
    }

    const current = await getMyTicket(bot, chatId);
    if (current.ticket) {
        await bot.callApi(`/support/tickets/${current.ticket.id}/message`, chatId, {
            method: 'POST',
            body: JSON.stringify({ message })
        });
        await bot.send(chatId, `Добавил сообщение к обращению №${current.ticket.ticket_number}. Оператор увидит его в переписке.`);
        return;
    }

    const usage = (assistantUsage.get(chatId) || []).filter(timestamp => now - timestamp < USAGE_WINDOW);
    if (usage.length >= 8) {
        assistantUsage.set(chatId, usage);
        await bot.send(chatId, 'Слишком много сообщений за короткое время. Подождите несколько минут или выберите «Нужен оператор».');
        return;
    }
    usage.push(now);
    assistantUsage.set(chatId, usage);

    const history = getHistory(chatId);
    const aiResponse = await bot.request(`${bot.apiBase}/api/gigachat`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Telegram-Worker-Secret': bot.sharedSecret || ''
        },
        body: JSON.stringify({ message, history, context: 'site', supportMode: true }),
        signal: AbortSignal.timeout(30000)
    });
    const response = await aiResponse.json().catch(() => null);
    if (!aiResponse.ok) throw new Error(response?.error || 'Помощник временно недоступен.');
    if (typeof response.reply !== 'string' || !response.reply.trim()) throw new Error(response.error || 'Помощник не ответил.');

    history.push({ role: 'user', content: message.slice(0, 1000) });
    history.push({ role: 'assistant', content: response.reply.slice(0, 1000) });
    setHistory(chatId, history.slice(-8));

    if (response.escalation?.required) {
        const recentQuestions = history
            .filter(entry => entry.role === 'user')
            .slice(-4)
            .map(entry => safeText(entry.content, 300));
        const handoffMessage = recentQuestions.length > 1
            ? `Последний вопрос: ${message}\n\nКонтекст переписки:\n${recentQuestions.slice(0, -1).join('\n')}`.slice(0, 1200)
            : message;
        await createTicket(
            bot,
            chatId,
            user,
            handoffMessage,
            TOPICS.includes(response.escalation.topic) ? response.escalation.topic : 'Другое'
        );
        return;
    }
    await bot.send(chatId, response.reply);
}

async function listAdminReviews(bot, chatId, offset = 0) {
    const result = await bot.callApi(`/admin/reviews?offset=${offset}`, chatId);
    const reviews = result.reviews || [];
    setState('admin', chatId, { flow: 'admin-review-list', offset });
    if (!reviews.length) {
        await bot.send(chatId, 'Ожидающих модерации отзывов нет.', { reply_markup: menuKeyboard('admin') });
        return;
    }
    for (const review of reviews) {
        const product = review.product_name ? `Товар: ${safeText(review.product_name, 100)}\n` : '';
        const reviewText = review.review_text ? `\n\n${safeText(review.review_text, 1800)}` : '';
        const text = `${product}${safeText(review.user_name, 80)} · ${review.rating}/5${reviewText}`;
        await bot.send(chatId, text, {
            reply_markup: inline([[{ text: '✅ Одобрить', callback_data: `adm:ra:${review.id}` }, { text: '❌ Отклонить', callback_data: `adm:rr:${review.id}` }]])
        });
    }
    const navigation = [];
    if (offset > 0) navigation.push({ text: 'Назад', callback_data: 'adm:reviews:prev' });
    if (result.hasMore) navigation.push({ text: 'Дальше', callback_data: 'adm:reviews:next' });
    if (navigation.length) await bot.send(chatId, `Модерация отзывов · страница ${Math.floor(offset / 10) + 1}`, { reply_markup: inline([navigation]) });
}

async function listAdminToasts(bot, chatId) {
    const { publicToasts = [], personalToasts = [] } = await bot.callApi('/admin/toasts', chatId);
    const notifications = [
        ...publicToasts.map(notification => ({ ...notification, scope: 'public', audience: 'Всем посетителям' })),
        ...personalToasts.map(notification => ({
            ...notification,
            scope: 'personal',
            audience: `Аккаунт ${safeText(notification.user_id, 12)}`
        }))
    ];
    setState('admin', chatId, { flow: 'admin-toasts' });
    if (!notifications.length) {
        setState('admin', chatId, {});
        await bot.send(chatId, 'Уведомлений для удаления нет.', { reply_markup: menuKeyboard('admin') });
        return;
    }

    const rows = notifications.map(notification => {
        const expiration = notification.expires_at
            ? new Date(notification.expires_at).toLocaleString('ru-RU')
            : 'без срока';
        return `${notification.scope === 'public' ? 'Публичное' : 'Личное'} · ${notification.audience}\n${safeText(notification.message, 240)}\nИстекает: ${expiration}`;
    });
    const buttons = notifications.map(notification => [{
        text: `Удалить ${notification.scope === 'public' ? 'публичное' : 'личное'} · ${safeText(notification.message, 32)}`,
        callback_data: `adm:td:${notification.scope}:${notification.id}`
    }]);
    await bot.send(chatId, `Уведомления сайта\n\n${rows.join('\n\n')}`, {
        reply_markup: inline([...buttons, [{ text: 'Готово', callback_data: 'adm:toasts:done' }]])
    });
}

async function listOrders(bot, chatId, { status = '', offset = 0 } = {}) {
    const result = await bot.callApi(`/panel/orders?offset=${offset}${status ? `&status=${encodeURIComponent(status)}` : ''}`, chatId);
    setState('panel', chatId, { flow: 'orders-list', status, offset, orders: result.orders || [] });
    if (!result.orders?.length) {
        await bot.send(chatId, 'Заказов пока нет.', { reply_markup: menuKeyboard('panel') });
        return;
    }
    const pageOrders = result.orders.slice(0, 15);
    for (const [index, order] of pageOrders.entries()) {
        const text = `Заказ ${safeText(order.id, 40)}\n${formatOrders([order])}\nПокупатель: ${safeText(order.customer_name || '—', 100)}\nПочта: ${safeText(order.customer_email || '—', 180)}\nАдрес: ${safeText(order.delivery_address || '—', 300)}\nПозиции: ${Array.isArray(order.items) ? order.items.map(item => `${safeText(item.name || item.product_id, 80)} × ${item.quantity || 1}`).join(', ') : '—'}`;
        const buttons = ORDER_STATUSES.map(status => ({
            text: `${order.status === status ? '• ' : ''}${status}`,
            callback_data: `p:o:${index}:${status}`
        }));
        await bot.send(chatId, text, { reply_markup: inline(buttons.reduce((rows, button, buttonIndex) => {
            const row = Math.floor(buttonIndex / 3);
            rows[row] ||= [];
            rows[row].push(button);
            return rows;
        }, [])) });
    }
    const filters = [{ text: 'Все', callback_data: 'p:filter:all' }, ...ORDER_STATUSES.map(value => ({ text: value, callback_data: `p:filter:${value}` }))];
    const navigation = [];
    if (offset > 0) navigation.push({ text: 'Назад', callback_data: 'p:orders:prev' });
    if (result.hasMore) navigation.push({ text: 'Дальше', callback_data: 'p:orders:next' });
    await bot.send(chatId, `Заказы${status ? ` · ${status}` : ''} · страница ${Math.floor(offset / 10) + 1}`, {
        reply_markup: inline([filters.slice(0, 3), filters.slice(3), navigation].filter(row => row.length))
    });
}

async function listAuditLog(bot, chatId, offset = 0) {
    const { entries = [], hasMore = false } = await bot.callApi(`/panel/audit?offset=${offset}`, chatId);
    setState('panel', chatId, { flow: 'audit-list', offset });
    if (!entries.length) {
        await bot.send(chatId, 'Журнал изменений пока пуст.', { reply_markup: menuKeyboard('panel') });
        return;
    }
    const actionLabels = {
        'order.created': 'Заказ создан',
        'order.updated': 'Заказ изменён',
        'product.created': 'Товар создан',
        'product.updated': 'Товар изменён',
        'product.deleted': 'Товар удалён',
        'review.moderated': 'Отзыв модерирован',
        'ticket.closed': 'Обращение закрыто',
        'toast.sent': 'Уведомление отправлено',
        'toast.deleted': 'Уведомление удалено',
        'maintenance.changed': 'Техперерыв изменён'
    };
    const lines = entries.map(entry => {
        const date = new Date(entry.created_at).toLocaleString('ru-RU');
        const action = actionLabels[entry.action] || safeText(entry.action, 80);
        const details = safeText(JSON.stringify(entry.details || {}), 280);
        return `${date}\n${action} · ${safeText(entry.entity_type, 40)} ${safeText(entry.entity_id, 48)}\n${details}`;
    });
    const navigation = [];
    if (offset > 0) navigation.push({ text: 'Назад', callback_data: 'p:audit:prev' });
    if (hasMore) navigation.push({ text: 'Дальше', callback_data: 'p:audit:next' });
    await bot.send(chatId, `История действий · страница ${Math.floor(offset / 20) + 1}\n\n${lines.join('\n\n')}`, {
        reply_markup: navigation.length ? inline([navigation]) : menuKeyboard('panel')
    });
}

const PANEL_PRODUCTS_PAGE_SIZE = 8;

async function listProducts(bot, chatId, offset = 0) {
    let pageOffset = Math.max(0, Math.floor(Number(offset) || 0));
    let result;
    do {
        result = await bot.callApi(`/panel/products?limit=${PANEL_PRODUCTS_PAGE_SIZE}&offset=${pageOffset}`, chatId);
        if (result.products?.length || pageOffset === 0) break;
        pageOffset = Math.max(0, pageOffset - PANEL_PRODUCTS_PAGE_SIZE);
    } while (true);

    const { products = [], hasMore = false } = result;
    if (!products.length) {
        await bot.send(chatId, 'Товаров нет.', { reply_markup: menuKeyboard('panel') });
        return;
    }
    const pageProducts = products.slice(0, PANEL_PRODUCTS_PAGE_SIZE);
    setState('panel', chatId, {
        flow: 'products-list',
        products: pageProducts,
        offset: pageOffset,
        hasNext: hasMore
    });
    const rows = pageProducts.map((product, index) => {
        const details = [
            `${safeText(product.volume, 30)} · ${safeText(product.packaging_type, 40)}`,
            `${safeText(product.pressing_type, 40)} · ${Number(product.shelf_life_months) || '—'} мес.`,
            `${Number(product.price)} ₽`
        ].filter(Boolean).join('\n');
        return `${safeText(product.name, 100)}\n${safeText(product.category, 60)} · ${details}`;
    });
    const buttons = pageProducts.map((_, index) => [{
        text: `Изменить ${index + 1}`,
        callback_data: `p:pe:${index}`
    }]);
    const navigation = [];
    if (pageOffset > 0) navigation.push({ text: 'Назад', callback_data: 'p:products:prev' });
    if (hasMore) navigation.push({ text: 'Дальше', callback_data: 'p:products:next' });
    if (navigation.length) buttons.push(navigation);
    await bot.send(chatId, `Товары · страница ${Math.floor(pageOffset / PANEL_PRODUCTS_PAGE_SIZE) + 1}\n\n${rows.join('\n\n')}`, {
        reply_markup: inline(buttons)
    });
}

async function startNewOrder(bot, chatId) {
    setState('panel', chatId, { flow: 'new-order-user' });
    await bot.send(chatId, 'Введите UUID аккаунта клиента на сайте. Его можно скопировать из панели пользователя.');
}

async function startNewProduct(bot, chatId) {
    const options = await bot.callApi('/panel/oil-types', chatId);
    const oils = Array.isArray(options.oils) ? options.oils : [];
    setState('panel', chatId, { flow: 'new-product-kind', oils, options });
    await bot.send(chatId, 'Выберите направление нового товара:', {
        reply_markup: inline([
            [{ text: 'Растительное масло', callback_data: 'p:product-type:oil' }],
            [{ text: 'Урбеч', callback_data: 'p:product-type:urbech' }, { text: 'Хумус', callback_data: 'p:product-type:hummus' }],
            [{ text: 'Растительное молоко', callback_data: 'p:product-type:milk' }]
        ])
    });
}

function productPreview(product) {
    const volume = typeof product.volume === 'number' ? `${product.volume} мл` : product.volume || '—';
    const shelfLife = product.shelf_life_months != null && Number.isSafeInteger(Number(product.shelf_life_months))
        ? `${Number(product.shelf_life_months)} мес.`
        : 'по маркировке';
    return `Проверьте товар перед публикацией:\n\n${safeText(product.name, 160)}\n${safeText(product.category, 80)} · ${Number(product.price)} ₽\nФасовка: ${safeText(volume, 40)}\nУпаковка: ${safeText(product.packaging_type || '—', 80)}\nСпособ обработки: ${safeText(product.pressing_type || '—', 80)}\nСрок хранения: ${shelfLife}\n\n${safeText(product.description, 700) || 'Описание не добавлено.'}\n\nИзображение: ${safeText(product.image_url, 300)}`;
}

async function processPanelText(bot, chatId, text) {
    let state = getState('panel', chatId);
    if (!state.flow) {
        await bot.send(chatId, 'Выберите действие в меню или отправьте /help.', { reply_markup: menuKeyboard('panel') });
        return;
    }
    if (text === '/cancel') {
        setState('panel', chatId, {});
        await bot.send(chatId, 'Действие отменено.', { reply_markup: menuKeyboard('panel') });
        return;
    }
    if (state.flow.startsWith('new-product-general-')) {
        const categoryByKind = {
            urbech: { category: 'Урбеч', image: 'urbech' },
            hummus: { category: 'Хумус', image: 'hummus' },
            milk: { category: 'Растительное молоко', image: 'plant-milk' }
        };
        const kind = categoryByKind[state.product?.kind];
        if (!kind) {
            setState('panel', chatId, {});
            await bot.send(chatId, 'Сценарий добавления товара устарел. Запустите /newproduct заново.');
            return;
        }
        if (state.flow === 'new-product-general-name') {
            if (text.length < 2 || text.length > 160 || /[\u0000-\u001f\u007f]/.test(text)) {
                await bot.send(chatId, 'Введите название длиной от 2 до 160 символов.');
                return;
            }
            state.product.name = text;
            state.flow = 'new-product-general-volume';
            setState('panel', chatId, state);
            await bot.send(chatId, 'Укажите фасовку с единицей измерения, например 200 г или 750 мл.');
            return;
        }
        if (state.flow === 'new-product-general-volume') {
            const match = /^(\d{1,4})\s*(мл|г)$/i.exec(text);
            const amount = match ? Number(match[1]) : Number.NaN;
            if (!Number.isSafeInteger(amount) || amount < 10 || amount > 5000) {
                await bot.send(chatId, 'Введите фасовку от 10 до 5000 г или мл, например 200 г.');
                return;
            }
            state.product.volume = `${amount} ${match[2].toLowerCase()}`;
            state.flow = 'new-product-general-packaging';
            setState('panel', chatId, state);
            await bot.send(chatId, 'Укажите тип упаковки, например банка или бутылка.');
            return;
        }
        if (state.flow === 'new-product-general-packaging') {
            if (text.length < 2 || text.length > 80 || /[\u0000-\u001f\u007f]/.test(text)) {
                await bot.send(chatId, 'Введите название упаковки длиной от 2 до 80 символов.');
                return;
            }
            state.product.packaging_type = text;
            state.flow = 'new-product-general-processing';
            setState('panel', chatId, state);
            await bot.send(chatId, 'Кратко укажите обработку/приготовление по вашей рецептуре или /skip.');
            return;
        }
        if (state.flow === 'new-product-general-processing') {
            if (text !== '/skip' && (text.length > 80 || /[\u0000-\u001f\u007f]/.test(text))) {
                await bot.send(chatId, 'Слишком длинное описание обработки. Максимум 80 символов или /skip.');
                return;
            }
            state.product.pressing_type = text === '/skip' ? null : text;
            state.flow = 'new-product-general-shelf-life';
            setState('panel', chatId, state);
            await bot.send(chatId, 'Укажите срок хранения в месяцах с маркировки или /skip, если он ещё не определён.');
            return;
        }
        if (state.flow === 'new-product-general-shelf-life') {
            const months = text === '/skip' ? null : Number(text);
            if (months !== null && (!Number.isSafeInteger(months) || months < 1 || months > 60)) {
                await bot.send(chatId, 'Введите целое число месяцев от 1 до 60 или /skip.');
                return;
            }
            state.product.shelf_life_months = months;
            state.flow = 'new-product-price';
            setState('panel', chatId, state);
            await bot.send(chatId, 'Введите цену товара в рублях (от 1 до 10 000 000).');
            return;
        }
    }
    if (state.flow === 'new-order-user') {
        if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(text)) {
            await bot.send(chatId, 'Похоже, это не UUID. Проверьте и отправьте ещё раз или /cancel.');
            return;
        }
        const { products = [] } = await bot.callApi('/panel/products?limit=20', chatId);
        state = { flow: 'new-order-products', userId: text, products: products.slice(0, 20), items: [] };
        setState('panel', chatId, state);
        if (!state.products.length) {
            setState('panel', chatId, {});
            await bot.send(chatId, 'Нельзя создать заказ: в каталоге пока нет товаров.');
            return;
        }
        const buttons = state.products.map((product, index) => [{ text: `${safeText(product.name, 50)} · ${Number(product.price)} ₽`, callback_data: `p:add:${index}` }]);
        buttons.push([{ text: 'Готово', callback_data: 'p:done' }]);
        await bot.send(chatId, 'Выберите товары для заказа. После добавления позиций нажмите «Готово».', { reply_markup: inline(buttons) });
        return;
    }
    if (state.flow === 'new-order-quantity') {
        const quantity = Number(text);
        if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 99) {
            await bot.send(chatId, 'Введите целое количество от 1 до 99.');
            return;
        }
        const product = state.products[state.selectedProductIndex];
        state.items.push({ product_id: product.id, product_name: product.name, quantity });
        delete state.flow;
        delete state.selectedProductIndex;
        setState('panel', chatId, state);
        await bot.send(chatId, `${safeText(product.name, 100)} × ${quantity} добавлено. Возвращайтесь к списку товаров и нажмите «Готово».`);
        return;
    }
    if (state.flow === 'new-product-volume-custom') {
        const volume = Number(text);
        if (!Number.isSafeInteger(volume) || volume < 10 || volume > 5000) {
            await bot.send(chatId, 'Введите целый объём от 10 до 5000 мл.');
            return;
        }
        state.product.volume = volume;
        state.product.name = `${state.product.oil_name} · ${volume} мл`;
        state.flow = 'new-product-price';
        setState('panel', chatId, state);
        await bot.send(chatId, 'Введите цену товара в рублях (от 1 до 10 000 000).');
        return;
    }
    if (state.flow === 'new-product-price' || state.flow === 'new-product-description' || state.flow === 'new-product-image') {
        const product = { ...state.product };
        if (state.flow === 'new-product-price') {
            const price = Number(text.replace(',', '.'));
            if (!Number.isFinite(price) || price <= 0 || price > 10000000) {
                await bot.send(chatId, 'Введите цену числом больше 0 и не выше 10 000 000.');
                return;
            }
            product.price = price;
            state.product = product;
            state.flow = 'new-product-description';
            setState('panel', chatId, state);
            await bot.send(chatId, 'Отправьте описание товара до 2000 символов или /skip.');
            return;
        }
        if (state.flow === 'new-product-description') {
            if (text.length > 2000) {
                await bot.send(chatId, 'Описание слишком длинное. Максимум 2000 символов.');
                return;
            }
            product.description = text === '/skip' ? '' : text;
            state.product = product;
            state.flow = 'new-product-image';
            setState('panel', chatId, state);
            await bot.send(chatId, 'Отправьте URL фото товара или /skip, чтобы использовать подходящую иллюстрацию.');
            return;
        }
        if (text !== '/skip' && !/^(?:https?:\/\/\S+|assets\/images\/(?:oils\/[a-z-]+|encyclopedia\/[a-z-]+)\.svg)$/i.test(text)) {
            await bot.send(chatId, 'Отправьте ссылку https://…, путь к иллюстрации продукции или /skip.');
            return;
        }
        if (text !== '/skip') product.image_url = text;
        state.product = product;
        setState('panel', chatId, { ...state, flow: 'confirm-new-product', product });
        await bot.send(chatId, productPreview(product), {
            reply_markup: inline([[{ text: 'Опубликовать', callback_data: 'p:product:create:confirm' }, { text: 'Отмена', callback_data: 'p:product:create:cancel' }]])
        });
        return;
    }
    if (state.flow === 'edit-product-value') {
        const { productId, field } = state;
        let value = text;
        if (field === 'price') {
            value = Number(text.replace(',', '.'));
            if (!Number.isFinite(value) || value < 0 || value > 10000000) {
                await bot.send(chatId, 'Введите цену числом от 0 до 10 000 000.');
                return;
            }
        } else if (field === 'volume') {
            const match = /^(\d{1,4})\s*(мл|г)?$/i.exec(text);
            const volume = match ? Number(match[1]) : Number.NaN;
            if (!Number.isSafeInteger(volume) || volume < 10 || volume > 5000) {
                await bot.send(chatId, 'Введите фасовку от 10 до 5000 г или мл, например 200 г.');
                return;
            }
            value = `${volume} ${(match[2] || 'мл').toLowerCase()}`;
        } else if (field === 'shelf_life_months') {
            if (text === '/skip') {
                value = null;
            } else {
                const match = /^(\d{1,2})(?:\s*мес\.?)?$/i.exec(text);
                const months = match ? Number(match[1]) : Number.NaN;
                if (!Number.isSafeInteger(months) || months < 1 || months > 60) {
                    await bot.send(chatId, 'Укажите срок от 1 до 60 месяцев или /skip, если он ещё не определён.');
                    return;
                }
                value = months;
            }
        } else {
            const maxLength = field === 'name' ? 160 :
                ['category', 'packaging_type', 'pressing_type'].includes(field) ? 80 : 2000;
            if (value.length > maxLength || (field !== 'description' && field !== 'image_url' && !value) ||
                (['packaging_type', 'pressing_type'].includes(field) && /[\u0000-\u001f\u007f]/.test(value))) {
                await bot.send(chatId, `Проверьте значение: максимум ${maxLength} символов.`);
                return;
            }
            if (field === 'image_url' && value &&
                !/^(?:https?:\/\/\S+|assets\/images\/(?:oils\/[a-z-]+|encyclopedia\/[a-z-]+)\.svg)$/i.test(value)) {
                await bot.send(chatId, 'Укажите URL https://… или путь к иллюстрации продукции.');
                return;
            }
        }
        setState('panel', chatId, { flow: 'confirm-product-update', productId, field, value });
        await bot.send(chatId, `Подтвердите изменение товара.\nПоле: ${field}\nНовое значение: ${safeText(value, 700)}`, {
            reply_markup: inline([[{ text: 'Сохранить', callback_data: 'p:product:update:confirm' }, { text: 'Отмена', callback_data: 'p:product:update:cancel' }]])
        });
    }
}

async function handleCallback(config, bot, callback, chatId) {
    if (config.role === 'admin' && String(callback.data || '').startsWith('p:')) {
        config = { role: 'panel' };
    }
    const data = String(callback.data || '');
    await bot.answerCallback(callback.id);
    if (data === 'p:products:next' || data === 'p:products:prev') {
        const state = getState('panel', chatId);
        if (state.flow !== 'products-list') return;
        if (data.endsWith('next') && state.hasNext !== true) return;
        if (data.endsWith('prev') && state.offset < PANEL_PRODUCTS_PAGE_SIZE) return;
        const offset = Math.max(0, state.offset + (data.endsWith('next') ? PANEL_PRODUCTS_PAGE_SIZE : -PANEL_PRODUCTS_PAGE_SIZE));
        await listProducts(bot, chatId, offset);
        return;
    }
    if (config.role === 'support') {
        if (data === 's:faq') {
            await showSupportFaq(bot, chatId);
        } else if (data.startsWith('s:faq:')) {
            await showSupportFaq(bot, chatId, data.slice('s:faq:'.length));
        } else if (data === 's:close') {
            const { ticket } = await getMyTicket(bot, chatId);
            if (!ticket) {
                await bot.send(chatId, 'У вас нет открытого обращения.');
                return;
            }
            setState('support', chatId, { flow: 'confirm-close-ticket', ticketId: ticket.id });
            await bot.send(chatId, `Закрыть обращение №${ticket.ticket_number}?`, {
                reply_markup: inline([[{ text: 'Подтвердить закрытие', callback_data: 's:close:confirm' }, { text: 'Отмена', callback_data: 's:close:cancel' }]])
            });
        } else if (data === 's:close:cancel') {
            setState('support', chatId, {});
            await bot.editCallbackMessage(callback, 'Обращение оставлено открытым.');
        } else if (data === 's:close:confirm') {
            const state = getState('support', chatId);
            if (state.flow !== 'confirm-close-ticket' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(state.ticketId || '')) return;
            const { ticket } = await getMyTicket(bot, chatId);
            if (!ticket || ticket.id !== state.ticketId) {
                setState('support', chatId, {});
                await bot.editCallbackMessage(callback, 'Открытое обращение уже не найдено.');
                return;
            }
            await bot.callApi(`/support/tickets/${ticket.id}/close`, chatId, { method: 'POST', body: '{}' });
            setState('support', chatId, {});
            await bot.editCallbackMessage(callback, `Обращение №${ticket.ticket_number} закрыто.`);
        } else if (data.startsWith('s:topic:')) {
            const topicIndex = Number(data.slice('s:topic:'.length));
            const topic = TOPICS[topicIndex];
            if (!topic) return;
            setState('support', chatId, { topic, awaitingTopicMessage: true });
            await bot.send(chatId, `Тема «${topic}». Кратко опишите вопрос, и я передам его оператору.`);
        }
        return;
    }
    if (config.role === 'admin') {
        if (data === 'adm:reviews:next' || data === 'adm:reviews:prev') {
            const state = getState('admin', chatId);
            if (state.flow !== 'admin-review-list') return;
            await listAdminReviews(bot, chatId, Math.max(0, state.offset + (data.endsWith('next') ? 10 : -10)));
            return;
        }
        if (data === 'adm:review:cancel' || data === 'adm:toast:delete:cancel') {
            setState('admin', chatId, {});
            await bot.editCallbackMessage(callback, 'Действие отменено.');
            return;
        }
        if (data === 'adm:toasts:done') {
            setState('admin', chatId, {});
            await bot.editCallbackMessage(callback, 'Готово.');
            return;
        }
        if (data === 'adm:review:confirm') {
            const state = getState('admin', chatId);
            if (state.flow !== 'confirm-review') return;
            await bot.callApi(`/admin/reviews/${state.reviewId}`, chatId, {
                method: 'PATCH',
                body: JSON.stringify({ status: state.status })
            });
            setState('admin', chatId, {});
            await bot.editCallbackMessage(callback, state.status === 'approved' ? 'Отзыв опубликован.' : 'Отзыв отклонён.');
            return;
        }
        if (data === 'adm:toast:delete:confirm') {
            const state = getState('admin', chatId);
            if (state.flow !== 'confirm-toast-delete') return;
            try {
                await bot.callApi(`/admin/toasts/${state.scope}/${encodeURIComponent(state.toastId)}`, chatId, {
                    method: 'DELETE'
                });
            } catch (error) {
                setState('admin', chatId, state);
                throw error;
            }
            setState('admin', chatId, {});
            await bot.editCallbackMessage(callback, 'Уведомление удалено.');
            await listAdminToasts(bot, chatId);
            return;
        }
        const toastDeleteMatch = /^adm:td:(public|personal):([0-9a-f-]{36})$/i.exec(data);
        if (toastDeleteMatch) {
            const [, scope, toastId] = toastDeleteMatch;
            setState('admin', chatId, { flow: 'confirm-toast-delete', scope, toastId });
            await bot.send(chatId, 'Точно удалить это уведомление с сайта?', {
                reply_markup: inline([[
                    { text: 'Удалить уведомление', callback_data: 'adm:toast:delete:confirm' },
                    { text: 'Отмена', callback_data: 'adm:toast:delete:cancel' }
                ]])
            });
            return;
        }
        if (data === 'adm:toast') {
            setState('admin', chatId, { flow: 'toast-recipient' });
            await bot.send(chatId, 'Кому показать уведомление? Отправьте email аккаунта или `all` для публичного объявления всем посетителям сайта, включая гостей. Для отмены: /cancel.');
            return;
        }
        if (data === 'adm:toast:cancel') {
            setState('admin', chatId, {});
            await bot.send(chatId, 'Создание уведомления отменено.', { reply_markup: menuKeyboard('admin') });
            return;
        }
        if (data.startsWith('adm:toast:kind:')) {
            const state = getState('admin', chatId);
            const kind = data.slice('adm:toast:kind:'.length);
            if (state.flow !== 'toast-kind' || !['info', 'success', 'warning', 'error'].includes(kind)) return;
            const nextState = { ...state, flow: 'toast-confirm', kind };
            setState('admin', chatId, nextState);
            const recipient = nextState.target === 'all' ? 'всем посетителям сайта, включая гостей' : safeText(nextState.target, 160);
            await bot.send(chatId, `Проверьте уведомление:\n\nКому: ${recipient}\nСтиль: ${kind}\nПоказывать: ${nextState.durationSeconds} сек.\n\n${safeText(nextState.message, 500)}`, {
                reply_markup: inline([[{ text: '✅ Отправить', callback_data: 'adm:toast:send' }, { text: 'Отмена', callback_data: 'adm:toast:cancel' }]])
            });
            return;
        }
        if (data === 'adm:toast:send') {
            const state = getState('admin', chatId);
            if (state.flow !== 'toast-confirm') return;
            const result = await bot.callApi('/admin/toasts/send', chatId, {
                method: 'POST',
                body: JSON.stringify({
                    target: state.target,
                    message: state.message,
                    kind: state.kind,
                    durationSeconds: state.durationSeconds
                })
            });
            setState('admin', chatId, {});
            await bot.send(chatId, result.broadcast
                ? `Публичное уведомление опубликовано для посетителей сайта.\nСрок показа: ${result.durationSeconds} сек.`
                : `Уведомление создано.\nПолучателей: ${result.sent}\nСрок показа: ${result.durationSeconds} сек.`, { reply_markup: menuKeyboard('admin') });
            return;
        }
        if (data === 'adm:toasts') return listAdminToasts(bot, chatId);
        if (data === 'adm:maintenance') {
            return showAdminMaintenanceMenu(bot, chatId);
        }
        if (['adm:maint:on', 'adm:maint:off', 'adm:maint:planned', 'adm:maint:emergency'].includes(data)) {
            const enabled = data !== 'adm:maint:off';
            const mode = data === 'adm:maint:emergency' ? 'emergency' : 'planned';
            setState('admin', chatId, { flow: 'maintenance-password', enabled, mode });
            const action = enabled
                ? `включить режим «${MAINTENANCE_MODE_LABELS[mode]}» для всего сайта`
                : 'снять техперерыв и снова открыть сайт';
            await bot.send(chatId, `Подтвердите: ${action}?\n\nДля подтверждения отправьте пароль SITE_MAINTENANCE_PASSWORD. Не пересылайте его и не отправляйте в групповой чат. Для отмены: /cancel.`);
            return;
        }
        if (data === 'adm:reviews') return listAdminReviews(bot, chatId);
        const [, action, id] = data.split(':');
        if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return;
        if (action === 'ra' || action === 'rr') {
            const status = action === 'ra' ? 'approved' : 'rejected';
            setState('admin', chatId, { flow: 'confirm-review', reviewId: id, status });
            await bot.send(chatId, `${status === 'approved' ? 'Опубликовать' : 'Отклонить'} этот отзыв?`, {
                reply_markup: inline([[{ text: 'Подтвердить', callback_data: 'adm:review:confirm' }, { text: 'Отмена', callback_data: 'adm:review:cancel' }]])
            });
        }
        return;
    }

    if (config.role === 'panel' || config.role === 'admin') {
        const productTypeMatch = /^p:product-type:(oil|urbech|hummus|milk)$/.exec(data);
        if (productTypeMatch) {
            const state = getState('panel', chatId);
            if (state.flow !== 'new-product-kind') return;
            const kind = productTypeMatch[1];
            if (kind === 'oil') {
                if (!state.oils?.length) {
                    await bot.send(chatId, 'Список масел пока не настроен. Попробуйте позже или выберите другое направление.');
                    return;
                }
                setState('panel', chatId, { ...state, flow: 'new-product-oil' });
                const rows = [];
                for (let index = 0; index < state.oils.length; index += 2) {
                    rows.push(state.oils.slice(index, index + 2).map((oil, offset) => ({
                        text: safeText(oil.name, 28),
                        callback_data: `p:oil:${index + offset}`
                    })));
                }
                await bot.editCallbackMessage(callback, 'Выбрано: растительное масло.');
                await bot.send(chatId, 'Выберите масло из справочника. Настройки товара можно отменить командой /cancel.', {
                    reply_markup: inline(rows)
                });
                return;
            }
            const categories = {
                urbech: 'Урбеч',
                hummus: 'Хумус',
                milk: 'Растительное молоко'
            };
            const imageName = kind === 'milk' ? 'plant-milk' : kind;
            const product = {
                kind,
                category: categories[kind],
                image_url: `assets/images/encyclopedia/${imageName}.svg`
            };
            setState('panel', chatId, { ...state, product, flow: 'new-product-general-name' });
            await bot.editCallbackMessage(callback, `Выбрано направление: ${categories[kind]}.`);
            await bot.send(chatId, 'Введите название товара. Для отмены отправьте /cancel.');
            return;
        }
        if (data === 'p:products:next' || data === 'p:products:prev') {
            const state = getState('panel', chatId);
            if (state.flow !== 'products-list') return;
            if (data.endsWith('next') && state.hasNext !== true) return;
            if (data.endsWith('prev') && state.offset < PANEL_PRODUCTS_PAGE_SIZE) return;
            const offset = Math.max(0, state.offset + (data.endsWith('next') ? PANEL_PRODUCTS_PAGE_SIZE : -PANEL_PRODUCTS_PAGE_SIZE));
            await listProducts(bot, chatId, offset);
            return;
        }
        const oilMatch = /^p:oil:(\d{1,2})$/.exec(data);
        if (oilMatch) {
            const state = getState('panel', chatId);
            const oil = state.flow === 'new-product-oil' ? state.oils?.[Number(oilMatch[1])] : null;
            if (!oil) return;
            const product = {
                oil_id: oil.id,
                name: oil.name,
                category: oil.category,
                image_url: oil.image_url,
                oil_name: oil.name,
                description: ''
            };
            const nextState = { ...state, flow: 'new-product-packaging', product };
            setState('panel', chatId, nextState);
            const rows = nextState.options.packagingTypes.map((option, index) => [{
                text: option,
                callback_data: `p:product:packaging:${index}`
            }]);
            await bot.editCallbackMessage(callback, `Выбрано: ${safeText(oil.name, 100)}.`);
            await bot.send(chatId, 'Выберите тип упаковки:', { reply_markup: inline(rows) });
            return;
        }
        const productOptionMatch = /^p:product:(packaging|pressing|shelf-life|volume):(\d+|custom)$/.exec(data);
        if (productOptionMatch) {
            const state = getState('panel', chatId);
            const [, step, rawValue] = productOptionMatch;
            const flowByStep = {
                packaging: 'new-product-packaging',
                pressing: 'new-product-pressing',
                'shelf-life': 'new-product-shelf-life',
                volume: 'new-product-volume'
            };
            if (state.flow !== flowByStep[step]) return;
            if (step === 'volume' && rawValue === 'custom') {
                setState('panel', chatId, { ...state, flow: 'new-product-volume-custom' });
                await bot.editCallbackMessage(callback, 'Укажите объём вручную.');
                await bot.send(chatId, 'Введите целый объём от 10 до 5000 мл. Для отмены отправьте /cancel.');
                return;
            }
            const optionsByStep = {
                packaging: state.options?.packagingTypes,
                pressing: state.options?.pressingTypes,
                'shelf-life': state.options?.shelfLifeMonths,
                volume: state.options?.volumes
            };
            const option = optionsByStep[step]?.[Number(rawValue)];
            if (option === undefined) return;
            const product = { ...state.product };
            const propertyByStep = {
                packaging: 'packaging_type',
                pressing: 'pressing_type',
                'shelf-life': 'shelf_life_months',
                volume: 'volume'
            };
            product[propertyByStep[step]] = option;
            if (step === 'volume') {
                product.name = `${product.oil_name} · ${option} мл`;
                setState('panel', chatId, { ...state, product, flow: 'new-product-price' });
                await bot.editCallbackMessage(callback, `Объём: ${option} мл.`);
                await bot.send(chatId, 'Введите цену товара в рублях (от 1 до 10 000 000).');
                return;
            }
            const nextStep = {
                packaging: 'pressing',
                pressing: 'shelf-life',
                'shelf-life': 'volume'
            }[step];
            setState('panel', chatId, { ...state, product, flow: flowByStep[nextStep] });
            const choices = {
                pressing: state.options.pressingTypes,
                'shelf-life': state.options.shelfLifeMonths,
                volume: state.options.volumes
            }[nextStep];
            const buttonStep = nextStep === 'shelf-life' ? 'shelf-life' : nextStep;
            const rows = choices.map((value, index) => [{
                text: nextStep === 'shelf-life' ? `${value} мес.` : nextStep === 'volume' ? `${value} мл` : value,
                callback_data: `p:product:${buttonStep}:${index}`
            }]);
            if (nextStep === 'volume') rows.push([{ text: 'Другой объём', callback_data: 'p:product:volume:custom' }]);
            const selectedLabel = step === 'shelf-life' ? `${option} мес.` : option;
            await bot.editCallbackMessage(callback, `${step === 'shelf-life' ? 'Срок хранения' : 'Выбрано'}: ${safeText(selectedLabel, 80)}.`);
            await bot.send(chatId, nextStep === 'pressing'
                ? 'Выберите способ обработки / отжима:'
                : nextStep === 'shelf-life'
                    ? 'Выберите срок хранения по маркировке вашего продукта:'
                    : 'Выберите объём или укажите свой:', { reply_markup: inline(rows) });
            return;
        }
        if (data === 'p:audit:next' || data === 'p:audit:prev') {
            const state = getState('panel', chatId);
            if (state.flow !== 'audit-list') return;
            await listAuditLog(bot, chatId, Math.max(0, state.offset + (data.endsWith('next') ? 20 : -20)));
            return;
        }
        if (data.startsWith('p:filter:')) {
            const status = data.slice('p:filter:'.length);
            if (status !== 'all' && !ORDER_STATUSES.includes(status)) return;
            await listOrders(bot, chatId, { status: status === 'all' ? '' : status, offset: 0 });
            return;
        }
        if (data === 'p:orders:next' || data === 'p:orders:prev') {
            const state = getState('panel', chatId);
            if (state.flow !== 'orders-list') return;
            await listOrders(bot, chatId, {
                status: state.status,
                offset: Math.max(0, state.offset + (data.endsWith('next') ? 10 : -10))
            });
            return;
        }
        if (data === 'p:status:confirm') {
            const state = getState('panel', chatId);
            if (state.flow !== 'confirm-order-status') return;
            await bot.callApi(`/panel/orders/${encodeURIComponent(state.orderId)}`, chatId, {
                method: 'PATCH',
                body: JSON.stringify({ status: state.status })
            });
            setState('panel', chatId, {});
            await bot.editCallbackMessage(callback, `Статус заказа изменён: ${state.status}.`);
            return;
        }
        if (data === 'p:status:cancel' || data === 'p:product:create:cancel' ||
            data === 'p:product:update:cancel' || data === 'p:product:delete:cancel') {
            setState('panel', chatId, {});
            await bot.editCallbackMessage(callback, 'Действие отменено.');
            return;
        }
        if (data === 'p:product:create:confirm') {
            const state = getState('panel', chatId);
            if (state.flow !== 'confirm-new-product') return;
            setState('panel', chatId, { ...state, flow: 'creating-new-product' });
            let result;
            try {
                result = await bot.callApi('/panel/products', chatId, {
                    method: 'POST',
                    body: JSON.stringify(state.product)
                });
            } catch (error) {
                setState('panel', chatId, { ...state, flow: 'confirm-new-product' });
                throw error;
            }
            setState('panel', chatId, { flow: 'panel-home' });
            await bot.editCallbackMessage(callback, `Товар опубликован: ${safeText(result.product.name, 160)} · ${Number(result.product.price)} ₽`);
            return;
        }
        if (data === 'p:product:update:confirm') {
            const state = getState('panel', chatId);
            if (state.flow !== 'confirm-product-update') return;
            await bot.callApi(`/panel/products/${encodeURIComponent(state.productId)}`, chatId, {
                method: 'PATCH',
                body: JSON.stringify({ [state.field]: state.value })
            });
            setState('panel', chatId, {});
            await bot.editCallbackMessage(callback, 'Изменение товара сохранено.');
            return;
        }
        if (data === 'p:product:delete:confirm') {
            const state = getState('panel', chatId);
            if (state.flow !== 'confirm-product-delete') return;
            setState('panel', chatId, { ...state, flow: 'deleting-product' });
            try {
                await bot.callApi(`/panel/products/${encodeURIComponent(state.productId)}`, chatId, {
                    method: 'DELETE'
                });
            } catch (error) {
                setState('panel', chatId, { ...state, flow: 'confirm-product-delete' });
                throw error;
            }
            setState('panel', chatId, {});
            await bot.editCallbackMessage(callback, `Товар «${safeText(state.productName, 120)}» удалён.`);
            await listProducts(bot, chatId, state.offset || 0);
            return;
        }
        if (data === 'p:done') {
            const state = getState('panel', chatId);
            if (state.flow !== 'new-order-products' || !state.items.length) {
                await bot.send(chatId, 'Добавьте хотя бы один товар, прежде чем продолжить.');
                return;
            }
            const rows = state.items.map(item => `${safeText(item.product_name || item.product_id, 100)} × ${item.quantity}`);
            setState('panel', chatId, { ...state, flow: 'confirm-order' });
            await bot.send(chatId, `Подтвердите новый заказ:\n\n${rows.join('\n')}`, {
                reply_markup: inline([[{ text: '✅ Создать заказ', callback_data: 'p:confirm' }, { text: 'Отмена', callback_data: 'p:cancel' }]])
            });
            return;
        }
        if (data === 'p:cancel') {
            setState('panel', chatId, {});
            await bot.send(chatId, 'Действие отменено.', { reply_markup: menuKeyboard('panel') });
            return;
        }
        if (data === 'p:confirm') {
            const state = getState('panel', chatId);
            if (state.flow !== 'confirm-order') return;
            const result = await bot.callApi('/panel/orders', chatId, {
                method: 'POST',
                body: JSON.stringify({ user_id: state.userId, items: state.items })
            });
            setState('panel', chatId, {});
            await bot.send(chatId, `Заказ №${safeText(result.order.id, 40)} создан. Сумма: ${Number(result.order.total)} ₽.`, { reply_markup: menuKeyboard('panel') });
            return;
        }
        const addMatch = /^p:add:(\d+)$/.exec(data);
        if (addMatch) {
            const state = getState('panel', chatId);
            const index = Number(addMatch[1]);
            if (state.flow !== 'new-order-products' || !state.products?.[index]) return;
            state.flow = 'new-order-quantity';
            state.selectedProductIndex = index;
            setState('panel', chatId, state);
            await bot.send(chatId, `Сколько «${safeText(state.products[index].name, 100)}» добавить? (1–99)`);
            return;
        }
        const statusMatch = /^p:o:(\d{1,2}):(pending|processing|shipped|delivered|cancelled)$/.exec(data);
        if (statusMatch) {
            const orderId = getState('panel', chatId).orders?.[Number(statusMatch[1])]?.id;
            if (!orderId) return;
            setState('panel', chatId, { flow: 'confirm-order-status', orderId, status: statusMatch[2] });
            await bot.send(chatId, `Подтвердите новый статус заказа ${safeText(orderId, 40)}: ${statusMatch[2]}?`, {
                reply_markup: inline([[{ text: 'Подтвердить', callback_data: 'p:status:confirm' }, { text: 'Отмена', callback_data: 'p:status:cancel' }]])
            });
            return;
        }
        const editMatch = /^p:pe:(\d+)$/.exec(data);
        if (editMatch) {
            const state = getState('panel', chatId);
            const product = state.products?.[Number(editMatch[1])];
            if (!product) return;
            const fields = [
                ['name', 'Название'],
                ['price', 'Цена'],
                ['volume', 'Объём'],
                ['packaging_type', 'Упаковка'],
                ['pressing_type', 'Отжим'],
                ['shelf_life_months', 'Срок хранения'],
                ['category', 'Категория'],
                ['description', 'Описание'],
                ['image_url', 'Изображение']
            ];
            await bot.send(chatId, `Что изменить у «${safeText(product.name, 100)}»?`, {
                reply_markup: inline([
                    ...fields.map(([field, label]) => [{ text: label, callback_data: `p:pf:${editMatch[1]}:${field}` }]),
                    [{ text: 'Удалить товар', callback_data: `p:pd:${editMatch[1]}` }]
                ])
            });
            return;
        }
        const deleteProductMatch = /^p:pd:(\d+)$/.exec(data);
        if (deleteProductMatch) {
            const state = getState('panel', chatId);
            const product = state.products?.[Number(deleteProductMatch[1])];
            if (!product) return;
            setState('panel', chatId, {
                flow: 'confirm-product-delete',
                productId: product.id,
                productName: product.name,
                offset: state.offset
            });
            await bot.send(chatId, `Удалить товар «${safeText(product.name, 120)}»? Это действие нельзя отменить.`, {
                reply_markup: inline([[
                    { text: 'Удалить товар', callback_data: 'p:product:delete:confirm' },
                    { text: 'Отмена', callback_data: 'p:product:delete:cancel' }
                ]])
            });
            return;
        }
        const fieldMatch = /^p:pf:(\d+):(name|price|volume|packaging_type|pressing_type|shelf_life_months|category|description|image_url)$/.exec(data);
        if (fieldMatch) {
            const state = getState('panel', chatId);
            const product = state.products?.[Number(fieldMatch[1])];
            if (!product) return;
            const labels = {
                name: 'новое название',
                price: 'новую цену',
                volume: 'новый объём в мл',
                packaging_type: 'тип упаковки',
                pressing_type: 'способ обработки / приготовления',
                shelf_life_months: 'срок хранения в месяцах или /skip',
                category: 'новую категорию',
                description: 'новое описание',
                image_url: 'URL изображения, путь к иллюстрации продукции или пустое значение'
            };
            setState('panel', chatId, { flow: 'edit-product-value', productId: product.id, field: fieldMatch[2] });
            await bot.send(chatId, `Введите ${labels[fieldMatch[2]]}. Для отмены: /cancel.`);
        }
    }
}

async function handleMessage(config, bot, message) {
    const chatId = String(message.chat.id);
    const text = typeof message.text === 'string' ? message.text.trim() : '';
    const user = message.from || {};
    if (!text) {
        await bot.send(chatId, 'Пожалуйста, отправьте текстовое сообщение.');
        return;
    }

    if (config.role === 'client') {
        const startCommand = text.match(/^\/start(?:@\w+)?(?:\s+([A-Za-z0-9_-]+))?$/i);
        const startPayload = startCommand?.[1] || '';
        const linkMatch = startPayload.match(/^link_([a-f0-9]{48})$/);
        if (linkMatch) {
            await bot.callApi('/client/link/confirm', chatId, {
                method: 'POST',
                body: JSON.stringify({ code: linkMatch[1], username: user.username || null })
            });
            await bot.send(chatId, 'Telegram подключён к вашему аккаунту Dr. DarSun. Теперь здесь можно получать выбранные уведомления и коды входа.');
            return;
        }

        const loginMatch = startPayload.match(/^login_([a-f0-9]{48})$/);
        if (loginMatch) {
            const result = await bot.callApi('/client/login/code', chatId, {
                method: 'POST',
                body: JSON.stringify({ id: loginMatch[1] })
            });
            await bot.send(chatId, `Код для входа в Dr. DarSun: ${result.code}\n\nВведите его только на drdarsun.ru. Код одноразовый и действует 5 минут. Если вы не начинали вход, проигнорируйте это сообщение.`);
            return;
        }

        if (startCommand || text === '/help') {
            const buttons = [{ text: 'Открыть каталог', url: 'https://drdarsun.ru/catalog.html' }];
            const supportUsername = botUsernames.get('support');
            if (supportUsername) {
                buttons.push({ text: 'Поддержка', url: `https://t.me/${supportUsername}` });
            }
            await bot.send(chatId, 'Здравствуйте! Это клиентский бот Dr. DarSun. Привяжите его в личном кабинете, чтобы получать выбранные уведомления и использовать безопасный вход по одноразовому коду.', {
                reply_markup: inline([buttons])
            });
        } else {
            await bot.send(chatId, 'Этот бот отправляет коды только в ответ на запрос входа, начатый на drdarsun.ru. Для уведомлений сначала привяжите Telegram в личном кабинете. Не отправляйте сюда пароль.');
        }
        return;
    }

    if (config.role === 'support') {
        if (text.startsWith('/start')) {
            await bot.send(chatId, `Поддержка Dr. DarSun${botUsernames.has('support') ? ` · @${botUsernames.get('support')}` : ''} поможет разобраться с вопросом или передаст его оператору.`, { reply_markup: menuKeyboard('support') });
            return;
        }
        if (text === '/faq' || text === '🧾 Частые вопросы') {
            await showSupportFaq(bot, chatId);
            return;
        }
        if (text === '/help') {
            await bot.send(chatId, 'Напишите вопрос обычным сообщением. Команда /operator создаёт обращение, /ticket показывает активное обращение.', { reply_markup: menuKeyboard('support') });
            return;
        }
        if (text === '/ticket' || text === '📨 Моё обращение') {
            const { ticket, messages = [] } = await getMyTicket(bot, chatId);
            if (!ticket) {
                await bot.send(chatId, 'Открытых обращений нет. Если нужен оператор, выберите «Нужен оператор».');
                return;
            }
            const latestMessage = messages.at(-1);
            await bot.send(chatId, `Обращение №${ticket.ticket_number}\nТема: ${safeText(ticket.topic, 60)}\nСтатус: открыто${latestMessage ? `\nПоследнее сообщение (${latestMessage.sender_role === 'customer' ? 'вы' : 'поддержка'}): ${safeText(latestMessage.message, 500)}` : ''}`, {
                reply_markup: inline([[{ text: 'Закрыть обращение', callback_data: 's:close' }]])
            });
            return;
        }
        if (text === '/operator' || text === '🆘 Нужен оператор') {
            const { ticket } = await getMyTicket(bot, chatId);
            if (ticket) {
                await bot.send(chatId, `У вас уже есть активное обращение №${ticket.ticket_number}. Отправьте сюда дополнительные сведения или закройте его перед созданием нового.`);
                return;
            }
            setState('support', chatId, { awaitingTopicMessage: true, topic: 'Другое' });
            await bot.send(chatId, 'Кратко опишите проблему — я передам её оператору.');
            return;
        }
        if (text === '📂 Выбрать тему' || text === '/topics') {
            await bot.send(chatId, 'Выберите тему обращения:', {
                reply_markup: inline(TOPICS.map((topic, index) => [{ text: topic, callback_data: `s:topic:${index}` }]))
            });
            return;
        }
        if (text.length > 1200) {
            await bot.send(chatId, 'Сообщение слишком длинное. Пожалуйста, сократите его до 1200 символов.');
            return;
        }
        await supportMessage(bot, chatId, user, text);
        return;
    }

    if (config.role === 'admin') {
        const adminState = getState('admin', chatId);
        if (adminState.flow === 'maintenance-password') {
            if (text === '/cancel') {
                setState('admin', chatId, {});
                await bot.send(chatId, 'Изменение состояния сайта отменено.');
                return;
            }
            if (message.message_id) {
                await bot.telegram('deleteMessage', {
                    chat_id: chatId,
                    message_id: message.message_id
                }).catch(() => {});
            }
            try {
                const result = await bot.callApi('/admin/maintenance', chatId, {
                    method: 'POST',
                    body: JSON.stringify({
                        enabled: adminState.enabled,
                        ...(adminState.enabled ? { mode: adminState.mode } : {}),
                        password: text
                    })
                });
                setState('admin', chatId, {});
                await bot.send(chatId, result.enabled
                    ? `Включён режим «${MAINTENANCE_MODE_LABELS[result.mode] || MAINTENANCE_MODE_LABELS.planned}». Страницы сайта покажут соответствующее уведомление.`
                    : 'Технический перерыв снят. Сайт снова открыт.');
            } catch (error) {
                setState('admin', chatId, {});
                await bot.send(chatId, error.message || 'Не удалось изменить состояние сайта. Проверьте пароль и настройки.');
            }
            return;
        }
        if (adminState.flow === 'toast-recipient' || adminState.flow === 'toast-message' || adminState.flow === 'toast-duration') {
            if (text === '/cancel') {
                setState('admin', chatId, {});
                await bot.send(chatId, 'Создание уведомления отменено.', { reply_markup: menuKeyboard('admin') });
                return;
            }
            if (adminState.flow === 'toast-recipient') {
                const target = text.toLowerCase();
                if (target !== 'all' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) {
                    await bot.send(chatId, 'Введите точный email аккаунта или `all`.');
                    return;
                }
                setState('admin', chatId, { flow: 'toast-message', target });
                await bot.send(chatId, 'Напишите текст уведомления (до 500 символов).');
                return;
            }
            if (adminState.flow === 'toast-message') {
                if (!text || text.length > 500) {
                    await bot.send(chatId, 'Текст должен содержать от 1 до 500 символов.');
                    return;
                }
                setState('admin', chatId, { ...adminState, flow: 'toast-duration', message: text });
                await bot.send(chatId, 'На сколько секунд показать уведомление? Введите число от 1 до 3600.');
                return;
            }
            const durationSeconds = Number(text);
            if (!/^\d+$/.test(text) || !Number.isInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > 3600) {
                await bot.send(chatId, 'Введите целое число от 1 до 3600 секунд.');
                return;
            }
            const nextState = { ...adminState, flow: 'toast-kind', durationSeconds };
            setState('admin', chatId, nextState);
            await bot.send(chatId, 'Выберите оформление уведомления:', {
                reply_markup: inline([[
                    { text: 'ℹ️ Инфо', callback_data: 'adm:toast:kind:info' },
                    { text: '✅ Успех', callback_data: 'adm:toast:kind:success' },
                    { text: '⚠️ Важно', callback_data: 'adm:toast:kind:warning' },
                    { text: '❌ Ошибка', callback_data: 'adm:toast:kind:error' }
                ], [{ text: 'Отмена', callback_data: 'adm:toast:cancel' }]])
            });
            return;
        }
        if (text.startsWith('/start')) {
            await bot.send(chatId, 'Админ-панель Dr. DarSun. Доступ разрешён только владельцу.', { reply_markup: menuKeyboard('admin') });
        } else if (text === '✍️ Отзывы' || text === '/reviews') {
            await listAdminReviews(bot, chatId);
        } else if (text === '📋 Уведомления' || text === '/toasts') {
            await listAdminToasts(bot, chatId);
        } else if (text === '📦 Заказы' || text === '/orders' || text.startsWith('/orders ')) {
            const requestedStatus = text.split(/\s+/)[1];
            const status = ORDER_STATUSES.includes(requestedStatus) ? requestedStatus : '';
            await listOrders(bot, chatId, { status });
        } else if (text === '➕ Новый заказ' || text === '/neworder') {
            await startNewOrder(bot, chatId);
        } else if (text === '🛍 Товары' || text === '/products') {
            await listProducts(bot, chatId);
        } else if (text === '➕ Новый товар' || text === '/newproduct') {
            await startNewProduct(bot, chatId);
        } else if (text === '🧾 История' || text === '/history') {
            await listAuditLog(bot, chatId);
        } else if (text === '🛠 Техперерыв' || text === '/maintenance') {
            await showAdminMaintenanceMenu(bot, chatId);
        } else if (text === '🔔 Создать уведомление' || text === '/toast') {
            setState('admin', chatId, { flow: 'toast-recipient' });
            await bot.send(chatId, 'Кому показать уведомление? Отправьте email аккаунта или `all` для публичного объявления всем посетителям сайта, включая гостей. Для отмены: /cancel.');
        } else if (text === '/help') {
            await bot.send(chatId, 'Команды: /reviews — отзывы, /orders [pending|processing|shipped|delivered|cancelled] — заказы, /neworder — новый заказ, /products — товары, /newproduct — новый товар, /history — история, /maintenance — режим сайта, /toast — создать уведомление, /toasts — удалить уведомления. Для отмены текущего ввода: /cancel.');
        } else if (getState('panel', chatId).flow) {
            await processPanelText(bot, chatId, text);
        } else {
            await bot.send(chatId, 'Не распознал команду. Отправьте /help или используйте кнопки меню.', {
                reply_markup: menuKeyboard('admin')
            });
        }
        return;
    }

    if (config.role === 'panel') {
        if (text.startsWith('/start')) {
            await bot.send(chatId, 'Панель заказов и товаров. Доступ только для настроенного panel chat ID.', { reply_markup: menuKeyboard('panel') });
        } else if (text === '📦 Заказы' || text === '/orders' || text.startsWith('/orders ')) {
            const requestedStatus = text.split(/\s+/)[1];
            const status = ORDER_STATUSES.includes(requestedStatus) ? requestedStatus : '';
            await listOrders(bot, chatId, { status });
        } else if (text === '➕ Новый заказ' || text === '/neworder') {
            await startNewOrder(bot, chatId);
        } else if (text === '🛍 Товары' || text === '/products') {
            await listProducts(bot, chatId);
        } else if (text === '➕ Новый товар' || text === '/newproduct') {
            await startNewProduct(bot, chatId);
        } else if (text === '🧾 История' || text === '/history') {
            await listAuditLog(bot, chatId);
        } else if (text === '/help') {
            await bot.send(chatId, 'Команды: /orders [pending|processing|shipped|delivered|cancelled], /neworder, /products, /newproduct, /history. Изменения требуют подтверждения; /cancel отменяет текущий ввод.');
        } else if (text === '/cancel' || text === '/skip') {
            await processPanelText(bot, chatId, text);
        } else {
            if (text.startsWith('/')) {
                await bot.send(chatId, 'Не знаю эту команду. Отправьте /help или выберите действие в меню.', {
                    reply_markup: menuKeyboard('panel')
                });
            } else {
                await processPanelText(bot, chatId, text);
            }
        }
    }
}

async function notifyAdmin(bot, chatId, env) {
    const ownerChat = String(env.MY_CHAT_ID || '').trim();
    if (!ownerChat || chatId !== ownerChat) return;
    let reviews = [];
    try {
        ({ reviews = [] } = await bot.callApi('/admin/reviews', chatId));
    } catch (error) {
        console.error('Telegram admin review queue failed:', safeError(error, bot.token));
    }
    for (const review of reviews) {
        if (notified.reviews.has(review.id)) continue;
        await bot.send(chatId,
            `Новый отзыв на модерации\n${safeText(review.user_name, 80)} · ${review.rating}/5${review.review_text ? `\n\n${safeText(review.review_text, 1800)}` : ''}`,
            { reply_markup: inline([[{ text: '✅ Одобрить', callback_data: `adm:ra:${review.id}` }, { text: '❌ Отклонить', callback_data: `adm:rr:${review.id}` }]]) }
        );
        notified.reviews.set(review.id, Date.now());
    }
}

async function sendToUser(role, chatId, text, extra = {}, options = {}) {
    const definition = getBotDefinition(role);
    const env = options.env || process.env;
    const token = definition?.tokenEnv ? String(env[definition.tokenEnv] || '').trim() : '';
    if (!definition || !token) throw new Error(`Telegram ${role} bot is not configured.`);
    const request = options.fetch || ((...args) => fetch(...args));
    const response = await request(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, ...extra }),
        signal: AbortSignal.timeout(10000)
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.ok) {
        throw new Error(`Telegram sendMessage failed with status ${response.status}.`);
    }
    return result.result;
}

module.exports = {
    processTelegramUpdate,
    sendToUser,
    getBotState: (role, chatId) => getState(role, chatId),
    setBotState: (role, chatId, state) => setState(role, chatId, state)
};
