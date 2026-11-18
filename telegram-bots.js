const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const BOT_DEFINITIONS = [
    { role: 'client', tokenEnv: 'CLIENT_BOT_TOKEN', usernameEnv: 'CLIENT_BOT_USERNAME' },
    { role: 'admin', tokenEnv: 'ADMIN_BOT_TOKEN', usernameEnv: 'ADMIN_BOT_USERNAME' },
    { role: 'panel', tokenEnv: 'PANEL_BOT_TOKEN', usernameEnv: 'PANEL_BOT_USERNAME' },
    { role: 'auth', tokenEnv: 'CODE_BOT_TOKEN', usernameEnv: 'AUTH_BOT_USERNAME' },
    { role: 'support', tokenEnv: 'HELP_BOT_TOKEN', usernameEnv: 'SUPPORT_BOT_USERNAME' }
];
const TOPICS = ['Заказ', 'Доставка', 'Оплата', 'Товар', 'Аккаунт', 'Другое'];
const ORDER_STATUSES = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];
const states = new Map();
const histories = new Map();
const assistantUsage = new Map();
const supportUsage = new Map();
const botUsernames = new Map();
const notified = { tickets: new Map(), reviews: new Set() };

function stateKey(role, chatId) {
    return `${role}:${chatId}`;
}

function getState(role, chatId) {
    return states.get(stateKey(role, chatId)) || {};
}

function setState(role, chatId, state) {
    const key = stateKey(role, chatId);
    if (state && Object.keys(state).length) states.set(key, state);
    else states.delete(key);
}

function isPrivateUpdate(update) {
    const chat = update.message?.chat || update.callback_query?.message?.chat;
    return chat?.type === 'private';
}

function updateChatId(update) {
    const chat = update.message?.chat || update.callback_query?.message?.chat;
    return chat?.id === undefined ? '' : String(chat.id);
}

function ownerAllowed(role, chatId, env) {
    if (role === 'admin') return Boolean(env.MY_CHAT_ID) && chatId === env.MY_CHAT_ID;
    if (role === 'panel') {
        const panelChatIds = String(env.M_CHAT_ID || env.PANEL_CHAT_ID || '')
            .split(',')
            .map(value => value.trim())
            .filter(Boolean);
        return panelChatIds.includes(chatId);
    }
    return true;
}

function menuKeyboard(role) {
    if (role === 'client') {
        return {
            keyboard: [
                [{ text: '📚 Каталог' }, { text: '📦 Мои заказы' }],
                [{ text: 'Найти товар' }, { text: 'Уведомления' }],
                [{ text: '🔗 Связать аккаунт' }, { text: 'ℹ️ Помощь' }]
            ],
            resize_keyboard: true
        };
    }
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
                [{ text: '🆘 Обращения' }, { text: '✍️ Отзывы' }],
                [{ text: '📦 Заказы' }, { text: '🛠 Техперерыв' }],
                [{ text: '🔔 Уведомление' }]
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
    return { keyboard: [[{ text: '🔗 Связать аккаунт' }, { text: 'ℹ️ Помощь' }]], resize_keyboard: true };
}

function inline(rows) {
    return { inline_keyboard: rows };
}

function publicBotLinks(env = process.env) {
    return [
        ['client', 'Клиентский бот'],
        ['support', 'Бот-помощник'],
        ['auth', 'Бот привязки аккаунта']
    ].flatMap(([role, label]) => {
        const definition = BOT_DEFINITIONS.find(bot => bot.role === role);
        const configuredUsername = definition?.usernameEnv ? env[definition.usernameEnv] : '';
        const username = botUsernames.get(role) || (typeof configuredUsername === 'string' ? configuredUsername.trim() : '');
        return /^[A-Za-z0-9_]{5,32}$/.test(username)
            ? [{ role, label, username, url: `https://t.me/${username}` }]
            : [];
    });
}

function botLinksKeyboard() {
    return inline(publicBotLinks().map(bot => [{
        text: `${bot.label} · @${bot.username}`,
        url: bot.url
    }]));
}

function botLinksMessage() {
    const bots = publicBotLinks();
    if (!bots.length) return 'Ссылки на ботов сейчас недоступны. Напишите позже или обратитесь в поддержку: @darsunhelp.';
    return `Боты Dr. DarSun:\n\n${bots.map(bot => `${bot.label}: @${bot.username}\n${bot.url}`).join('\n\n')}`;
}

