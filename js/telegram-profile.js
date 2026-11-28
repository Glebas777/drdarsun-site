const TELEGRAM_API = 'https://drdarsun-site-main.layero.app/api/telegram';

async function telegramRequest(path, session, init = {}) {
    const response = await fetch(`${TELEGRAM_API}${path}`, {
        ...init,
        headers: {
            Authorization: `Bearer ${session.access_token}`,
            ...(init.body ? { 'Content-Type': 'application/json' } : {}),
            ...(init.headers || {})
        },
        cache: 'no-store'
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Не удалось выполнить действие с Telegram.');
    return result;
}

export async function initializeTelegramProfile(session) {
    const status = document.getElementById('telegram-account-status');
    const startButton = document.getElementById('telegram-account-start');
    const openLink = document.getElementById('telegram-account-open');
    const checkButton = document.getElementById('telegram-account-check');
    const unlinkButton = document.getElementById('telegram-account-remove');
    const notificationsToggle = document.getElementById('telegram-notifications-toggle');
    const notificationHelp = document.getElementById('telegram-notification-help');
    if (!status || !startButton || !openLink || !checkButton || !unlinkButton) return;

    let pendingUrl = '';
    let linked = false;

    async function refreshLink() {
        const result = await telegramRequest('/link', session);
        linked = result.linked === true;
        if (linked) {
            const username = result.account?.telegram_username;
            status.textContent = `Telegram подключён${username ? ` · @${username}` : ''}.`;
            pendingUrl = '';
            openLink.hidden = true;
            startButton.hidden = true;
            unlinkButton.hidden = false;
        } else {
            status.textContent = pendingUrl
                ? 'Откройте Telegram и подтвердите привязку, затем нажмите «Проверить привязку».'
                : 'Telegram пока не подключён.';
            openLink.hidden = !pendingUrl;
            startButton.hidden = false;
            unlinkButton.hidden = true;
        }
        checkButton.disabled = false;
        if (notificationsToggle) notificationsToggle.disabled = !linked;
        return linked;
    }

    try {
        await refreshLink();
    } catch (error) {
        status.textContent = 'Не удалось проверить подключение. Нажмите «Проверить привязку».';
        console.error('Telegram account status lookup failed:', error);
    }

    startButton.addEventListener('click', async () => {
        startButton.disabled = true;
        status.textContent = 'Создаём одноразовую ссылку…';
        try {
            const result = await telegramRequest('/link/start', session, {
                method: 'POST',
                body: '{}'
            });
            pendingUrl = result.url;
            openLink.href = pendingUrl;
            openLink.hidden = false;
            status.textContent = 'Ссылка действует 10 минут. Откройте бота, чтобы подтвердить привязку.';
        } catch (error) {
            status.textContent = error.message || 'Не удалось начать привязку Telegram.';
        } finally {
            startButton.disabled = false;
        }
    });

    openLink.addEventListener('click', () => {
        openLink.rel = 'noopener noreferrer';
    });

    checkButton.addEventListener('click', async () => {
        checkButton.disabled = true;
        status.textContent = 'Проверяем привязку…';
        try {
            await refreshLink();
        } catch (error) {
            status.textContent = error.message || 'Не удалось проверить привязку.';
        } finally {
            checkButton.disabled = false;
        }
    });

    unlinkButton.addEventListener('click', async () => {
        if (!window.confirm('Отключить Telegram? Уведомления и вход через этот аккаунт перестанут работать.')) return;
        unlinkButton.disabled = true;
        try {
            await telegramRequest('/link', session, { method: 'DELETE' });
            pendingUrl = '';
            await refreshLink();
            if (notificationsToggle) notificationsToggle.checked = false;
            if (notificationHelp) notificationHelp.textContent = 'Telegram отключён. Для уведомлений сначала подключите аккаунт.';
            window.showToast?.('Telegram отключён.');
        } catch (error) {
            window.showToast?.(error.message || 'Не удалось отключить Telegram.', 'error');
        } finally {
            unlinkButton.disabled = false;
        }
    });

    if (notificationsToggle) {
        try {
            const result = await telegramRequest('/notifications', session);
            notificationsToggle.checked = result.telegramEnabled === true;
            notificationsToggle.disabled = !linked;
            if (notificationHelp) {
                notificationHelp.textContent = linked
                    ? 'Коды входа приходят отдельно и только по вашему запросу.'
                    : 'Сначала подключите Telegram во вкладке «Безопасность».';
            }
        } catch (error) {
            notificationsToggle.disabled = true;
            if (notificationHelp) notificationHelp.textContent = 'Не удалось загрузить настройку. Обновите страницу.';
            console.error('Telegram notification settings lookup failed:', error);
        }

        notificationsToggle.addEventListener('change', async () => {
            const requestedValue = notificationsToggle.checked;
            notificationsToggle.disabled = true;
            try {
                const result = await telegramRequest('/notifications', session, {
                    method: 'PATCH',
                    body: JSON.stringify({ telegramEnabled: requestedValue })
                });
                notificationsToggle.checked = result.telegramEnabled === true;
                window.showToast?.(requestedValue
                    ? 'Telegram-уведомления включены.'
                    : 'Telegram-уведомления отключены.');
            } catch (error) {
                notificationsToggle.checked = !requestedValue;
                window.showToast?.(error.message || 'Не удалось изменить настройку.', 'error');
            } finally {
                notificationsToggle.disabled = !linked;
            }
        });
    }

    window.addEventListener('focus', () => {
        if (!linked && pendingUrl) {
            refreshLink().catch(error => {
                console.error('Telegram account status refresh failed:', error);
            });
        }
    });
}
