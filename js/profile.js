import { supabase } from './supabase-client.js';
import { approveQrLogin, getQrLoginId, startQrScanner } from './qr-login.js';
import { getFavoriteProducts, toggleFavorite } from './favorites.js';
import { addToCart } from './cart.js';

let resolveProfileDeviceSetup;
window.profileDeviceSetup = new Promise(resolve => {
    resolveProfileDeviceSetup = resolve;
});

// Функция для тостов
window.showToast = function(message, type = 'success') {
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 400);
    }, 3000);
};

// Функция выбора готовой аватарки (вызывается из HTML)
window.selectAvatar = async function(src) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const { error } = await supabase
        .from('wallets')
        .upsert({ user_id: session.user.id, avatar_url: src }, { onConflict: 'user_id' });

    if (error) {
        showToast('Ошибка: ' + error.message, 'error');
    } else {
        document.getElementById('current-avatar').src = src;
        document.getElementById('avatar-modal').style.display = 'none';
        showToast('Аватарка обновлена!');
    }
};

async function ensureCurrentDevice(session) {
    let deviceKey = localStorage.getItem('device_key');
    const deviceUserId = localStorage.getItem('device_user_id');
    const pendingUserId = localStorage.getItem('pending_device_registration');

    const registerDevice = async () => {
        deviceKey = crypto.randomUUID();
        localStorage.setItem('device_key', deviceKey);
        localStorage.setItem('device_user_id', session.user.id);
        const { error } = await supabase.from('devices').upsert({
            user_id: session.user.id,
            device_key: deviceKey,
            device_name: navigator.userAgent,
            last_active: new Date().toISOString()
        }, { onConflict: 'device_key' });
        if (error) {
            localStorage.removeItem('device_key');
            localStorage.removeItem('device_user_id');
            throw error;
        }
        localStorage.removeItem('pending_device_registration');
        return deviceKey;
    };

    if (!deviceKey || (deviceUserId && deviceUserId !== session.user.id)) {
        return registerDevice();
    }

    const { data, error } = await supabase
        .from('devices')
        .select('device_key')
        .eq('user_id', session.user.id)
        .eq('device_key', deviceKey)
        .maybeSingle();
    if (error) throw error;
    if (!data) {
        if (pendingUserId === session.user.id) return registerDevice();
        return null;
    }
    if (!deviceUserId) localStorage.setItem('device_user_id', session.user.id);
    localStorage.removeItem('pending_device_registration');
    return deviceKey;
}

