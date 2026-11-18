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
        const panelChatId = env.M_CHAT_ID || env.PANEL_CHAT_ID;
        return Boolean(panelChatId) && chatId === panelChatId;
    }
    return true;
}

function menuKeyboard(role) {
    if (role === 'client') {
        return {
            keyboard: [
                [{ text: '📚 Каталог' }, { text: '📦 Мои заказы' }],
                [{ text: '🔗 Связать аккаунт' }, { text: 'ℹ️ Помощь' }]
            ],
            resize_keyboard: true
        };
    }
    if (role === 'support') {
        return {
            keyboard: [
                [{ text: '🆘 Нужен оператор' }, { text: '📨 Моё обращение' }],
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
                [{ text: '✉️ Email-рассылка' }]
            ],
            resize_keyboard: true
        };
    }
    if (role === 'panel') {
        return {
            keyboard: [
                [{ text: '📦 Заказы' }, { text: '➕ Новый заказ' }],
                [{ text: '🛍 Товары' }, { text: '➕ Новый товар' }]
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

async function showCatalog(bot, chatId) {
    const { products = [] } = await bot.callApi('/client/catalog', chatId);
    const lines = products.slice(0, 30).map(product =>
        `• ${safeText(product.name, 120)} — ${Number.isFinite(Number(product.price)) ? `${Number(product.price)} ₽` : 'уточняйте цену'}`
    );
    await bot.send(chatId, lines.length ? `Каталог:\n\n${lines.join('\n')}` : 'Каталог пока пуст.');
}

async function showCustomerOrders(bot, chatId) {
    const result = await bot.callApi('/client/orders', chatId);
    if (!result.linked) {
        await bot.send(chatId, 'Чтобы показать ваши заказы, сначала привяжите Telegram в профиле на сайте.');
        return;
    }
    await bot.send(chatId, formatOrders(result.orders));
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

    const now = Date.now();
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
        await createTicket(
            bot,
            chatId,
            user,
            message,
            TOPICS.includes(response.escalation.topic) ? response.escalation.topic : 'Другое'
        );
        return;
    }
    await bot.send(chatId, response.reply);
}

async function listAdminTickets(bot, chatId) {
    const { tickets = [] } = await bot.callApi('/admin/tickets', chatId);
    if (!tickets.length) {
        await bot.send(chatId, 'Открытых обращений нет.', { reply_markup: menuKeyboard('admin') });
        return;
    }
    for (const ticket of tickets.slice(0, 20)) {
        const text = `Обращение №${ticket.ticket_number}\nТема: ${safeText(ticket.topic, 60)}\nTelegram: ${safeText(ticket.telegram_username ? `@${ticket.telegram_username}` : ticket.telegram_chat_id, 80)}\nСоздано: ${new Date(ticket.created_at).toLocaleString('ru-RU')}`;
        await bot.send(chatId, text, {
            reply_markup: inline([[{ text: 'Переписка', callback_data: `adm:t:${ticket.id}` }, { text: 'Ответить', callback_data: `adm:r:${ticket.id}` }, { text: 'Закрыть', callback_data: `adm:c:${ticket.id}` }]])
        });
    }
}

async function listAdminReviews(bot, chatId) {
    const { reviews = [] } = await bot.callApi('/admin/reviews', chatId);
    if (!reviews.length) {
        await bot.send(chatId, 'Ожидающих модерации отзывов нет.', { reply_markup: menuKeyboard('admin') });
        return;
    }
    for (const review of reviews.slice(0, 20)) {
        const text = `${safeText(review.user_name, 80)} · ${review.rating}/5\n${safeText(review.review_text, 2500)}`;
        await bot.send(chatId, text, {
            reply_markup: inline([[{ text: '✅ Одобрить', callback_data: `adm:ra:${review.id}` }, { text: '❌ Отклонить', callback_data: `adm:rr:${review.id}` }]])
        });
    }
}

async function listOrders(bot, chatId) {
    const result = await bot.callApi('/panel/orders', chatId);
    if (!result.orders?.length) {
        await bot.send(chatId, 'Заказов пока нет.', { reply_markup: menuKeyboard('panel') });
        return;
    }
    for (const order of result.orders.slice(0, 15)) {
        const text = `Заказ ${safeText(order.id, 40)}\n${formatOrders([order])}\nПозиции: ${Array.isArray(order.items) ? order.items.map(item => `${safeText(item.name || item.product_id, 80)} × ${item.quantity || 1}`).join(', ') : '—'}`;
        const buttons = ORDER_STATUSES.map(status => ({
            text: `${order.status === status ? '• ' : ''}${status}`,
            callback_data: `p:o:${order.id}:${status}`
        }));
        await bot.send(chatId, text, { reply_markup: inline(buttons.reduce((rows, button, index) => {
            const row = Math.floor(index / 3);
            rows[row] ||= [];
            rows[row].push(button);
            return rows;
        }, [])) });
    }
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
        const result = await bot.callApi('/panel/products', chatId, { method: 'POST', body: JSON.stringify(product) });
        setState('panel', chatId, {});
        await bot.send(chatId, `Товар опубликован: ${safeText(result.product.name, 160)} · ${Number(result.product.price)} ₽`, { reply_markup: menuKeyboard('panel') });
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
        }
        await bot.callApi(`/panel/products/${encodeURIComponent(productId)}`, chatId, {
            method: 'PATCH',
            body: JSON.stringify({ [field]: value })
        });
        setState('panel', chatId, {});
        await bot.send(chatId, 'Товар обновлён.', { reply_markup: menuKeyboard('panel') });
    }
}

async function handleCallback(config, bot, callback, chatId) {
    const data = String(callback.data || '');
    await bot.answerCallback(callback.id);
    if (config.role === 'support') {
        if (data.startsWith('s:topic:')) {
            const topicIndex = Number(data.slice('s:topic:'.length));
            const topic = TOPICS[topicIndex];
            if (!topic) return;
            setState('support', chatId, { topic, awaitingTopicMessage: true });
            await bot.send(chatId, `Тема «${topic}». Кратко опишите вопрос, и я передам его оператору.`);
        } else if (data === 's:close') {
            const { ticket } = await getMyTicket(bot, chatId);
            if (!ticket) {
                await bot.send(chatId, 'У вас нет открытого обращения.');
                return;
            }
            await bot.callApi(`/support/tickets/${ticket.id}/close`, chatId, { method: 'POST', body: '{}' });
            await bot.send(chatId, `Обращение №${ticket.ticket_number} закрыто.`);
        }
        return;
    }
    if (config.role === 'admin') {
        if (data === 'adm:email') {
            setState('admin', chatId, { flow: 'email-recipient' });
            await bot.send(chatId, 'Укажите точный email подтверждённого аккаунта или отправьте `all`, чтобы написать пользователям, которые сами включили email-уведомления. Для отмены: /cancel.');
            return;
        }
        if (data === 'adm:email:cancel') {
            setState('admin', chatId, {});
            await bot.send(chatId, 'Рассылка отменена.', { reply_markup: menuKeyboard('admin') });
            return;
        }
        if (data === 'adm:email:send') {
            const state = getState('admin', chatId);
            if (state.flow !== 'email-confirm') return;
            const result = await bot.callApi('/admin/email/send', chatId, {
                method: 'POST',
                body: JSON.stringify({ target: state.target, subject: state.subject, text: state.text })
            });
            setState('admin', chatId, {});
            await bot.send(chatId, `Рассылка завершена.\nОтправлено: ${result.sent}\nОшибок доставки: ${result.failed}`, { reply_markup: menuKeyboard('admin') });
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
            await bot.callApi(`/admin/reviews/${id}`, chatId, {
                method: 'PATCH',
                body: JSON.stringify({ status: action === 'ra' ? 'approved' : 'rejected' })
            });
            await bot.editCallbackMessage(callback, action === 'ra' ? 'Отзыв одобрен.' : 'Отзыв отклонён.');
        } else if (action === 'c') {
            await bot.callApi(`/admin/tickets/${id}`, chatId, { method: 'PATCH', body: JSON.stringify({ status: 'closed' }) });
            await bot.editCallbackMessage(callback, 'Обращение закрыто.');
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
        const statusMatch = /^p:o:([A-Za-z0-9_-]{1,120}):(pending|processing|shipped|delivered|cancelled)$/.exec(data);
        if (statusMatch) {
            await bot.callApi(`/panel/orders/${encodeURIComponent(statusMatch[1])}`, chatId, {
                method: 'PATCH',
                body: JSON.stringify({ status: statusMatch[2] })
            });
            await bot.send(chatId, `Статус заказа обновлён: ${statusMatch[2]}.`);
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
            if (text === '📦 Мои заказы' || text === '/orders') return showCustomerOrders(bot, chatId);
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
            const { ticket } = await getMyTicket(bot, chatId);
            if (!ticket) {
                await bot.send(chatId, 'Открытых обращений нет. Если нужен оператор, выберите «Нужен оператор».');
                return;
            }
            await bot.send(chatId, `Обращение №${ticket.ticket_number}\nТема: ${safeText(ticket.topic, 60)}\nСтатус: открыто`, {
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
        if (adminState.flow === 'email-recipient' || adminState.flow === 'email-subject' || adminState.flow === 'email-text') {
            if (text === '/cancel') {
                setState('admin', chatId, {});
                await bot.send(chatId, 'Рассылка отменена.', { reply_markup: menuKeyboard('admin') });
                return;
            }
            if (adminState.flow === 'email-recipient') {
                const target = text.toLowerCase();
                if (target !== 'all' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) {
                    await bot.send(chatId, 'Введите корректный точный email аккаунта или `all`.');
                    return;
                }
                setState('admin', chatId, { flow: 'email-subject', target });
                await bot.send(chatId, 'Введите тему письма (до 150 символов).');
                return;
            }
            if (adminState.flow === 'email-subject') {
                if (!text || text.length > 150) {
                    await bot.send(chatId, 'Тема должна быть от 1 до 150 символов.');
                    return;
                }
                setState('admin', chatId, { ...adminState, flow: 'email-text', subject: text });
                await bot.send(chatId, 'Введите текст письма (до 4000 символов).');
                return;
            }
            if (!text || text.length > 4000) {
                await bot.send(chatId, 'Текст должен быть от 1 до 4000 символов.');
                return;
            }
            const nextState = { ...adminState, flow: 'email-confirm', text };
            setState('admin', chatId, nextState);
            await bot.send(chatId, `Проверьте письмо:\n\nКому: ${nextState.target === 'all' ? 'подписчикам email-уведомлений' : safeText(nextState.target, 160)}\nТема: ${safeText(nextState.subject, 150)}\n\n${safeText(nextState.text, 2500)}`, {
                reply_markup: inline([[{ text: '✅ Подтвердить отправку', callback_data: 'adm:email:send' }, { text: 'Отмена', callback_data: 'adm:email:cancel' }]])
            });
            return;
        }
        if (text.startsWith('/start')) {
            await bot.send(chatId, 'Админ-панель Dr. DarSun. Доступ разрешён только владельцу.', { reply_markup: menuKeyboard('admin') });
        } else if (text === '🆘 Обращения' || text === '/tickets') {
            await listAdminTickets(bot, chatId);
        } else if (text === '✍️ Отзывы' || text === '/reviews') {
            await listAdminReviews(bot, chatId);
        } else if (text === '📦 Заказы' || text === '/orders') {
            const { orders = [] } = await bot.callApi('/admin/orders', chatId);
            await bot.send(chatId, formatOrders(orders), { reply_markup: menuKeyboard('admin') });
        } else if (text === '🛠 Техперерыв' || text === '/maintenance') {
            const { enabled } = await bot.callApi('/admin/maintenance', chatId);
            await bot.send(chatId, `Состояние сайта: ${enabled ? 'техперерыв включён' : 'сайт работает'}.\nВыберите действие:`, {
                reply_markup: inline([
                    [{ text: '⏸ Включить техперерыв', callback_data: 'adm:maint:on' }],
                    [{ text: '▶️ Возобновить сайт', callback_data: 'adm:maint:off' }]
                ])
            });
        } else if (text === '✉️ Email-рассылка' || text === '/email') {
            setState('admin', chatId, { flow: 'email-recipient' });
            await bot.send(chatId, 'Укажите точный email подтверждённого аккаунта или отправьте `all`, чтобы написать пользователям, которые сами включили email-уведомления. Для отмены: /cancel.');
        } else if (text === '/help') {
            await bot.send(chatId, 'Используйте кнопки для обращений, модерации, заказов, техперерыва и email-рассылки. Массовое письмо отправляется только пользователям с включёнными уведомлениями.');
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
        } else if (text === '📦 Заказы' || text === '/orders') {
            await listOrders(bot, chatId);
        } else if (text === '➕ Новый заказ' || text === '/neworder') {
            await startNewOrder(bot, chatId);
        } else if (text === '🛍 Товары' || text === '/products') {
            await listProducts(bot, chatId);
        } else if (text === '➕ Новый товар' || text === '/newproduct') {
            await startNewProduct(bot, chatId);
        } else if (text === '/help') {
            await bot.send(chatId, 'Кнопки: список/изменение статуса заказов, создание заказа, просмотр/изменение и публикация товара. /cancel отменяет текущий ввод.');
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
                                ? [{ command: 'start', description: 'Открыть админ-меню' }, { command: 'tickets', description: 'Обращения' }, { command: 'reviews', description: 'Отзывы на модерации' }, { command: 'orders', description: 'Заказы' }, { command: 'maintenance', description: 'Техперерыв сайта' }, { command: 'email', description: 'Написать аккаунту или подписчикам' }]
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
                            if (update.callback_query) {
                                await handleCallback({ role }, bot, update.callback_query, chatId);
                            } else if (update.message) {
                                await handleMessage({ role }, bot, update.message);
                            }
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

module.exports = { startTelegramBots, getPublicBotLinks };