function getPublicBotLinks(env = process.env) {
    return publicBotLinks(env).map(({ role, label, username, url }) => ({ role, label, username, url }));
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
    if (/Telegram getUpdates failed \(409\)/.test(message)) return 'Этот бот уже запущен в другом процессе. Остановите второй экземпляр приложения и попробуйте снова.';
    if (/Telegram .* failed \(400\)/.test(message)) return `Telegram не принял запрос: ${safeText(message, 500)}`;
    if (/Сервис временно недоступен|Помощник временно недоступен/.test(message)) return message;
    return 'Не удалось выполнить действие. Проверьте ввод и попробуйте ещё раз.';
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

function createBotClient(config, env, request) {
    const token = env[config.tokenEnv];
    const apiBase = (env.BOT_API_BASE_URL || `http://127.0.0.1:${env.PORT || 3000}`).replace(/\/+$/, '');
    const baseTelegramUrl = `https://api.telegram.org/bot${token}`;

    async function telegram(method, body) {
        const response = await request(`${baseTelegramUrl}/${method}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: body?.timeout ? AbortSignal.timeout((body.timeout + 10) * 1000) : undefined
        });
        const result = await response.json().catch(() => null);
        if (!response.ok || !result?.ok) {
            const error = new Error(`Telegram ${method} failed (${response.status}): ${safeText(result?.description || 'unknown error', 240)}`);
            error.telegramStatus = response.status;
            error.telegramMethod = method;
            error.retryAfter = result?.parameters?.retry_after;
            throw error;
        }
        return result.result;
    }

    async function callApi(path, chatId, init = {}) {
        const response = await request(`${apiBase}/api/telegram${path}`, {
            ...init,
            headers: {
                Authorization: `Bearer ${token}`,
                'X-Telegram-Chat-Id': String(chatId),
                'Content-Type': 'application/json',
                ...(init.headers || {})
            },
            signal: AbortSignal.timeout(15000)
        });
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
            await telegram('sendMessage', {
                chat_id: chatId,
                text: value.slice(start, start + 3900),
                disable_web_page_preview: true,
                ...options
            });
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

    return { token, telegram, callApi, send, answerCallback, editCallbackMessage, apiBase };
}

function getBotDefinition(role) {
    return BOT_DEFINITIONS.find(definition => definition.role === role);
}

function createBotForRole(role, env, request) {
    const definition = getBotDefinition(role);
    const token = definition && typeof env[definition.tokenEnv] === 'string'
        ? env[definition.tokenEnv].trim()
        : '';
    if (!definition || !token) throw new Error(`Telegram ${role} bot is not configured.`);

    for (const candidate of BOT_DEFINITIONS) {
        const username = candidate.usernameEnv ? env[candidate.usernameEnv] : '';
        if (typeof username === 'string' && /^[A-Za-z0-9_]{5,32}$/.test(username.trim())) {
            botUsernames.set(candidate.role, username.trim());
        }
    }

    return createBotClient({ ...definition, tokenEnv: '__NORMALIZED_TOKEN' }, {
        ...env,
        __NORMALIZED_TOKEN: token
    }, request);
}

async function processTelegramUpdate(role, update, options = {}) {
    const env = options.env || process.env;
    const request = options.fetch || fetch;
    const config = { role };
    const bot = createBotForRole(role, env, request);
    if (!isPrivateUpdate(update)) return { ignored: true };

    const chatId = updateChatId(update);
    if (!chatId || !ownerAllowed(role, chatId, env)) return { ignored: true };
    try {
        if (update.callback_query) {
            await handleCallback(config, bot, update.callback_query, chatId);
        } else if (update.message) {
            await handleMessage(config, bot, update.message);
        }
    } catch (error) {
        console.error(`Telegram ${role} update failed:`, safeError(error, bot.token));
        await bot.send(chatId, userFacingError(error));
    }
    return { processed: true };
}

const CLIENT_CATALOG_PAGE_SIZE = 8;
const CLIENT_ORDERS_PAGE_SIZE = 10;

async function showCatalog(bot, chatId, { search = '', offset = 0 } = {}) {
    const result = await bot.callApi(`/client/catalog?search=${encodeURIComponent(search)}&offset=${offset}`, chatId);
    const products = result.products || [];
    setState('client', chatId, { flow: 'catalog-list', products, search, offset });
    if (!products.length) {
        await bot.send(chatId, search ? `Ничего не найдено по запросу «${safeText(search, 80)}».` : 'Каталог пока пуст.', {
            reply_markup: inline([[{ text: 'Искать снова', callback_data: 'cl:search' }, { text: 'Показать весь каталог', callback_data: 'cl:catalog' }]])
        });
        return;
    }
    const rows = products.map((product, index) => [{
        text: `${safeText(product.name, 48)} · ${Number.isFinite(Number(product.price)) ? `${Number(product.price)} ₽` : 'цена уточняется'}`,
        callback_data: `cl:product:${index}`
    }]);
    const navigation = [];
    if (offset > 0) navigation.push({ text: 'Назад', callback_data: 'cl:catalog:prev' });
    if (result.hasMore) navigation.push({ text: 'Дальше', callback_data: 'cl:catalog:next' });
    if (navigation.length) rows.push(navigation);
    rows.push([{ text: 'Поиск товара', callback_data: 'cl:search' }]);
    await bot.send(chatId,
        `Каталог${search ? ` · ${safeText(search, 80)}` : ''}\nСтраница ${Math.floor(offset / CLIENT_CATALOG_PAGE_SIZE) + 1} · найдено ${result.total}`,
        { reply_markup: inline(rows) }
    );
}

async function showCustomerOrders(bot, chatId, offset = 0) {
    const result = await bot.callApi(`/client/orders?offset=${offset}`, chatId);
    if (!result.linked) {
        await bot.send(chatId, 'Чтобы показать ваши заказы, сначала привяжите Telegram в профиле на сайте.', {
            reply_markup: inline([[{ text: 'Открыть профиль', url: 'https://drdarsun.ru/profile.html' }]])
        });
        return;
    }
    const orders = result.orders || [];
    setState('client', chatId, { flow: 'orders-list', orders, offset });
    if (!orders.length) {
        await bot.send(chatId, 'Заказов пока нет.');
        return;
    }
    const rows = orders.map((order, index) => [{
        text: `Заказ ${safeText(order.id, 36)} · ${safeText(order.status, 32)} · ${Number(order.total) || 0} ₽`,
        callback_data: `cl:order:${index}`
    }]);
    const navigation = [];
    if (offset > 0) navigation.push({ text: 'Назад', callback_data: 'cl:orders:prev' });
    if (result.hasMore) navigation.push({ text: 'Дальше', callback_data: 'cl:orders:next' });
    if (navigation.length) rows.push(navigation);
    await bot.send(chatId, 'Ваши заказы. Выберите заказ, чтобы посмотреть позиции и статус:', { reply_markup: inline(rows) });
}

async function confirmLink(bot, chatId, user, code) {
    if (!/^[A-F0-9]{16}$/i.test(code || '')) {
        await bot.send(chatId, 'Введите одноразовый код привязки из профиля на сайте: /link КОД');
        return;
    }
    await bot.callApi('/link/confirm', chatId, {
        method: 'POST',
        body: JSON.stringify({ code: code.toUpperCase(), username: user?.username || '' })
    });
    await bot.send(chatId, 'Аккаунт успешно привязан. Теперь можно пользоваться командами бота.');
}

async function getMyTicket(bot, chatId) {
    return bot.callApi('/support/my-ticket', chatId);
}

function ticketContactLink(number) {
    return `https://t.me/darsunhelp?text=${encodeURIComponent(`Здравствуйте, по обращению №${number}`)}`;
}

const SUPPORT_FAQ = {
    account: 'Привязка: войдите в профиль на drdarsun.ru, откройте «Безопасность», создайте код Telegram и отправьте его боту командой /link КОД. Код одноразовый и действует ограниченное время.',
    orders: 'Заказы доступны в клиентском боте после привязки Telegram к профилю. Команда /orders показывает только заказы вашего аккаунта.',
    notifications: 'Уведомления о заказах можно включить в профиле в разделе настроек или в клиентском боте командой /notifications.',
    storage: 'После открытия бутылки следуйте условиям на этикетке. Обычно масло хранят плотно закрытым, вдали от света и источников тепла.'
};

async function showSupportFaq(bot, chatId, topic) {
    if (topic && SUPPORT_FAQ[topic]) {
        await bot.send(chatId, SUPPORT_FAQ[topic], { reply_markup: inline([[{ text: 'Все вопросы', callback_data: 's:faq' }]]) });
        return;
    }
    await bot.send(chatId, 'Выберите вопрос:', {
        reply_markup: inline([
            [{ text: 'Привязка аккаунта', callback_data: 's:faq:account' }],
            [{ text: 'Заказы', callback_data: 's:faq:orders' }],
            [{ text: 'Уведомления', callback_data: 's:faq:notifications' }],
            [{ text: 'Хранение масла', callback_data: 's:faq:storage' }]
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
        { reply_markup: inline([[{ text: 'Написать @darsunhelp', url: link }]]) }
    );
    setState('support', chatId, {});
}

async function supportMessage(bot, chatId, user, message) {
    const now = Date.now();
    const supportAttempts = (supportUsage.get(chatId) || []).filter(timestamp => now - timestamp < 5 * 60 * 1000);
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

    const usage = (assistantUsage.get(chatId) || []).filter(timestamp => now - timestamp < 5 * 60 * 1000);
    if (usage.length >= 8) {
        assistantUsage.set(chatId, usage);
        await bot.send(chatId, 'Слишком много сообщений за короткое время. Подождите несколько минут или выберите «Нужен оператор».');
        return;
    }
    usage.push(now);
    assistantUsage.set(chatId, usage);

    const history = histories.get(chatId) || [];
    const aiResponse = await fetch(`${bot.apiBase}/api/gigachat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, history, context: 'site', supportMode: true }),
        signal: AbortSignal.timeout(30000)
    });
    const response = await aiResponse.json().catch(() => null);
    if (!aiResponse.ok) throw new Error(response?.error || 'Помощник временно недоступен.');
    if (typeof response.reply !== 'string' || !response.reply.trim()) throw new Error(response.error || 'Помощник не ответил.');

    history.push({ role: 'user', content: message.slice(0, 1000) });
    history.push({ role: 'assistant', content: response.reply.slice(0, 1000) });
    histories.set(chatId, history.slice(-8));

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

async function listAdminTickets(bot, chatId, { status = 'open', offset = 0 } = {}) {
    const result = await bot.callApi(`/admin/tickets?status=${status}&offset=${offset}`, chatId);
    const tickets = result.tickets || [];
    setState('admin', chatId, { flow: 'admin-ticket-list', queueStatus: status, offset });
    if (!tickets.length) {
        await bot.send(chatId, status === 'open' ? 'Открытых обращений нет.' : 'Закрытых обращений нет.', {
            reply_markup: inline([[{ text: status === 'open' ? 'Показать закрытые' : 'Показать открытые', callback_data: `adm:tickets:filter:${status === 'open' ? 'closed' : 'open'}` }]])
        });
        return;
    }
    for (const ticket of tickets) {
        const text = `Обращение №${ticket.ticket_number}\nТема: ${safeText(ticket.topic, 60)}\nTelegram: ${safeText(ticket.telegram_username ? `@${ticket.telegram_username}` : ticket.telegram_chat_id, 80)}\nСоздано: ${new Date(ticket.created_at).toLocaleString('ru-RU')}`;
        await bot.send(chatId, text, {
            reply_markup: inline([[{ text: 'Переписка', callback_data: `adm:t:${ticket.id}` }, { text: 'Ответить', callback_data: `adm:r:${ticket.id}` }, { text: 'Закрыть', callback_data: `adm:c:${ticket.id}` }]])
        });
    }
    const navigation = [];
    if (offset > 0) navigation.push({ text: 'Назад', callback_data: 'adm:tickets:prev' });
    if (result.hasMore) navigation.push({ text: 'Дальше', callback_data: 'adm:tickets:next' });
    navigation.push({ text: status === 'open' ? 'Закрытые' : 'Открытые', callback_data: `adm:tickets:filter:${status === 'open' ? 'closed' : 'open'}` });
    await bot.send(chatId, `Обращения: ${status === 'open' ? 'открытые' : 'закрытые'} · страница ${Math.floor(offset / 10) + 1}`, {
        reply_markup: inline([navigation])
    });
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
        const text = `${safeText(review.user_name, 80)} · ${review.rating}/5\n${safeText(review.review_text, 2500)}`;
        await bot.send(chatId, text, {
            reply_markup: inline([[{ text: '✅ Одобрить', callback_data: `adm:ra:${review.id}` }, { text: '❌ Отклонить', callback_data: `adm:rr:${review.id}` }]])
        });
    }
    const navigation = [];
    if (offset > 0) navigation.push({ text: 'Назад', callback_data: 'adm:reviews:prev' });
    if (result.hasMore) navigation.push({ text: 'Дальше', callback_data: 'adm:reviews:next' });
    if (navigation.length) await bot.send(chatId, `Модерация отзывов · страница ${Math.floor(offset / 10) + 1}`, { reply_markup: inline([navigation]) });
}

async function listOrders(bot, chatId, { status = '', offset = 0 } = {}) {
    const result = await bot.callApi(`/panel/orders?offset=${offset}${status ? `&status=${encodeURIComponent(status)}` : ''}`, chatId);
    setState('panel', chatId, { flow: 'orders-list', status, offset, orders: result.orders || [] });
    if (!result.orders?.length) {
        await bot.send(chatId, 'Заказов пока нет.', { reply_markup: menuKeyboard('panel') });
        return;
    }
    for (const order of result.orders.slice(0, 15)) {
        const text = `Заказ ${safeText(order.id, 40)}\n${formatOrders([order])}\nПозиции: ${Array.isArray(order.items) ? order.items.map(item => `${safeText(item.name || item.product_id, 80)} × ${item.quantity || 1}`).join(', ') : '—'}`;
        const buttons = ORDER_STATUSES.map(status => ({
            text: `${order.status === status ? '• ' : ''}${status}`,
            callback_data: `p:o:${result.orders.indexOf(order)}:${status}`
        }));
        await bot.send(chatId, text, { reply_markup: inline(buttons.reduce((rows, button, index) => {
            const row = Math.floor(index / 3);
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
        'review.moderated': 'Отзыв модерирован',
        'ticket.closed': 'Обращение закрыто',
        'toast.sent': 'Уведомление отправлено',
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

async function listProducts(bot, chatId) {
    const { products = [] } = await bot.callApi('/panel/products', chatId);
    if (!products.length) {
        await bot.send(chatId, 'Товаров нет.', { reply_markup: menuKeyboard('panel') });
        return;
    }
    setState('panel', chatId, { products: products.slice(0, 30) });
    for (let index = 0; index < Math.min(30, products.length); index++) {
        const product = products[index];
        await bot.send(chatId,
            `${safeText(product.name, 120)}\n${safeText(product.category, 80)} · ${Number(product.price)} ₽\n${safeText(product.description, 700)}`,
            { reply_markup: inline([[{ text: 'Изменить', callback_data: `p:pe:${index}` }]]) }
        );
    }
}

async function startNewOrder(bot, chatId) {
    setState('panel', chatId, { flow: 'new-order-user' });
    await bot.send(chatId, 'Введите UUID аккаунта клиента на сайте. Его можно скопировать из панели пользователя.');
}

async function startNewProduct(bot, chatId) {
    setState('panel', chatId, { flow: 'new-product-name', product: {} });
    await bot.send(chatId, 'Введите название товара. Для отмены отправьте /cancel.');
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
    if (state.flow === 'new-order-user') {
        if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(text)) {
            await bot.send(chatId, 'Похоже, это не UUID. Проверьте и отправьте ещё раз или /cancel.');
            return;
        }
        const { products = [] } = await bot.callApi('/panel/products', chatId);
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
        state.items.push({ product_id: product.id, quantity });
        delete state.flow;
        delete state.selectedProductIndex;
        setState('panel', chatId, state);
        await bot.send(chatId, `${safeText(product.name, 100)} × ${quantity} добавлено. Возвращайтесь к списку товаров и нажмите «Готово».`);
        return;
    }
    if (state.flow.startsWith('new-product-')) {
        const key = state.flow.slice('new-product-'.length);
        const product = { ...state.product };
        if (key === 'name' || key === 'category' || key === 'description') {
            if (text.length > (key === 'description' ? 2000 : key === 'name' ? 160 : 80)) {
                await bot.send(chatId, 'Слишком длинное значение. Попробуйте ещё раз.');
                return;
            }
            product[key] = text;
        } else if (key === 'price') {
            const price = Number(text.replace(',', '.'));
            if (!Number.isFinite(price) || price < 0 || price > 10000000) {
                await bot.send(chatId, 'Введите цену числом от 0 до 10 000 000.');
                return;
            }
            product.price = price;
        } else if (key === 'image') {
            if (text !== '/skip' && !/^https?:\/\/\S+$/i.test(text)) {
                await bot.send(chatId, 'Отправьте ссылку https://… или /skip.');
                return;
            }
            product.image_url = text === '/skip' ? '' : text;
        }
        const sequence = ['name', 'category', 'price', 'description', 'image'];
        const position = sequence.indexOf(key);
        const next = sequence[position + 1];
        if (next) {
            state.product = product;
            state.flow = `new-product-${next}`;
            setState('panel', chatId, state);
            const prompts = {
                category: 'Введите категорию.',
                price: 'Введите цену в рублях.',
                description: 'Введите описание.',
                image: 'Отправьте URL изображения или /skip.'
            };
            await bot.send(chatId, prompts[next]);
            return;
        }
        setState('panel', chatId, { flow: 'confirm-new-product', product });
        await bot.send(chatId, `Проверьте товар перед публикацией:\n\n${safeText(product.name, 160)}\n${safeText(product.category, 80)} · ${Number(product.price)} ₽\n\n${safeText(product.description, 700)}\n\nИзображение: ${product.image_url ? safeText(product.image_url, 300) : 'не задано'}`, {
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
        } else {
            const maxLength = field === 'name' ? 160 : field === 'category' ? 80 : 2000;
            if (value.length > maxLength || (field !== 'description' && field !== 'image_url' && !value)) {
                await bot.send(chatId, `Проверьте значение: максимум ${maxLength} символов.`);
                return;
            }
            if (field === 'image_url' && value && !/^https?:\/\/\S+$/i.test(value)) {
                await bot.send(chatId, 'Укажите ссылку https://… или пустое значение.');
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
    const data = String(callback.data || '');
    await bot.answerCallback(callback.id);
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
    if (config.role === 'client') {
        const state = getState('client', chatId);
        if (data === 'cl:search') {
            setState('client', chatId, { flow: 'catalog-search' });
            await bot.send(chatId, 'Введите название товара или категорию. Для отмены отправьте /cancel.');
        } else if (data === 'cl:catalog') {
            await showCatalog(bot, chatId);
        } else if (data === 'cl:catalog:next' || data === 'cl:catalog:prev') {
            await showCatalog(bot, chatId, {
                search: state.search || '',
                offset: Math.max(0, (state.offset || 0) + (data.endsWith('next') ? CLIENT_CATALOG_PAGE_SIZE : -CLIENT_CATALOG_PAGE_SIZE))
            });
        } else if (data.startsWith('cl:product:')) {
            const product = state.products?.[Number(data.slice('cl:product:'.length))];
            if (!product) return;
            const description = safeText(product.description, 1200) || 'Описание пока не добавлено.';
            await bot.send(chatId,
                `${safeText(product.name, 120)}\n${safeText(product.category, 80)} · ${Number(product.price) || 0} ₽\n\n${description}`,
                { reply_markup: inline([[{ text: 'Назад к каталогу', callback_data: 'cl:catalog' }, { text: 'Поиск товара', callback_data: 'cl:search' }]]) }
            );
        } else if (data === 'cl:orders:next' || data === 'cl:orders:prev') {
            await showCustomerOrders(bot, chatId, Math.max(0, (state.offset || 0) + (data.endsWith('next') ? CLIENT_ORDERS_PAGE_SIZE : -CLIENT_ORDERS_PAGE_SIZE)));
        } else if (data.startsWith('cl:order:')) {
            const order = state.orders?.[Number(data.slice('cl:order:'.length))];
            if (!order) return;
            const items = Array.isArray(order.items)
                ? order.items.map(item => `${safeText(item.name || item.product_id, 100)} × ${Number(item.quantity) || 1}`).join('\n')
                : 'Состав заказа недоступен.';
            await bot.send(chatId,
                `Заказ ${safeText(order.id, 80)}\nСтатус: ${safeText(order.status, 32)}\nДата: ${new Date(order.created_at).toLocaleDateString('ru-RU')}\nСумма: ${Number(order.total) || 0} ₽\n\n${items}`,
                { reply_markup: inline([[{ text: 'Назад к заказам', callback_data: 'cl:orders:prev' }]]) }
            );
        } else if (data === 'cl:notifications') {
            const preferences = await bot.callApi('/client/notifications', chatId);
            if (!preferences.linked) {
                await bot.send(chatId, 'Сначала привяжите Telegram в профиле на сайте, чтобы управлять уведомлениями.');
                return;
            }
            setState('client', chatId, { ...state, notificationsEnabled: preferences.enabled });
            await bot.send(chatId, `Уведомления о заказах: ${preferences.enabled ? 'включены' : 'выключены'}.`, {
                reply_markup: inline([[{ text: preferences.enabled ? 'Выключить уведомления' : 'Включить уведомления', callback_data: 'cl:notifications:toggle' }]])
            });
        } else if (data === 'cl:notifications:toggle') {
            const preferences = await bot.callApi('/client/notifications', chatId);
            if (!preferences.linked) {
                await bot.send(chatId, 'Сначала привяжите Telegram в профиле на сайте, чтобы управлять уведомлениями.');
                return;
            }
            const updated = await bot.callApi('/client/notifications', chatId, {
                method: 'PATCH',
                body: JSON.stringify({ enabled: !preferences.enabled })
            });
            setState('client', chatId, { ...state, notificationsEnabled: updated.enabled });
            await bot.editCallbackMessage(callback, `Уведомления о заказах ${updated.enabled ? 'включены' : 'выключены'}.`);
        }
        return;
    }
    if (config.role === 'admin') {
        if (data.startsWith('adm:tickets:filter:')) {
            const status = data.slice('adm:tickets:filter:'.length);
            if (!['open', 'closed'].includes(status)) return;
            await listAdminTickets(bot, chatId, { status, offset: 0 });
            return;
        }
        if (data === 'adm:tickets:next' || data === 'adm:tickets:prev') {
            const state = getState('admin', chatId);
            if (state.flow !== 'admin-ticket-list') return;
            await listAdminTickets(bot, chatId, {
                status: state.queueStatus,
                offset: Math.max(0, state.offset + (data.endsWith('next') ? 10 : -10))
            });
            return;
        }
        if (data === 'adm:reviews:next' || data === 'adm:reviews:prev') {
            const state = getState('admin', chatId);
            if (state.flow !== 'admin-review-list') return;
            await listAdminReviews(bot, chatId, Math.max(0, state.offset + (data.endsWith('next') ? 10 : -10)));
            return;
        }
        if (data === 'adm:review:cancel' || data === 'adm:ticket:cancel') {
            setState('admin', chatId, {});
            await bot.editCallbackMessage(callback, 'Действие отменено.');
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
        if (data === 'adm:ticket:confirm') {
            const state = getState('admin', chatId);
            if (state.flow !== 'confirm-ticket-close') return;
            await bot.callApi(`/admin/tickets/${state.ticketId}`, chatId, {
                method: 'PATCH',
                body: JSON.stringify({ status: 'closed' })
            });
            setState('admin', chatId, {});
            await bot.editCallbackMessage(callback, 'Обращение закрыто.');
            return;
        }
        if (data === 'adm:toast') {
            setState('admin', chatId, { flow: 'toast-recipient' });
            await bot.send(chatId, 'Кому показать уведомление? Отправьте email конкретного аккаунта или `all` для всех пользователей сайта. Для отмены: /cancel.');
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
            const recipient = nextState.target === 'all' ? 'всем пользователям' : safeText(nextState.target, 160);
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
            await bot.send(chatId, `Уведомление создано.\nПолучателей: ${result.sent}\nСрок показа: ${result.durationSeconds} сек.`, { reply_markup: menuKeyboard('admin') });
            return;
        }
        if (data === 'adm:maintenance') {
            const { enabled } = await bot.callApi('/admin/maintenance', chatId);
            await bot.send(chatId, `Состояние сайта: ${enabled ? 'техперерыв включён' : 'сайт работает'}.\nВыберите действие:`, {
                reply_markup: inline([
                    [{ text: '⏸ Включить техперерыв', callback_data: 'adm:maint:on' }],
                    [{ text: '▶️ Возобновить сайт', callback_data: 'adm:maint:off' }]
                ])
            });
            return;
        }
        if (data === 'adm:maint:on' || data === 'adm:maint:off') {
            const enabled = data.endsWith(':on');
            setState('admin', chatId, { flow: 'maintenance-password', enabled });
            await bot.send(chatId, `${enabled ? 'Поставить весь сайт на технический перерыв' : 'Снять технический перерыв и снова открыть сайт'}?\n\nДля подтверждения отправьте пароль SITE_MAINTENANCE_PASSWORD. Не пересылайте его и не отправляйте в групповой чат. Для отмены: /cancel.`);
            return;
        }
        if (data === 'adm:reviews') return listAdminReviews(bot, chatId);
        if (data === 'adm:tickets') return listAdminTickets(bot, chatId);
        const [, action, id] = data.split(':');
        if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return;
        if (action === 'ra' || action === 'rr') {
            const status = action === 'ra' ? 'approved' : 'rejected';
            setState('admin', chatId, { flow: 'confirm-review', reviewId: id, status });
            await bot.send(chatId, `${status === 'approved' ? 'Опубликовать' : 'Отклонить'} этот отзыв?`, {
                reply_markup: inline([[{ text: 'Подтвердить', callback_data: 'adm:review:confirm' }, { text: 'Отмена', callback_data: 'adm:review:cancel' }]])
            });
        } else if (action === 'c') {
            setState('admin', chatId, { flow: 'confirm-ticket-close', ticketId: id });
            await bot.send(chatId, 'Закрыть это обращение?', {
                reply_markup: inline([[{ text: 'Подтвердить закрытие', callback_data: 'adm:ticket:confirm' }, { text: 'Отмена', callback_data: 'adm:ticket:cancel' }]])
            });
        } else if (action === 't') {
            const { messages = [] } = await bot.callApi(`/admin/tickets/${id}/messages`, chatId);
            const text = messages.map(message => `${message.sender_role === 'customer' ? 'Клиент' : 'Поддержка'}: ${safeText(message.message, 1200)}`).join('\n\n');
            await bot.send(chatId, text || 'В обращении пока нет сообщений.', {
                reply_markup: inline([[{ text: 'Ответить клиенту', callback_data: `adm:r:${id}` }]])
            });
        } else if (action === 'r') {
            setState('admin', chatId, { flow: 'ticket-reply', ticketId: id });
            await bot.send(chatId, 'Введите ответ для выбранного обращения. Для отмены отправьте /cancel.');
        }
        return;
    }
    if (config.role === 'panel') {
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
        if (data === 'p:status:cancel' || data === 'p:product:create:cancel' || data === 'p:product:update:cancel') {
            setState('panel', chatId, {});
            await bot.editCallbackMessage(callback, 'Действие отменено.');
            return;
        }
        if (data === 'p:product:create:confirm') {
            const state = getState('panel', chatId);
            if (state.flow !== 'confirm-new-product') return;
            const result = await bot.callApi('/panel/products', chatId, {
                method: 'POST',
                body: JSON.stringify(state.product)
            });
            setState('panel', chatId, {});
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
        if (data === 'p:done') {
            const state = getState('panel', chatId);
            if (state.flow !== 'new-order-products' || !state.items.length) {
                await bot.send(chatId, 'Добавьте хотя бы один товар, прежде чем продолжить.');
                return;
            }
            const { products = [] } = await bot.callApi('/panel/products', chatId);
            const rows = state.items.map(item => {
                const product = products.find(candidate => String(candidate.id) === String(item.product_id));
                return `${safeText(product?.name || item.product_id, 100)} × ${item.quantity}`;
            });
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
            const fields = [['name', 'Название'], ['price', 'Цена'], ['category', 'Категория'], ['description', 'Описание'], ['image_url', 'Изображение']];
            await bot.send(chatId, `Что изменить у «${safeText(product.name, 100)}»?`, {
                reply_markup: inline(fields.map(([field, label]) => [{ text: label, callback_data: `p:pf:${editMatch[1]}:${field}` }]))
            });
            return;
        }
        const fieldMatch = /^p:pf:(\d+):(name|price|category|description|image_url)$/.exec(data);
        if (fieldMatch) {
            const state = getState('panel', chatId);
            const product = state.products?.[Number(fieldMatch[1])];
            if (!product) return;
            const labels = { name: 'новое название', price: 'новую цену', category: 'новую категорию', description: 'новое описание', image_url: 'URL изображения или пустое значение' };
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

    if (config.role === 'client' || config.role === 'auth') {
        if (config.role === 'client' && getState('client', chatId).flow === 'catalog-search') {
            if (text === '/cancel') {
                setState('client', chatId, {});
                await bot.send(chatId, 'Поиск отменён.', { reply_markup: menuKeyboard('client') });
                return;
            }
            if (!text || text.length > 80) {
                await bot.send(chatId, 'Введите запрос длиной до 80 символов.');
                return;
            }
            setState('client', chatId, {});
            await showCatalog(bot, chatId, { search: text });
            return;
        }
        if (text.startsWith('/link')) {
            const code = text.split(/\s+/)[1] || '';
            try {
                await confirmLink(bot, chatId, user, code);
            } catch (error) {
                await bot.send(chatId, error.message || 'Не удалось привязать аккаунт. Проверьте код и попробуйте снова.');
            }
            return;
        }
        if (text.startsWith('/start')) {
            const startCode = text.split(/\s+/)[1] || '';
            if (['auth', 'client'].includes(config.role) && startCode) {
                try {
                    await confirmLink(bot, chatId, user, startCode);
                } catch (error) {
                    await bot.send(chatId, error.message || 'Не удалось привязать аккаунт. Проверьте код и попробуйте снова.');
                }
                return;
            }
            await bot.send(chatId,
                config.role === 'client'
                    ? 'Добро пожаловать! Здесь можно посмотреть каталог, проверить заказы и связать аккаунт сайта.'
                    : 'Бот привязки аккаунта Dr. DarSun. Отправьте одноразовый код из профиля командой /link КОД.',
                {
                    reply_markup: config.role === 'client' && botUsernames.has('support')
                        ? inline([[{
                            text: `Перейти к помощнику · @${botUsernames.get('support')}`,
                            url: `https://t.me/${botUsernames.get('support')}`
                        }]])
                        : menuKeyboard(config.role)
                }
            );
            return;
        }
        if (config.role === 'auth' && text === '🔗 Связать аккаунт') {
            await bot.send(chatId, 'Создайте одноразовый код привязки в профиле на сайте и отправьте его сюда командой /link КОД.');
            return;
        }
        if (config.role === 'client') {
            if (text === '📚 Каталог' || text === '/catalog') return showCatalog(bot, chatId);
            if (text === 'Найти товар' || text === '/search') {
                setState('client', chatId, { flow: 'catalog-search' });
                await bot.send(chatId, 'Введите название товара или категорию. Для отмены отправьте /cancel.');
                return;
            }
            if (text.startsWith('/search ')) return showCatalog(bot, chatId, { search: text.slice('/search '.length).trim().slice(0, 80) });
            if (text === '📦 Мои заказы' || text === '/orders') return showCustomerOrders(bot, chatId);
            if (text === 'Уведомления' || text === '/notifications') {
                const preferences = await bot.callApi('/client/notifications', chatId);
                if (!preferences.linked) {
                    await bot.send(chatId, 'Сначала привяжите Telegram в профиле на сайте, чтобы управлять уведомлениями.');
                    return;
                }
                setState('client', chatId, { flow: 'notifications', notificationsEnabled: preferences.enabled });
                await bot.send(chatId, `Уведомления о заказах: ${preferences.enabled ? 'включены' : 'выключены'}.`, {
                    reply_markup: inline([[{ text: preferences.enabled ? 'Выключить уведомления' : 'Включить уведомления', callback_data: 'cl:notifications:toggle' }]])
                });
                return;
            }
            if (text === '🔗 Связать аккаунт') {
                const profileUrl = 'https://drdarsun.ru/profile.html';
                await bot.send(chatId, 'Откройте настройки профиля на сайте, создайте код привязки и отправьте его сюда командой /link КОД.', {
                    reply_markup: inline([[{ text: 'Открыть профиль', url: profileUrl }]])
                });
                return;
            }
            if (text === 'ℹ️ Помощь' || text === '/help') {
                const username = botUsernames.get('support');
                await bot.send(chatId, username
                    ? 'Откройте бота-помощника и задайте вопрос.'
                    : 'Напишите в бота-помощника, чтобы задать вопрос. Для привязки используйте /link КОД.',
                {
                    ...(username ? { reply_markup: inline([[{ text: 'Открыть помощника', url: `https://t.me/${username}` }]]) } : {})
                });
                return;
            }
        }
        if (text === '/help') {
            await bot.send(chatId, 'Создайте код привязки в настройках профиля на сайте, затем отправьте /link КОД.');
        }
        return;
    }

    if (config.role === 'support') {
        if (text.startsWith('/start')) {
            await bot.send(chatId, `Я помощник Dr. DarSun${botUsernames.has('support') ? ` · @${botUsernames.get('support')}` : ''}. Постараюсь решить вопрос, а если потребуется оператор — создам обращение с темой и номером. Чтобы получить ссылки на все боты, отправьте /bots.`, { reply_markup: menuKeyboard('support') });
            return;
        }
        if (text === '/faq' || text === '🧾 Частые вопросы') {
            await showSupportFaq(bot, chatId);
            return;
        }
        if (text === '/bots' || /(?:какие|где).{0,30}бот|ссылк.{0,30}бот|бот.{0,30}(?:ссылк|юзер|username)/i.test(text)) {
            await bot.send(chatId, botLinksMessage(), {
                ...(publicBotLinks().length ? { reply_markup: botLinksKeyboard() } : {})
            });
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
                    body: JSON.stringify({ enabled: adminState.enabled, password: text })
                });
                setState('admin', chatId, {});
                await bot.send(chatId, result.enabled
                    ? 'Технический перерыв включён. Страницы сайта будут показывать уведомление.'
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
        } else if (text === '🆘 Обращения' || text === '/tickets' || text.startsWith('/tickets ')) {
            const requestedStatus = text.split(/\s+/)[1] === 'closed' ? 'closed' : 'open';
            await listAdminTickets(bot, chatId, { status: requestedStatus });
        } else if (text === '✍️ Отзывы' || text === '/reviews') {
            await listAdminReviews(bot, chatId);
        } else if (text === '📦 Заказы' || text === '/orders') {
            const { orders = [] } = await bot.callApi('/admin/orders?offset=0', chatId);
            await bot.send(chatId, formatOrders(orders), { reply_markup: menuKeyboard('admin') });
        } else if (text === '🛠 Техперерыв' || text === '/maintenance') {
            const { enabled } = await bot.callApi('/admin/maintenance', chatId);
            await bot.send(chatId, `Состояние сайта: ${enabled ? 'техперерыв включён' : 'сайт работает'}.\nВыберите действие:`, {
                reply_markup: inline([
                    [{ text: '⏸ Включить техперерыв', callback_data: 'adm:maint:on' }],
                    [{ text: '▶️ Возобновить сайт', callback_data: 'adm:maint:off' }]
                ])
            });
        } else if (text === '🔔 Уведомление' || text === '/toast') {
            setState('admin', chatId, { flow: 'toast-recipient' });
            await bot.send(chatId, 'Кому показать уведомление? Отправьте email конкретного аккаунта или `all` для всех пользователей сайта. Для отмены: /cancel.');
        } else if (text === '/help') {
            await bot.send(chatId, 'Используйте кнопки для обращений, модерации, заказов, техперерыва и уведомлений на сайте.');
        } else if (getState('admin', chatId).flow === 'ticket-reply') {
            const state = getState('admin', chatId);
            if (text === '/cancel') {
                setState('admin', chatId, {});
                await bot.send(chatId, 'Ответ отменён.');
                return;
            }
            const result = await bot.callApi(`/admin/tickets/${state.ticketId}/reply`, chatId, {
                method: 'POST',
                body: JSON.stringify({ message: text })
            });
            if (result.updated_at) notified.tickets.set(state.ticketId, result.updated_at);
            setState('admin', chatId, {});
            await bot.send(chatId, result.delivered
                ? 'Ответ отправлен клиенту.'
                : 'Ответ сохранён в обращении, но Telegram не подтвердил доставку. Проверьте HELP_BOT_TOKEN.');
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
            await bot.send(chatId, 'Кнопки: заказы, создание заказа, поиск/изменение товара и журнал действий. Изменения требуют подтверждения. /cancel отменяет текущий ввод.');
        } else {
            await processPanelText(bot, chatId, text);
        }
    }
}