async function init() {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session) {
        showToast('Сессия истекла. Войдите заново.', 'error');
        resolveProfileDeviceSetup();
        return window.location.href = 'login.html';
    }
    try {
        const deviceKey = await ensureCurrentDevice(session);
        if (!deviceKey) {
            localStorage.removeItem('device_key');
            localStorage.removeItem('device_user_id');
            await supabase.auth.signOut({ scope: 'local' });
            resolveProfileDeviceSetup();
            return window.location.href = 'index.html';
        }
    } catch (error) {
        console.error('Device session registration failed:', error);
        showToast('Не удалось проверить активную сессию. Обновите страницу.', 'error');
        resolveProfileDeviceSetup();
        return;
    }
    resolveProfileDeviceSetup();

    // 1. ДАННЫЕ
    document.getElementById('user-name').textContent = session.user.user_metadata.full_name || 'Гость';
    document.getElementById('user-email').textContent = session.user.email;
    document.getElementById('settings-name').value = session.user.user_metadata.full_name || '';
    document.getElementById('settings-email').value = session.user.email || '';

    const telegramLinkStatus = document.getElementById('telegram-link-status');
    const telegramLinkStart = document.getElementById('telegram-link-start');
    const telegramLinkRemove = document.getElementById('telegram-link-remove');
    const telegramLinkCode = document.getElementById('telegram-link-code');
    const telegramLinkCodeValue = document.getElementById('telegram-link-code-value');
    const telegramLinkCopy = document.getElementById('telegram-link-copy');
    const telegramLinkCodeActions = document.getElementById('telegram-link-code-actions');
    const telegramPublicBots = document.getElementById('telegram-public-bots');
    const telegramApiBase = 'https://drdarsun-site-main.layero.app/api/telegram';
    const telegramApiUrl = `${telegramApiBase}/link`;
    let publicTelegramBots = [];

    function renderTelegramBotLinks(code = '') {
        if (telegramPublicBots) {
            telegramPublicBots.replaceChildren();
            for (const bot of publicTelegramBots) {
                const link = document.createElement('a');
                link.className = 'btn';
                link.href = bot.url;
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                link.textContent = `${bot.label} · @${bot.username}`;
                telegramPublicBots.appendChild(link);
            }
            if (!publicTelegramBots.length) {
                const message = document.createElement('span');
                message.className = 'security-help';
                message.textContent = 'Ссылки на Telegram-ботов временно недоступны.';
                telegramPublicBots.appendChild(message);
            }
        }

        if (telegramLinkCodeActions) {
            telegramLinkCodeActions.replaceChildren();
            if (code) {
                const linkBot = publicTelegramBots.find(bot => bot.role === 'auth') ||
                    publicTelegramBots.find(bot => bot.role === 'client');
                if (linkBot) {
                    const link = document.createElement('a');
                    link.className = 'btn btn--primary';
                    link.href = `${linkBot.url}?start=${encodeURIComponent(code)}`;
                    link.target = '_blank';
                    link.rel = 'noopener noreferrer';
                    link.textContent = `Открыть @${linkBot.username} и привязать`;
                    telegramLinkCodeActions.appendChild(link);
                }
            }
        }
    }

    async function loadPublicTelegramBots() {
        const response = await fetch(`${telegramApiBase}/public-bots`, { cache: 'no-store' });
        const result = await response.json().catch(() => null);
        if (!response.ok) throw new Error(result?.error || 'Не удалось получить ссылки на Telegram-ботов.');
        publicTelegramBots = Array.isArray(result?.bots)
            ? result.bots.filter(bot =>
                bot &&
                ['client', 'support', 'auth'].includes(bot.role) &&
                typeof bot.username === 'string' &&
                /^https:\/\/t\.me\/[A-Za-z0-9_]+$/.test(bot.url)
            )
            : [];
        renderTelegramBotLinks(telegramLinkCodeValue?.textContent || '');
    }

    async function refreshTelegramLink() {
        await loadPublicTelegramBots().catch(error => {
            console.warn('Telegram public bot links are not available:', error.message);
        });
        const response = await fetch(telegramApiUrl, {
            headers: { Authorization: `Bearer ${session.access_token}` }
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Не удалось проверить подключение Telegram.');
        const account = result.account;
        telegramLinkStatus.textContent = account
            ? `Telegram подключён${account.telegram_username ? `: @${account.telegram_username}` : ''}.`
            : 'Telegram пока не подключён.';
        telegramLinkStart.hidden = Boolean(account);
        telegramLinkRemove.hidden = !account;
        if (account) telegramLinkCode.hidden = true;
    }

    telegramLinkStart?.addEventListener('click', async () => {
        telegramLinkStart.disabled = true;
        try {
            const response = await fetch(`${telegramApiUrl}/start`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${session.access_token}`,
                    'Content-Type': 'application/json'
                },
                body: '{}'
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Не удалось создать код привязки.');
            telegramLinkCodeValue.textContent = result.code;
            telegramLinkCode.hidden = false;
            await loadPublicTelegramBots();
            renderTelegramBotLinks(result.code);
        } catch (error) {
            showToast(error.message || 'Не удалось создать код привязки.', 'error');
        } finally {
            telegramLinkStart.disabled = false;
        }
    });

    telegramLinkCopy?.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(telegramLinkCodeValue.textContent);
            showToast('Код скопирован.');
        } catch (error) {
            console.error('Telegram link code copy failed:', error);
            showToast('Не удалось скопировать код. Выделите его и скопируйте вручную.', 'error');
        }
    });

    telegramLinkRemove?.addEventListener('click', async () => {
        if (!confirm('Отключить Telegram от этого аккаунта?')) return;
        telegramLinkRemove.disabled = true;
        try {
            const response = await fetch(telegramApiUrl, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${session.access_token}` }
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Не удалось отключить Telegram.');
            telegramLinkCode.hidden = true;
            await refreshTelegramLink();
            showToast('Telegram отключён.');
        } catch (error) {
            showToast(error.message || 'Не удалось отключить Telegram.', 'error');
        } finally {
            telegramLinkRemove.disabled = false;
        }
    });

    if (telegramLinkStatus && telegramLinkStart && telegramLinkRemove) {
        try {
            await refreshTelegramLink();
        } catch (error) {
            telegramLinkStatus.textContent = 'Не удалось проверить подключение Telegram.';
            console.error('Telegram link status check failed:', error);
        }
        let telegramStatusRefresh;
        const refreshVisibleTelegramStatus = () => {
            if (document.visibilityState !== 'visible') return;
            refreshTelegramLink().catch(error => {
                telegramLinkStatus.textContent = 'Не удалось проверить подключение Telegram.';
                console.error('Telegram link refresh failed:', error);
            });
        };
        document.addEventListener('visibilitychange', refreshVisibleTelegramStatus);
        window.addEventListener('focus', refreshVisibleTelegramStatus);
        telegramStatusRefresh = window.setInterval(refreshVisibleTelegramStatus, 10000);
        window.addEventListener('pagehide', () => window.clearInterval(telegramStatusRefresh), { once: true });
    }

    // 2. АВАТАРКА
    const avatarInput = document.getElementById('avatar-input');
    const currentAvatar = document.getElementById('current-avatar');
    const editorModal = document.getElementById('avatar-editor-modal');
    const editorImage = document.getElementById('editor-image');
    const cropArea = document.getElementById('crop-area');
    const editorSave = document.getElementById('editor-save');
    const editorCancel = document.getElementById('editor-cancel');
    const chooseAvatarBtn = document.getElementById('choose-avatar-btn');
    const avatarModal = document.getElementById('avatar-modal');

    if (currentAvatar) {
        const { data: w } = await supabase.from('wallets').select('avatar_url').eq('user_id', session.user.id).maybeSingle();
        if (w && w.avatar_url) currentAvatar.src = w.avatar_url;
    }

    let isDragging = false;
    let startX = 0, startY = 0;
    let imgX = 0, imgY = 0;

    if (avatarInput) {
        avatarInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            if (file.size > 10 * 1024 * 1024) {
                showToast('Файл слишком большой. Максимум 10 МБ.', 'error');
                avatarInput.value = '';
                return;
            }
            const reader = new FileReader();
            reader.onload = (event) => {
                editorImage.src = event.target.result;
                editorImage.style.transform = 'translate(0px, 0px)';
                imgX = 0; imgY = 0;
                editorModal.style.display = 'flex';
            };
            reader.readAsDataURL(file);
        });
    }

    if (chooseAvatarBtn) {
        chooseAvatarBtn.addEventListener('click', () => {
            avatarModal.style.display = 'flex';
        });
    }

    if (cropArea) {
        cropArea.addEventListener('mousedown', (e) => {
            isDragging = true;
            startX = e.clientX - imgX;
            startY = e.clientY - imgY;
            cropArea.style.cursor = 'grabbing';
        });
        window.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            imgX = e.clientX - startX;
            imgY = e.clientY - startY;
            editorImage.style.transform = `translate(${imgX}px, ${imgY}px)`;
        });
        window.addEventListener('mouseup', () => {
            isDragging = false;
            cropArea.style.cursor = 'grab';
        });
    }

    if (editorSave) {
        editorSave.addEventListener('click', async () => {
            const canvas = document.createElement('canvas');
            canvas.width = 300;
            canvas.height = 300;
            const ctx = canvas.getContext('2d');
            ctx.beginPath();
            ctx.arc(150, 150, 150, 0, Math.PI * 2);
            ctx.clip();

            const img = new Image();
            img.onload = async () => {
                const drawX = (canvas.width - img.width) / 2 + imgX;
                const drawY = (canvas.height - img.height) / 2 + imgY;
                ctx.drawImage(img, drawX, drawY, img.width, img.height);

                const base64 = canvas.toDataURL('image/jpeg', 0.8);

                const { error } = await supabase
                    .from('wallets')
                    .upsert({ user_id: session.user.id, avatar_url: base64 }, { onConflict: 'user_id' });

                if (error) showToast('Ошибка: ' + error.message, 'error');
                else {
                    currentAvatar.src = base64;
                    showToast('Аватарка обновлена!');
                    editorModal.style.display = 'none';
                }
            };
            img.src = editorImage.src;
        });
    }

    if (editorCancel) {
        editorCancel.addEventListener('click', () => {
            editorModal.style.display = 'none';
            avatarInput.value = '';
        });
    }

    // 3. КОШЕЛЕК
    const walletEl = document.getElementById('wallet-balance');
    if (walletEl) {
        const { data: w } = await supabase.from('wallets').select('balance').eq('user_id', session.user.id).maybeSingle();
        walletEl.textContent = w ? `${w.balance} ₽` : '0 ₽';
    }

    // 4. ИСТОРИЯ ОПЕРАЦИЙ
    const transactionsList = document.getElementById('transactions-list');
    if (transactionsList) {
        const { data: tx } = await supabase.from('transactions').select('*').eq('user_id', session.user.id).order('created_at', { ascending: false });
        if (!tx || tx.length === 0) {
            transactionsList.innerHTML = '<div class="empty-state">Пока нет операций.</div>';
        } else {
            transactionsList.innerHTML = tx.map(t => `
                <div style="display: flex; justify-content: space-between; padding: 10px; border-bottom: 1px solid var(--border);">
                    <span>${t.type === 'deposit' ? 'Пополнение' : 'Списание'}</span>
                    <span style="color: ${t.type === 'deposit' ? 'green' : 'red'};">${t.type === 'deposit' ? '+' : '-'}${t.amount} ₽</span>
                </div>
            `).join('');
        }
    }

    // 5. ЗАКАЗЫ
    const ordersList = document.getElementById('orders-list');
    if (ordersList) {
        const { data: orders } = await supabase.from('orders').select('*').eq('user_id', session.user.id).order('created_at', { ascending: false });
        if (!orders || orders.length === 0) {
            ordersList.innerHTML = '<div class="empty-state">У вас пока нет заказов.</div>';
        } else {
            ordersList.innerHTML = orders.map(o => `
                <div class="order-card">
                    <div class="order-header">
                        <strong>Заказ #${o.id.split('-')[0]}</strong>
                        <span class="order-status" style="background: rgba(212,175,55,0.2); color: #D4AF37; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600;">${o.status || 'В обработке'}</span>
                </div>
                    <div style="font-size: 14px; color: var(--text-muted);">Товары: ${Array.isArray(o.items) ? o.items.length : '0'} шт.</div>
                    <div style="margin-top: 10px; font-weight: 600; color: var(--accent-green);">Итого: ${o.total} ₽</div>
                </div>
            `).join('');
        }
    }

    const favoritesList = document.getElementById('favorites-list');
    async function loadFavorites() {
        if (!favoritesList) return;
        try {
            const products = await getFavoriteProducts(session.user.id);
            favoritesList.replaceChildren();
            if (!products.length) {
                const empty = document.createElement('p');
                empty.className = 'empty-state favorites-empty';
                empty.textContent = 'Пока ничего не сохранено. Нажмите на сердечко у понравившегося товара.';
                favoritesList.appendChild(empty);
                return;
            }

            products.forEach(product => {
                const card = document.createElement('article');
                card.className = 'favorite-card';
                const link = document.createElement('a');
                link.className = 'favorite-card__image';
                link.href = `product.html?id=${encodeURIComponent(product.id)}`;
                const image = document.createElement('img');
                image.src = product.image_url || 'assets/images/logo.png';
                image.alt = product.name || 'Товар Dr. DarSun';
                image.loading = 'lazy';
                link.appendChild(image);

                const details = document.createElement('div');
                details.className = 'favorite-card__details';
                const category = document.createElement('span');
                category.className = 'favorite-card__category';
                category.textContent = product.category || 'Dr. DarSun';
                const title = document.createElement('a');
                title.className = 'favorite-card__title';
                title.href = link.href;
                title.textContent = product.name || 'Товар';
                const price = document.createElement('strong');
                price.className = 'favorite-card__price';
                price.textContent = `${new Intl.NumberFormat('ru-RU').format(Number(product.price) || 0)} ₽`;
                const actions = document.createElement('div');
                actions.className = 'favorite-card__actions';
                const addButton = document.createElement('button');
                addButton.className = 'btn btn--primary';
                addButton.type = 'button';
                addButton.textContent = 'В корзину';
                addButton.addEventListener('click', () => addToCart({
                    id: product.id,
                    name: product.name,
                    price: Number(product.price),
                    image: product.image_url
                }));
                const removeButton = document.createElement('button');
                removeButton.className = 'btn favorite-card__remove';
                removeButton.type = 'button';
                removeButton.textContent = 'Убрать';
                removeButton.addEventListener('click', async () => {
                    removeButton.disabled = true;
                    try {
                        await toggleFavorite(session.user.id, product.id);
                        await loadFavorites();
                    } catch (error) {
                        removeButton.disabled = false;
                        showToast('Не удалось изменить избранное: ' + error.message, 'error');
                    }
                });
                actions.append(addButton, removeButton);
                details.append(category, title, price, actions);
                card.append(link, details);
                favoritesList.appendChild(card);
            });
        } catch (error) {
            console.error('Favorites load failed:', error);
            favoritesList.replaceChildren();
            const message = document.createElement('p');
            message.className = 'empty-state';
            message.textContent = 'Не удалось загрузить избранное. Проверьте подключение и повторите попытку.';
            favoritesList.appendChild(message);
        }
    }

    await loadFavorites();

    // 6. ВКЛАДКИ
    document.querySelectorAll('.profile-nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.profile-nav-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.profile-tab').forEach(t => t.classList.remove('active'));
            btn.classList.add('active');
            const tabId = btn.getAttribute('data-tab');
            document.getElementById('tab-' + tabId)?.classList.add('active');
        });
    });
    const requestedTab = window.location.hash === '#settings' ? 'settings' : null;
    if (requestedTab) {
        document.querySelector(`.profile-nav-btn[data-tab="${requestedTab}"]`)?.click();
    }

    // --- УСТРОЙСТВА ---
    const devicesList = document.getElementById('devices-list');
    const refreshDevicesBtn = document.getElementById('refresh-devices-btn');

    async function loadDevices() {
        if (!devicesList) return;
        let deviceKey = localStorage.getItem('device_key');
        if (!deviceKey) return;

        const { data: devices, error } = await supabase
            .from('devices')
            .select('device_key,device_name,last_active')
            .eq('user_id', session.user.id)
            .order('last_active', { ascending: false });

        devicesList.replaceChildren();
        if (error || !devices || devices.length === 0) {
            const emptyState = document.createElement('p');
            emptyState.className = 'empty-state';
            emptyState.textContent = error ? 'Не удалось загрузить список устройств.' : 'Нет активных устройств.';
            devicesList.appendChild(emptyState);
        } else {
            devices.forEach(device => {
                const item = document.createElement('button');
                item.type = 'button';
                item.className = 'device-item';

                const details = document.createElement('span');
                details.className = 'device-item__details';
                const name = document.createElement('strong');
                name.textContent = device.device_name || 'Неизвестное устройство';
                const lastActive = document.createElement('span');
                lastActive.className = 'device-item__date';
                lastActive.textContent = new Date(device.last_active).toLocaleString('ru-RU');
                details.append(name, lastActive);
                item.appendChild(details);

                if (device.device_key === deviceKey) {
                    const current = document.createElement('span');
                    current.className = 'device-item__current';
                    current.textContent = 'Это устройство';
                    item.appendChild(current);
                }

                item.addEventListener('click', () => {
                    document.getElementById('modal-device-name').textContent = device.device_name || 'Неизвестное устройство';
                    document.getElementById('modal-device-date').textContent = new Date(device.last_active).toLocaleString('ru-RU');
                    document.getElementById('device-modal').style.display = 'flex';
                    document.getElementById('modal-end-btn').textContent = device.device_key === deviceKey
                        ? 'Выйти с этого устройства'
                        : 'Завершить сессию';
                    document.getElementById('modal-end-btn').onclick = async () => {
                        const { data: removedDevices, error: removeError } = await supabase
                            .from('devices')
                            .delete()
                            .eq('user_id', session.user.id)
                            .eq('device_key', device.device_key)
                            .select('device_key');
                        if (removeError) {
                            showToast('Не удалось завершить сессию: ' + removeError.message, 'error');
                            return;
                        }
                        if (!removedDevices?.length) {
                            showToast('Эта сессия уже завершена.', 'error');
                            document.getElementById('device-modal').style.display = 'none';
                            return loadDevices();
                        }
                        document.getElementById('device-modal').style.display = 'none';
                        if (device.device_key === deviceKey) {
                            await supabase.auth.signOut({ scope: 'local' });
                            window.location.href = 'index.html';
                        } else {
                            showToast('Сессия завершена. Устройство выйдет из аккаунта в течение нескольких секунд.');
                            await loadDevices();
                        }
                    };
                });
                devicesList.appendChild(item);
            });
        }
        document.getElementById('modal-close-btn').onclick = () => {
            document.getElementById('device-modal').style.display = 'none';
        };

        // Добавляем кнопки ВНУТРИ функции, после рендера (они не пропадут)
        const controls = document.createElement('div');
        controls.className = 'session-controls';

        const logoutOtherBtn = document.createElement('button');
        logoutOtherBtn.className = 'btn';
        logoutOtherBtn.type = 'button';
        logoutOtherBtn.classList.add('session-control-btn');
        logoutOtherBtn.textContent = 'Завершить все сессии, кроме этой';
logoutOtherBtn.onclick = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    // 1. Удаляем все устройства, кроме текущего, из БД
    const currentKey = localStorage.getItem('device_key');
    const { error: deleteError } = await supabase
        .from('devices')
        .delete()
        .eq('user_id', session.user.id)
        .neq('device_key', currentKey);
    if (deleteError) {
        showToast('Не удалось завершить другие сессии: ' + deleteError.message, 'error');
        return;
    }

    // 2. Просим Layero отозвать все другие сессии
    let response;
    try {
        response = await fetch('https://drdarsun-site-main.layero.app/api/logout-others', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${session.access_token}` }
        });
    } catch (e) {
        console.warn('Layero logout-others error:', e);
    }

    showToast(
        response?.ok
            ? 'Все другие сессии завершены.'
            : 'Устройства отключаются. Не удалось подтвердить отзыв токенов — проверьте соединение.',
        response?.ok ? 'success' : 'error'
    );
    await loadDevices();
};

        const logoutAllBtn = document.createElement('button');
        logoutAllBtn.className = 'btn';
        logoutAllBtn.type = 'button';
        logoutAllBtn.classList.add('session-control-btn', 'session-control-btn--danger');
        logoutAllBtn.textContent = 'Завершить все сессии (включая эту)';
logoutAllBtn.onclick = async () => {
    if (!confirm('Вы уверены? Все устройства будут выкинуты.')) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    // 1. Удаляем все устройства
    const { error: deleteError } = await supabase.from('devices').delete().eq('user_id', session.user.id);
    if (deleteError) {
        showToast('Не удалось завершить сессии: ' + deleteError.message, 'error');
        return;
    }

    // 2. Просим Layero отозвать ВСЕ сессии
    let response;
    try {
        response = await fetch('https://drdarsun-site-main.layero.app/api/logout-all', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${session.access_token}` }
        });
    } catch (e) {
        console.warn('Layero logout-all error:', e);
    }

    if (!response?.ok) {
        showToast('Сессии отключены на устройствах. Не удалось подтвердить отзыв токенов.', 'error');
    }
    await supabase.auth.signOut({ scope: 'local' });
    window.location.href = 'index.html';
};

        controls.appendChild(logoutOtherBtn);
        controls.appendChild(logoutAllBtn);
        devicesList.appendChild(controls);
    }

    refreshDevicesBtn?.addEventListener('click', loadDevices);

    document.querySelectorAll('.profile-nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.getAttribute('data-tab') === 'security') {
                loadDevices();
            }
        });
    });

    await loadDevices();

