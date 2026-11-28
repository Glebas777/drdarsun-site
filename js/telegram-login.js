import { supabase } from './supabase-client.js';

const TELEGRAM_API = 'https://drdarsun-site-main.layero.app/api/telegram';

async function readResponse(response) {
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Не удалось выполнить вход через Telegram.');
    return result;
}

function isValidBotUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' &&
            url.hostname === 't.me' &&
            /^\/[A-Za-z0-9_]{5,32}$/.test(url.pathname) &&
            /^[a-f0-9]{48}$/.test(url.searchParams.get('start')?.replace(/^login_/, '') || '');
    } catch {
        return false;
    }
}

export function initializeTelegramLogin(onAuthenticated) {
    const trigger = document.getElementById('telegram-login-trigger');
    const modal = document.getElementById('telegram-login-modal');
    const openLink = document.getElementById('telegram-login-open');
    const form = document.getElementById('telegram-login-code-form');
    const codeInput = document.getElementById('telegram-login-code-input');
    const status = document.getElementById('telegram-login-status');
    const expiry = document.getElementById('telegram-login-expiry');
    const closeButton = document.getElementById('telegram-login-close');
    if (!trigger || !modal || !openLink || !form || !codeInput || !status || !expiry || !closeButton) return;

    let activeRequest = null;
    let countdown;
    let opening = false;

    async function cancelRequest() {
        if (!activeRequest) return;
        const request = activeRequest;
        activeRequest = null;
        try {
            await fetch(`${TELEGRAM_API}/login/${encodeURIComponent(request.id)}`, {
                method: 'DELETE',
                headers: { 'X-Telegram-Login-Poll-Token': request.pollSecret },
                cache: 'no-store',
                keepalive: true
            });
        } catch (error) {
            console.warn('Telegram login request cleanup failed:', error);
        }
    }

    async function closeModal({ cancel = true } = {}) {
        clearInterval(countdown);
        countdown = undefined;
        if (cancel) await cancelRequest();
        else activeRequest = null;
        modal.style.display = 'none';
        modal.setAttribute('aria-hidden', 'true');
        delete modal.dataset.open;
        trigger.focus();
    }

    function startCountdown(expiresAt) {
        clearInterval(countdown);
        const update = () => {
            const seconds = Math.max(0, Math.ceil((Date.parse(expiresAt) - Date.now()) / 1000));
            expiry.hidden = false;
            expiry.textContent = seconds > 0
                ? `Запрос действует ещё ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}.`
                : 'Срок запроса истёк. Закройте окно и начните вход заново.';
            if (seconds === 0) {
                clearInterval(countdown);
                countdown = undefined;
                form.hidden = true;
                openLink.hidden = true;
                cancelRequest();
            }
        };
        update();
        countdown = window.setInterval(update, 1000);
    }

    trigger.addEventListener('click', async () => {
        if (opening || modal.dataset.open === 'true') return;
        opening = true;
        trigger.disabled = true;
        modal.dataset.open = 'true';
        modal.style.display = 'flex';
        modal.setAttribute('aria-hidden', 'false');
        openLink.hidden = true;
        form.hidden = true;
        expiry.hidden = true;
        status.textContent = 'Создаём защищённый запрос…';

        try {
            const response = await fetch(`${TELEGRAM_API}/login/request`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: '{}',
                cache: 'no-store'
            });
            const request = await readResponse(response);
            if (!/^[a-f0-9]{48}$/.test(request.id || '') ||
                !/^[a-f0-9]{64}$/.test(request.pollSecret || '') ||
                !isValidBotUrl(request.url)) {
                throw new Error('Сервер вернул некорректный запрос. Обновите страницу и попробуйте снова.');
            }
            activeRequest = request;
            openLink.href = request.url;
            openLink.hidden = false;
            form.hidden = false;
            status.textContent = 'Откройте бота. Он отправит код только в Telegram, ранее привязанный к вашему аккаунту.';
            startCountdown(request.expiresAt);
            codeInput.focus();
        } catch (error) {
            status.textContent = error.message || 'Не удалось начать вход через Telegram.';
        } finally {
            opening = false;
            trigger.disabled = false;
        }
    });

    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (!activeRequest) {
            status.textContent = 'Запрос истёк. Закройте окно и попробуйте снова.';
            return;
        }
        const submitButton = form.querySelector('button[type="submit"]');
        const code = codeInput.value.trim();
        if (!/^\d{6}$/.test(code)) {
            status.textContent = 'Введите шестизначный код из Telegram.';
            return;
        }

        submitButton.disabled = true;
        status.textContent = 'Проверяем код…';
        try {
            const response = await fetch(`${TELEGRAM_API}/login/verify`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: activeRequest.id,
                    pollSecret: activeRequest.pollSecret,
                    code
                }),
                cache: 'no-store'
            });
            const result = await readResponse(response);
            if (typeof result.email !== 'string' || typeof result.emailOtp !== 'string') {
                throw new Error('Сервер не завершил вход. Создайте новый запрос.');
            }
            const { data, error } = await supabase.auth.verifyOtp({
                email: result.email,
                token: result.emailOtp,
                type: 'magiclink'
            });
            if (error) throw error;
            if (!data?.session) throw new Error('Сессия входа не создана. Запросите новый код.');
            await closeModal({ cancel: false });
            await onAuthenticated();
        } catch (error) {
            status.textContent = error.message || 'Код неверный или устарел. Попробуйте ещё раз.';
            codeInput.select();
        } finally {
            submitButton.disabled = false;
        }
    });

    closeButton.addEventListener('click', () => closeModal());
    modal.addEventListener('click', event => {
        if (event.target === modal) closeModal();
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && modal.dataset.open === 'true') closeModal();
    });
}