async function notifyAdmin(bot, chatId, env) {
    const ownerChat = env.MY_CHAT_ID;
    if (!ownerChat || chatId !== ownerChat) return;
    let tickets = [];
    let reviews = [];
    try {
        ({ tickets = [] } = await bot.callApi('/admin/tickets', chatId));
    } catch (error) {
        console.error('Telegram admin ticket queue failed:', safeError(error, bot.token));
    }
    try {
        ({ reviews = [] } = await bot.callApi('/admin/reviews', chatId));
    } catch (error) {
        console.error('Telegram admin review queue failed:', safeError(error, bot.token));
    }
    for (const ticket of tickets) {
        if (notified.tickets.get(ticket.id) === ticket.updated_at) continue;
        const isNew = !notified.tickets.has(ticket.id);
        await bot.send(chatId,
            `${isNew ? 'Новое обращение' : 'Обращение обновлено'} №${ticket.ticket_number}\nТема: ${safeText(ticket.topic, 60)}\n${safeText(ticket.telegram_username ? `@${ticket.telegram_username}` : ticket.telegram_chat_id, 80)}${ticket.last_message?.message ? `\n\n${ticket.last_message.sender_role === 'customer' ? 'Клиент' : 'Поддержка'}: ${safeText(ticket.last_message.message, 1200)}` : ''}`,
            { reply_markup: inline([[{ text: 'Открыть переписку', callback_data: `adm:t:${ticket.id}` }, { text: 'Ответить', callback_data: `adm:r:${ticket.id}` }, { text: 'Закрыть', callback_data: `adm:c:${ticket.id}` }]]) }
        );
        notified.tickets.set(ticket.id, ticket.updated_at);
    }
    for (const review of reviews) {
        if (notified.reviews.has(review.id)) continue;
        await bot.send(chatId,
            `Новый отзыв на модерации\n${safeText(review.user_name, 80)} · ${review.rating}/5\n${safeText(review.review_text, 1500)}`,
            { reply_markup: inline([[{ text: '✅ Одобрить', callback_data: `adm:ra:${review.id}` }, { text: '❌ Отклонить', callback_data: `adm:rr:${review.id}` }]]) }
        );
        notified.reviews.add(review.id);
    }
}