const toggle2fa = document.getElementById('2fa-toggle');
const status2fa = document.getElementById('2fa-status');
const recoveryCodesStatus = document.getElementById('recovery-codes-status');
const recoveryCodesCreate = document.getElementById('recovery-codes-create');
const recoveryCodesRetry = document.getElementById('recovery-codes-save-retry');
const recoveryCodesRequest = document.getElementById('recovery-codes-request');
const recoveryCodesForm = document.getElementById('recovery-codes-email-form');
const recoveryCodesInput = document.getElementById('recovery-codes-email-code');
const recoveryCodesVisibility = document.getElementById('recovery-codes-visibility');
const recoveryCodesList = document.getElementById('recovery-codes-list');
const RECOVERY_CODES_API = 'https://drdarsun-site-main.layero.app/api/recovery-codes';
let pendingRecoveryCodes = null;
let displayedRecoveryCodes = null;
let recoveryCodesVisible = false;

async function recoveryCodesApi(path, method = 'GET', body) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error('Войдите в аккаунт и повторите попытку.');
    const response = await fetch(`${RECOVERY_CODES_API}${path}`, {
        method,
        headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json'
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(result?.error || 'Не удалось выполнить операцию с резервными кодами.');
    return result;
}

function renderRecoveryCodes(codes, reveal = false) {
    if (!recoveryCodesList) return;
    recoveryCodesList.replaceChildren();
    for (const item of codes || []) {
        const code = typeof item.code === 'string' ? item.code : '';
        const masked = typeof item.masked === 'string'
            ? item.masked
            : code
                ? `${code.slice(0, 2)}${'•'.repeat(Math.max(4, code.length - 2))}`
                : '';
        const line = document.createElement('li');
        line.textContent = `${reveal && code ? code : masked}${item.used ? ' · использован' : ''}`;
        recoveryCodesList.appendChild(line);
    }
}

async function refreshRecoveryCodes(twoFactorEnabled = toggle2fa?.checked) {
    if (!recoveryCodesStatus) return;
    try {
        const result = await recoveryCodesApi('/status');
        recoveryCodesStatus.textContent = result.hasCodes
            ? `Созданы ${new Date(result.createdAt).toLocaleDateString('ru-RU')}. Осталось активных кодов: ${result.remaining}.`
            : twoFactorEnabled
                ? 'Резервные коды ещё не созданы.'
                : 'Сначала включите 2FA.';
        recoveryCodesCreate.hidden = !twoFactorEnabled || Boolean(result.hasCodes);
        recoveryCodesRequest.hidden = !result.hasCodes;
        if (!result.hasCodes) {
            displayedRecoveryCodes = null;
            recoveryCodesList.replaceChildren();
            recoveryCodesVisibility.hidden = true;
        } else if (!displayedRecoveryCodes) {
            renderRecoveryCodes(result.codes);
        }
    } catch (error) {
        recoveryCodesStatus.textContent = error.message || 'Не удалось проверить резервные коды.';
        recoveryCodesCreate.hidden = true;
        recoveryCodesRequest.hidden = true;
    }
}

async function createAndSaveRecoveryCodes() {
    recoveryCodesCreate.disabled = true;
    recoveryCodesRetry.disabled = true;
    try {
        if (!pendingRecoveryCodes) {
            let { data, error } = await supabase.auth.mfa.recoveryCodes.generate({
                friendlyName: 'Dr. DarSun backup codes'
            });
            if (error?.code === 'mfa_verified_factor_exists') {
                if (!confirm('Найден существующий набор резервных кодов без зашифрованного архива. Создание нового набора сделает старые коды недействительными. Продолжить?')) {
                    throw new Error('Создание нового набора отменено.');
                }
                ({ data, error } = await supabase.auth.mfa.recoveryCodes.regenerate());
            }
            if (error) throw error;
            if (!Array.isArray(data?.codes) || !data.codes.length) throw new Error('Сервис 2FA не вернул резервные коды.');
            pendingRecoveryCodes = data.codes;
        }
        await recoveryCodesApi('/register', 'POST', { codes: pendingRecoveryCodes });
        pendingRecoveryCodes = null;
        recoveryCodesRetry.hidden = true;
        displayedRecoveryCodes = null;
        recoveryCodesVisible = false;
        recoveryCodesStatus.textContent = 'Резервные коды созданы и сохранены в зашифрованном виде.';
        showToast('Резервные коды созданы.');
        await refreshRecoveryCodes(true);
    } catch (error) {
        const saved = await recoveryCodesApi('/status').catch(() => null);
        if (saved?.hasCodes) {
            pendingRecoveryCodes = null;
            recoveryCodesRetry.hidden = true;
            displayedRecoveryCodes = null;
            await refreshRecoveryCodes(true);
            return;
        }
        recoveryCodesStatus.textContent = 'Не удалось сохранить коды. Оставьте страницу открытой и нажмите «Повторить сохранение».';
        recoveryCodesRetry.hidden = !pendingRecoveryCodes;
        showToast(error.message || 'Не удалось создать резервные коды.', 'error');
    } finally {
        recoveryCodesCreate.disabled = false;
        recoveryCodesRetry.disabled = false;
    }
}

recoveryCodesCreate?.addEventListener('click', createAndSaveRecoveryCodes);
recoveryCodesRetry?.addEventListener('click', createAndSaveRecoveryCodes);
recoveryCodesRequest?.addEventListener('click', async () => {
    recoveryCodesRequest.disabled = true;
    try {
        await recoveryCodesApi('/request', 'POST', {});
        recoveryCodesForm.hidden = false;
        recoveryCodesInput.focus();
        recoveryCodesStatus.textContent = 'Код отправлен на почту, указанную в аккаунте. Он действует 10 минут.';
    } catch (error) {
        recoveryCodesStatus.textContent = error.message;
    } finally {
        recoveryCodesRequest.disabled = false;
    }
});
recoveryCodesForm?.addEventListener('submit', async event => {
    event.preventDefault();
    const submit = recoveryCodesForm.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
        const result = await recoveryCodesApi('/reveal', 'POST', { code: recoveryCodesInput.value.trim() });
        displayedRecoveryCodes = result.codes;
        recoveryCodesVisible = false;
        renderRecoveryCodes(displayedRecoveryCodes);
        recoveryCodesVisibility.hidden = false;
        recoveryCodesVisibility.textContent = 'Показать коды';
        recoveryCodesStatus.textContent = 'Подтверждена почта. Полные коды скрыты; при необходимости нажмите «Показать коды».';
        recoveryCodesInput.value = '';
        recoveryCodesForm.hidden = true;
    } catch (error) {
        recoveryCodesStatus.textContent = error.message;
    } finally {
        submit.disabled = false;
    }
});
recoveryCodesVisibility?.addEventListener('click', () => {
    if (!displayedRecoveryCodes) return;
    recoveryCodesVisible = !recoveryCodesVisible;
    renderRecoveryCodes(displayedRecoveryCodes, recoveryCodesVisible);
    recoveryCodesVisibility.textContent = recoveryCodesVisible ? 'Скрыть коды' : 'Показать коды';
});

if (toggle2fa) {
    let mfaBusy = false;
    let mfaSetupOpen = false;

    async function readTotpFactors() {
        const { data, error } = await supabase.auth.mfa.listFactors();
        if (error) throw error;
        return data?.totp || [];
    }

    async function syncTwoFactorStatus() {
        const factors = await readTotpFactors();
        const verifiedFactors = factors.filter(factor => factor.status === 'verified');
        const pendingFactors = factors.filter(factor => factor.status !== 'verified');
        toggle2fa.checked = verifiedFactors.length > 0;
        status2fa.textContent = verifiedFactors.length
            ? 'Включена'
            : pendingFactors.length
                ? 'Есть незавершённая настройка — при включении она будет очищена.'
                : 'Отключена';
        await refreshRecoveryCodes(verifiedFactors.length > 0);
        return { factors, verifiedFactors, pendingFactors };
    }

    try {
        await syncTwoFactorStatus();
    } catch (error) {
        status2fa.textContent = 'Не удалось проверить статус двухфакторной защиты.';
        showToast('Ошибка проверки 2FA: ' + error.message, 'error');
    }

    toggle2fa.addEventListener('change', async () => {
        if (mfaBusy || mfaSetupOpen) return;
        mfaBusy = true;
        toggle2fa.disabled = true;
        const enable = toggle2fa.checked;

        try {
            let { verifiedFactors, pendingFactors } = await syncTwoFactorStatus();
            if (enable && verifiedFactors.length) {
                showToast('Двухфакторная защита уже включена.');
                return;
            }

            if (!enable && !confirm('Отключить двухфакторную защиту? Резервные коды станут недействительными и их зашифрованный архив будет удалён.')) {
                toggle2fa.checked = true;
                return;
            }

            if (!enable) {
                const { data: recoveryStatus, error: recoveryStatusError } = await supabase.auth.mfa.recoveryCodes.getStatus();
                if (recoveryStatusError && !['mfa_factor_not_found', 'mfa_recovery_codes_enroll_not_enabled'].includes(recoveryStatusError.code)) {
                    throw recoveryStatusError;
                }
                if (recoveryStatus?.total) {
                    const { error } = await supabase.auth.mfa.recoveryCodes.unenroll();
                    if (error) throw error;
                }
                for (const factor of [...verifiedFactors, ...pendingFactors]) {
                    const { error } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
                    if (error) throw error;
                }
                await recoveryCodesApi('/', 'DELETE');
                await syncTwoFactorStatus();
                showToast('Двухфакторная защита отключена.');
                return;
            }

            for (const factor of pendingFactors) {
                const { error } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
                if (error) throw error;
            }

            const { data, error } = await supabase.auth.mfa.enroll({
                factorType: 'totp',
                friendlyName: 'Dr. DarSun 2FA'
            });
            if (error) {
                const currentFactors = await syncTwoFactorStatus();
                if (currentFactors.verifiedFactors.length) {
                    showToast('Двухфакторная защита уже включена.');
                    return;
                }
                throw error;
            }

            const dialog = document.createElement('div');
            dialog.className = 'security-modal';
            const panel = document.createElement('section');
            panel.className = 'security-modal__panel';
            const title = document.createElement('h3');
            title.textContent = 'Настройка 2FA';
            const help = document.createElement('p');
            help.textContent = 'Отсканируйте QR-код приложением-аутентификатором, затем введите шестизначный код.';
            const qrCode = document.createElement('img');
            qrCode.className = 'security-modal__qr';
            qrCode.src = data.totp.qr_code;
            qrCode.alt = 'QR-код настройки двухфакторной защиты';
            const code = document.createElement('input');
            code.className = 'security-modal__code';
            code.type = 'text';
            code.inputMode = 'numeric';
            code.autocomplete = 'one-time-code';
            code.pattern = '[0-9]{6}';
            code.maxLength = 6;
            code.placeholder = '000000';
            code.setAttribute('aria-label', 'Шестизначный код из приложения');
            const verify = document.createElement('button');
            verify.type = 'button';
            verify.className = 'btn btn--primary';
            verify.textContent = 'Подтвердить и включить';
            const cancel = document.createElement('button');
            cancel.type = 'button';
            cancel.className = 'btn session-control-btn';
            cancel.textContent = 'Отмена';
            panel.append(title, help, qrCode, code, verify, cancel);
            dialog.appendChild(panel);
            document.body.appendChild(dialog);
            mfaSetupOpen = true;
            code.focus();

            let dialogBusy = false;
            const cancelSetup = async () => {
                if (dialogBusy) return;
                dialogBusy = true;
                cancel.disabled = true;
                verify.disabled = true;
                let cancelError;
                try {
                    ({ error: cancelError } = await supabase.auth.mfa.unenroll({ factorId: data.id }));
                } catch (error) {
                    cancelError = error;
                }
                dialog.remove();
                mfaSetupOpen = false;
                toggle2fa.disabled = false;
                if (cancelError) {
                    try {
                        await syncTwoFactorStatus();
                    } catch (statusError) {
                        console.error('2FA status refresh failed:', statusError);
                    }
                    showToast('Не удалось удалить незавершённую настройку: ' + cancelError.message, 'error');
                    return;
                }
                toggle2fa.checked = false;
                await syncTwoFactorStatus();
            };

            cancel.addEventListener('click', cancelSetup);
            verify.addEventListener('click', async () => {
                if (dialogBusy) return;
                const token = code.value.trim();
                if (!/^\d{6}$/.test(token)) {
                    showToast('Введите шестизначный код из приложения.', 'error');
                    code.focus();
                    return;
                }

                dialogBusy = true;
                verify.disabled = true;
                cancel.disabled = true;
                let verifyError;
                try {
                    ({ error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
                        factorId: data.id,
                        code: token
                    }));
                } catch (error) {
                    verifyError = error;
                }
                if (verifyError) {
                    dialogBusy = false;
                    verify.disabled = false;
                    cancel.disabled = false;
                    showToast('Код не подошёл. Проверьте время на телефоне и попробуйте ещё раз.', 'error');
                    code.focus();
                    return;
                }
                try {
                    await createAndSaveRecoveryCodes();
                } catch (recoveryError) {
                    console.error('Recovery code setup failed:', recoveryError);
                }
                dialog.remove();
                mfaSetupOpen = false;
                toggle2fa.disabled = false;
                await syncTwoFactorStatus();
                showToast('Двухфакторная защита включена.');
            });
        } catch (error) {
            try {
                await syncTwoFactorStatus();
            } catch (statusError) {
                console.error('2FA status refresh failed:', statusError);
                toggle2fa.checked = !enable;
                status2fa.textContent = 'Не удалось проверить статус двухфакторной защиты.';
            }
            showToast('Ошибка 2FA: ' + error.message, 'error');
        } finally {
            mfaBusy = false;
            toggle2fa.disabled = mfaSetupOpen;
        }
    });
}