function startTelegramBots(options = {}) {
    const env = options.env || process.env;
    const request = options.fetch || fetch;
    const bots = new Map();
    const timers = [];
    const seenTokens = new Map();
    const ambiguousTokens = new Set();
    let stopping = false;

    for (const definition of BOT_DEFINITIONS) {
        const token = typeof env[definition.tokenEnv] === 'string' ? env[definition.tokenEnv].trim() : '';
        if (!token) continue;
        if (definition.role === 'admin' && !env.MY_CHAT_ID) {
            console.warn('Telegram admin bot not started: MY_CHAT_ID is not configured.');
            continue;
        }
        if (definition.role === 'panel' && !(env.M_CHAT_ID || env.PANEL_CHAT_ID)) {
            console.warn('Telegram panel bot not started: M_CHAT_ID or PANEL_CHAT_ID is not configured.');
            continue;
        }
        const duplicateRole = seenTokens.get(token);
        if (duplicateRole) {
            bots.delete(duplicateRole);
            ambiguousTokens.add(token);
            console.error(`Telegram ${definition.role} and ${duplicateRole} bots not started: they use the same token. Create a distinct token for each bot.`);
            continue;
        }
        if (ambiguousTokens.has(token)) continue;
        seenTokens.set(token, definition.role);
        const bot = createBotClient({ ...definition, tokenEnv: '__NORMALIZED_TOKEN' }, {
            ...env,
            __NORMALIZED_TOKEN: token
        }, request);
        bots.set(definition.role, bot);
    }

    for (const [role, bot] of bots) {
        (async () => {
            let offset = 0;
            let retryDelay = 3000;
            try {
                const me = await bot.telegram('getMe', {});
                if (!me?.is_bot || typeof me.username !== 'string') {
                    console.error(`Telegram ${role} identity check failed: getMe returned invalid bot data.`);
                    return;
                }
                botUsernames.set(role, me.username);
                console.log(`Telegram ${role} bot authenticated as @${me.username}.`);
                await bot.telegram('deleteWebhook', { drop_pending_updates: false });
                console.log(`Telegram ${role} webhook cleared; long polling is active.`);
                try {
                    await bot.telegram('setMyCommands', {
                        commands: role === 'panel'
                            ? [{ command: 'start', description: 'Открыть меню' }, { command: 'orders', description: 'Заказы' }, { command: 'neworder', description: 'Создать заказ' }, { command: 'products', description: 'Товары' }, { command: 'newproduct', description: 'Создать товар' }]
                            : role === 'admin'
                                ? [{ command: 'start', description: 'Открыть админ-меню' }, { command: 'tickets', description: 'Обращения' }, { command: 'reviews', description: 'Отзывы на модерации' }, { command: 'orders', description: 'Заказы' }, { command: 'maintenance', description: 'Техперерыв сайта' }, { command: 'toast', description: 'Уведомление на сайте' }]
                                : role === 'support'
                                    ? [{ command: 'start', description: 'Начать общение' }, { command: 'ticket', description: 'Моё обращение' }, { command: 'operator', description: 'Позвать оператора' }, { command: 'bots', description: 'Ссылки на ботов' }, { command: 'help', description: 'Помощь' }]
                                    : [{ command: 'start', description: 'Открыть меню' }, { command: 'link', description: 'Привязать аккаунт: /link КОД' }, { command: 'help', description: 'Помощь' }]
                    });
                } catch (error) {
                    console.error(`Telegram ${role} command setup failed:`, safeError(error, bot.token));
                }
            } catch (error) {
                console.error(`Telegram ${role} token check failed:`, safeError(error, bot.token));
                return;
            }

            if (role === 'admin' && env.MY_CHAT_ID) {
                const notify = () => notifyAdmin(bot, env.MY_CHAT_ID, env).catch(error =>
                    console.error('Telegram admin notifications failed:', safeError(error, bot.token))
                );
                const timer = setInterval(notify, 15000);
                timer.unref?.();
                timers.push(timer);
                notify();
            }

            while (!stopping) {
                try {
                    const updates = await bot.telegram('getUpdates', {
                        offset,
                        timeout: 25,
                        allowed_updates: ['message', 'callback_query']
                    });
                    for (const update of updates) {
                        offset = update.update_id + 1;
                        if (!isPrivateUpdate(update)) continue;
                        const chatId = updateChatId(update);
                        if (!ownerAllowed(role, chatId, env)) continue;
                        try {
                            await processTelegramUpdate(role, update, { env, fetch: request });
                        } catch (error) {
                            console.error(`Telegram ${role} update failed:`, safeError(error, bot.token));
                            const userMessage = userFacingError(error);
                            if (chatId) await bot.send(chatId, userMessage).catch(() => {});
                        }
                    }
                    retryDelay = 3000;
                } catch (error) {
                    console.error(`Telegram ${role} polling failed:`, safeError(error, bot.token));
                    if (stopping || [400, 401, 409].includes(error.telegramStatus)) break;
                    const delay = error.retryAfter
                        ? Math.min(60000, error.retryAfter * 1000)
                        : retryDelay;
                    await new Promise(resolve => setTimeout(resolve, delay));
                    retryDelay = Math.min(60000, retryDelay * 2);
                }
            }
        })();
    }

    return {
        stop() {
            stopping = true;
            for (const timer of timers) clearInterval(timer);
        },
        roles: [...bots.keys()]
    };
}

module.exports = {
    startTelegramBots,
    getPublicBotLinks,
    processTelegramUpdate,
    getBotState: (role, chatId) => getState(role, chatId),
    setBotState: (role, chatId, state) => setState(role, chatId, state)
};