const passkeyButton = document.getElementById('enable-passkey-btn');
const passkeysList = document.getElementById('passkeys-list');
const passkeysStatus = document.getElementById('passkeys-status');

async function loadPasskeys() {
    if (!passkeysList || !passkeysStatus) return;
    const { data, error } = await supabase.auth.passkey.list();
    if (error) {
        passkeysStatus.textContent = 'Не удалось загрузить список Passkey.';
        console.error('Passkey list failed:', error);
        return;
    }

    passkeysList.replaceChildren();
    if (!data?.length) {
        passkeysStatus.textContent = 'Пока нет сохранённых ключей на этом аккаунте.';
        return;
    }

    passkeysStatus.textContent = `Сохранено ключей: ${data.length}.`;
    data.forEach((passkey, index) => {
        const row = document.createElement('div');
        row.className = 'passkey-item';
        const details = document.createElement('div');
        details.className = 'passkey-item__details';
        const name = document.createElement('strong');
        name.textContent = passkey.friendly_name || `Passkey ${index + 1}`;
        const created = document.createElement('span');
        created.textContent = `Добавлен: ${new Date(passkey.created_at).toLocaleDateString('ru-RU')}`;
        details.append(name, created);
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'btn passkey-item__remove';
        remove.textContent = 'Удалить';
        remove.addEventListener('click', async () => {
            if (!confirm(`Удалить ключ «${passkey.friendly_name || `Passkey ${index + 1}`}»?`)) return;
            remove.disabled = true;
            const { error: deleteError } = await supabase.auth.passkey.delete({ passkeyId: passkey.id });
            if (deleteError) {
                remove.disabled = false;
                showToast('Не удалось удалить Passkey: ' + deleteError.message, 'error');
                return;
            }
            showToast('Passkey удалён.');
            await loadPasskeys();
        });
        row.append(details, remove);
        passkeysList.appendChild(row);
    });
}

if (passkeyButton && passkeysList) {
    if (!window.isSecureContext || !window.PublicKeyCredential || !supabase.auth.passkey) {
        passkeyButton.disabled = true;
        passkeysStatus.textContent = 'Passkey недоступен: откройте сайт по HTTPS в браузере с поддержкой WebAuthn.';
    } else {
        passkeyButton.addEventListener('click', async () => {
            passkeyButton.disabled = true;
            passkeyButton.textContent = 'Подтвердите действие на устройстве…';
            try {
                const { data, error } = await supabase.auth.registerPasskey();
                if (error) throw error;
                if (!data) throw new Error('Сервер не подтвердил регистрацию ключа.');
                showToast('Passkey добавлен. Теперь можно входить по Face ID, отпечатку или PIN-коду.');
                await loadPasskeys();
            } catch (error) {
                if (error.name !== 'NotAllowedError' && error.code !== 'ERROR_CEREMONY_ABORTED') {
                    showToast('Не удалось добавить Passkey: ' + error.message, 'error');
                }
            } finally {
                passkeyButton.disabled = false;
                passkeyButton.textContent = 'Добавить Passkey';
            }
        });
        await loadPasskeys();
    }
}


    // 10. НАСТРОЙКИ
    document.getElementById('settings-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const newName = document.getElementById('settings-name').value.trim();
        if (!newName) return showToast('Введите имя для профиля.', 'error');
        const { error } = await supabase.auth.updateUser({ data: { full_name: newName } });
        if (error) showToast('Ошибка: ' + error.message, 'error');
        else {
            showToast('Имя обновлено!');
            document.getElementById('user-name').textContent = newName;
        }
    });

    document.getElementById('email-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const newEmail = document.getElementById('settings-email').value.trim().toLowerCase();
        if (!newEmail || newEmail === session.user.email?.toLowerCase()) {
            return showToast('Укажите новый адрес почты.', 'error');
        }
        const { error } = await supabase.auth.updateUser({ email: newEmail });
        if (error) {
            showToast('Не удалось изменить почту: ' + error.message, 'error');
            return;
        }
        showToast('Письмо для подтверждения отправлено на новый адрес.');
    });

document.getElementById('password-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const newPassword = document.getElementById('new-password').value;
    if (newPassword.length < 6) return showToast('Пароль слишком короткий', 'error');

    const { data: aal, error: aalError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aalError) return showToast('Не удалось проверить 2FA: ' + aalError.message, 'error');

    if (aal?.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') {
        const modal = document.getElementById('mfa-confirm-modal');
        const codeInput = document.getElementById('mfa-confirm-code');
        const submitButton = document.getElementById('mfa-confirm-submit');
        modal.style.display = 'flex';
        codeInput.value = '';
        codeInput.focus();

        submitButton.onclick = async () => {
            const code = codeInput.value.trim();
            if (!/^\d{6}$/.test(code)) return showToast('Введите шестизначный код из приложения.', 'error');
            submitButton.disabled = true;
            try {
                const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors();
                if (factorsError) throw factorsError;
                const totpFactor = factors?.totp?.find(factor => factor.status === 'verified');
                if (!totpFactor) throw new Error('Включённый фактор 2FA не найден. Проверьте его настройки.');

                const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
                    factorId: totpFactor.id,
                    code
                });
                if (verifyError) throw verifyError;

                const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
                if (updateError) throw updateError;
                showToast('Пароль изменён!');
                document.getElementById('password-form').reset();
                modal.style.display = 'none';
            } catch (error) {
                showToast('Не удалось подтвердить 2FA или изменить пароль: ' + error.message, 'error');
            } finally {
                submitButton.disabled = false;
            }
        };

        document.getElementById('mfa-confirm-cancel').onclick = () => {
            modal.style.display = 'none';
            codeInput.value = '';
        };
        return;
    }

    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) showToast('Ошибка: ' + error.message, 'error');
    else {
        showToast('Пароль изменён!');
        document.getElementById('password-form').reset();
    }
});

    // 11. УДАЛЕНИЕ
    document.getElementById('delete-account-btn')?.addEventListener('click', async () => {
        if (!confirm('Удалить аккаунт? Это необратимо.')) return;
        if (!confirm('Точно? Все данные будут удалены.')) return;

        const deleteButton = document.getElementById('delete-account-btn');
        deleteButton.disabled = true;
        try {
            const { data: { session }, error: sessionError } = await supabase.auth.getSession();
            if (sessionError) throw sessionError;
            if (!session?.access_token) throw new Error('Сессия истекла. Войдите заново.');

            const response = await fetch('https://drdarsun-site-main.layero.app/api/delete-account', {
                method: 'POST',
                headers: { Authorization: `Bearer ${session.access_token}` }
            });
            const result = await response.json().catch(() => null);
            if (!response.ok) throw new Error(result?.error || 'Не удалось удалить аккаунт.');

            await supabase.auth.signOut({ scope: 'local' });
            window.location.href = 'index.html';
        } catch (error) {
            console.error('Account deletion failed:', error);
            showToast(error.message || 'Не удалось удалить аккаунт. Попробуйте позже.', 'error');
        } finally {
            deleteButton.disabled = false;
        }
    });
}

// --- QR В БЕЗОПАСНОСТИ ---
const scanQrBtn = document.getElementById('scan-qr-btn');
const qrScanResult = document.getElementById('qr-scan-result');
let stopProfileQrScanner;

scanQrBtn?.addEventListener('click', async () => {
    if (stopProfileQrScanner) {
        await stopProfileQrScanner();
        stopProfileQrScanner = null;
        scanQrBtn.textContent = 'Сканировать QR и подтвердить вход';
        qrScanResult.textContent = 'Сканирование остановлено.';
        return;
    }

    scanQrBtn.disabled = true;
    qrScanResult.textContent = 'Запрос доступа к камере...';
    try {
        stopProfileQrScanner = await startQrScanner('qr-scan-result', async (decodedText) => {
            stopProfileQrScanner = null;
            scanQrBtn.textContent = 'Сканировать QR и подтвердить вход';
            qrScanResult.textContent = 'Проверяем запрос на вход...';
            const id = getQrLoginId(decodedText);
            await approveQrLogin(id);
            qrScanResult.textContent = 'Вход подтверждён. Вернитесь к устройству, на котором показан QR-код.';
        }, (error) => {
            stopProfileQrScanner = null;
            scanQrBtn.textContent = 'Сканировать QR и подтвердить вход';
            qrScanResult.textContent = error.message || 'Не удалось подтвердить QR-код.';
        });
        scanQrBtn.textContent = 'Остановить сканирование';
    } catch (err) {
        qrScanResult.textContent = `Ошибка камеры: ${err.message || err}`;
        scanQrBtn.textContent = 'Сканировать QR и подтвердить вход';
    } finally {
        scanQrBtn.disabled = false;
    }
});

// --- ПРОСТОЙ ВЫХОД (не завершение сессии, а выход) ---
document.getElementById('logout-btn')?.addEventListener('click', async () => {
    if (!confirm('Выйти из аккаунта?')) return;

    // Удаляем текущее устройство из БД (чтобы не висело в списке)
    const deviceKey = localStorage.getItem('device_key');
    if (deviceKey) {
        const { error } = await supabase
            .from('devices')
            .delete()
            .eq('user_id', session.user.id)
            .eq('device_key', deviceKey);
        if (error) {
            showToast('Не удалось завершить текущую сессию: ' + error.message, 'error');
            return;
        }
    }

    // Выходим из Supabase
    await supabase.auth.signOut({ scope: 'local' });

    // Перенаправляем на главную
    window.location.href = 'index.html';
});

// --- УВЕДОМЛЕНИЯ ---
// --- УВЕДОМЛЕНИЯ ---
const notifyEmail = document.getElementById('notify-email');
const enableNotifyBtn = document.getElementById('enable-notify-btn');
const disableNotifyBtn = document.getElementById('disable-notify');

if (notifyEmail) {
    supabase.auth.getSession().then(async ({ data: { session }, error }) => {
        if (error) throw error;
        if (!session) return;
        notifyEmail.textContent = session.user.email;
        const { data, error: settingsError } = await supabase
            .from('notification_settings')
            .select('email_enabled')
            .eq('user_id', session.user.id)
            .maybeSingle();
        if (settingsError) throw settingsError;
        if (data?.email_enabled) {
            enableNotifyBtn.textContent = 'Уведомления включены';
            disableNotifyBtn.disabled = false;
        }
    }).catch(error => {
        console.error('Email notification preference lookup failed:', error);
        showToast('Не удалось загрузить настройку email-уведомлений.', 'error');
    });
}
enableNotifyBtn?.addEventListener('click', async () => {
    enableNotifyBtn.disabled = true;
    try {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        if (!session) throw new Error('Войдите в аккаунт и попробуйте снова.');
        const { error: saveError } = await supabase.from('notification_settings').upsert({
            user_id: session.user.id,
            email_enabled: true
        }, { onConflict: 'user_id' });
        if (saveError) throw saveError;

        const { error: sendError } = await supabase.functions.invoke('send-notification', {
            body: {
                to: session.user.email,
                subject: 'Уведомления Dr. DarSun включены',
                html: '<h2>Вы подписались на уведомления</h2><p>Вы можете отключить их в настройках профиля.</p>'
            }
        });
        if (sendError) {
            await supabase.from('notification_settings').upsert({
                user_id: session.user.id,
                email_enabled: false
            }, { onConflict: 'user_id' });
            throw sendError;
        }
        enableNotifyBtn.textContent = 'Уведомления включены';
        showToast('Уведомления включены! Проверьте почту.');
    } catch (error) {
        console.error('Email notifications could not be enabled:', error);
        showToast('Не удалось включить уведомления: ' + error.message, 'error');
    } finally {
        enableNotifyBtn.disabled = false;
    }
});

disableNotifyBtn?.addEventListener('click', async () => {
    disableNotifyBtn.disabled = true;
    try {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        if (!session) throw new Error('Войдите в аккаунт и попробуйте снова.');
        const { error } = await supabase.from('notification_settings').upsert({
            user_id: session.user.id,
            email_enabled: false
        }, { onConflict: 'user_id' });
        if (error) throw error;
        enableNotifyBtn.textContent = 'Включить уведомления';
        showToast('Email-уведомления отключены.');
    } catch (error) {
        console.error('Email notifications could not be disabled:', error);
        showToast('Не удалось отключить уведомления: ' + error.message, 'error');
    } finally {
        disableNotifyBtn.disabled = false;
    }
});

init();