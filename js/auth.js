import { supabase } from './supabase-client.js';
import { validateNewPassword } from './password-policy.mjs';
import {
    cancelQrLoginRequest,
    approveQrLogin,
    completeQrLogin,
    createQrLoginRequest,
    getQrLoginId,
    startQrScanner,
    waitForQrLoginApproval
} from './qr-login.js';

let isEmailVerified = false;
const captchaSiteKey = document.querySelector('meta[name="turnstile-site-key"]')?.content.trim() || '';
const captchaStates = new Map();
let turnstileLoadPromise;

function loadTurnstile() {
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (turnstileLoadPromise) return turnstileLoadPromise;

    turnstileLoadPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        script.async = true;
        script.defer = true;
        script.onload = () => window.turnstile
            ? resolve(window.turnstile)
            : reject(new Error('Turnstile загрузился без API.'));
        script.onerror = () => reject(new Error('Не удалось загрузить проверку CAPTCHA.'));
        document.head.appendChild(script);
    });
    return turnstileLoadPromise;
}

function setupCaptcha() {
    if (!captchaSiteKey) return;
    document.querySelectorAll('[data-turnstile]').forEach(async (element) => {
        const state = { token: null, widgetId: null, waiters: [] };
        captchaStates.set(element.id, state);
        element.hidden = false;
        try {
            const turnstile = await loadTurnstile();
            state.widgetId = turnstile.render(element, {
                sitekey: captchaSiteKey,
                action: element.dataset.action,
                callback: token => {
                    state.token = token;
                    state.waiters.splice(0).forEach(resolve => resolve(token));
                },
                'expired-callback': () => { state.token = null; },
                'error-callback': () => {
                    state.token = null;
                    state.waiters.splice(0).forEach(resolve => resolve(null));
                }
            });
        } catch (error) {
            console.error('CAPTCHA initialization failed:', error);
            element.dataset.error = 'true';
        }
    });
}

function getCaptchaToken(elementId) {
    if (!captchaSiteKey) return Promise.resolve(undefined);
    const state = captchaStates.get(elementId);
    if (!state?.widgetId) {
        return Promise.reject(new Error('Проверка CAPTCHA пока не готова. Обновите страницу.'));
    }
    if (state.token) return Promise.resolve(state.token);
    return new Promise(resolve => state.waiters.push(resolve));
}

function resetCaptcha(elementId) {
    const state = captchaStates.get(elementId);
    if (!state) return;
    state.token = null;
    if (state.widgetId && window.turnstile) window.turnstile.reset(state.widgetId);
}

function createOAuthState(provider) {
    try {
        const bytes = crypto.getRandomValues(new Uint8Array(32));
        const value = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
        sessionStorage.setItem(`oauth_state_${provider}`, JSON.stringify({
            value,
            expiresAt: Date.now() + 10 * 60 * 1000
        }));
        return value;
    } catch (error) {
        console.error('OAuth state could not be stored:', error);
        alert('Не удалось безопасно начать вход. Разрешите хранилище сайта и попробуйте снова.');
        return null;
    }
}

const oauthError = document.getElementById('oauth-error');
const oauthErrorMessages = {
    yandex_auth_failed: 'Не удалось войти через Яндекс. Проверьте, что у Яндекс-аккаунта есть подтверждённая основная почта, и попробуйте ещё раз.',
    google_auth_failed: 'Не удалось войти через Google. Попробуйте ещё раз или используйте вход по email и паролю.',
    no_code: 'Провайдер не вернул код авторизации. Начните вход ещё раз.',
    oauth_state_invalid: 'Попытка входа устарела или не подтверждена. Начните вход заново.'
};
const oauthErrorCode = new URLSearchParams(window.location.search).get('error');
if (oauthError && oauthErrorMessages[oauthErrorCode]) {
    oauthError.textContent = oauthErrorMessages[oauthErrorCode];
    oauthError.hidden = false;
}

setupCaptcha();

function getPostLoginRedirect() {
    const requested = new URLSearchParams(window.location.search).get('redirect');
    if (!requested) return 'profile.html';

    try {
        const target = new URL(requested, window.location.origin);
        const allowedPaths = new Set([
            '/index.html',
            '/catalog.html',
            '/about.html',
            '/delivery.html',
            '/cart.html',
            '/product.html'
        ]);
        if (target.origin !== window.location.origin || !allowedPaths.has(target.pathname)) {
            return 'profile.html';
        }
        return `${target.pathname.slice(1)}${target.search}${target.hash}`;
    } catch (error) {
        console.warn('Post-login redirect was invalid:', error);
        return 'profile.html';
    }
}

function markDeviceRegistrationPending(userId) {
    try {
        localStorage.setItem('pending_device_registration', userId);
    } catch (error) {
        console.warn('Pending device registration could not be saved:', error);
    }
}

const telegramAuthEndpoint = 'https://drdarsun-site-main.layero.app/api/telegram-auth';
const telegramAuthForm = document.getElementById('telegram-auth-form');
const telegramAuthStatus = document.getElementById('telegram-auth-status');
let telegramAuthMode = 'login';

function showTelegramAuth(mode) {
    telegramAuthMode = mode;
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('forgot-form').style.display = 'none';
    telegramAuthForm.style.display = 'block';
    document.getElementById('telegram-auth-description').textContent = mode === 'recovery'
        ? 'Укажите username Telegram, привязанный к аккаунту. Код придёт в Telegram и позволит задать новый пароль.'
        : 'Укажите username Telegram, привязанный к аккаунту. Код придёт в Telegram для входа.';
    document.getElementById('telegram-auth-send').textContent = 'Отправить код';
    document.getElementById('telegram-auth-code-group').hidden = true;
    document.getElementById('telegram-auth-verify-actions').hidden = true;
    document.getElementById('telegram-new-password-group').hidden = true;
    document.getElementById('telegram-auth-code').required = false;
    document.getElementById('telegram-auth-code').value = '';
    document.getElementById('telegram-new-password').required = false;
    telegramAuthStatus.hidden = true;
    telegramAuthStatus.textContent = '';
    document.getElementById('telegram-auth-username').focus();
}

document.getElementById('telegram-login-trigger')?.addEventListener('click', event => {
    event.preventDefault();
    showTelegramAuth('login');
});

document.getElementById('telegram-recovery-trigger')?.addEventListener('click', () => showTelegramAuth('recovery'));
document.getElementById('telegram-auth-back')?.addEventListener('click', event => {
    event.preventDefault();
    telegramAuthForm.style.display = 'none';
    document.getElementById('telegram-new-password').required = false;
    document.getElementById(telegramAuthMode === 'recovery' ? 'forgot-form' : 'login-form').style.display = 'block';
});

document.getElementById('telegram-auth-send')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    const username = document.getElementById('telegram-auth-username').value.trim().replace(/^@/, '');
    if (!/^[a-zA-Z0-9_]{5,32}$/.test(username)) {
        telegramAuthStatus.textContent = 'Введите корректный Telegram username (5–32 символа).';
        telegramAuthStatus.hidden = false;
        return;
    }

    button.disabled = true;
    telegramAuthStatus.hidden = true;
    try {
        const response = await fetch(`${telegramAuthEndpoint}/request`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, mode: telegramAuthMode })
        });
        const result = await response.json().catch(() => null);
        if (!response.ok) throw new Error(result?.error || 'Не удалось отправить код.');
        document.getElementById('telegram-auth-code-group').hidden = false;
        document.getElementById('telegram-auth-verify-actions').hidden = false;
        document.getElementById('telegram-auth-code').required = true;
        telegramAuthStatus.textContent = result.message || 'Если username привязан к аккаунту, код отправлен в Telegram.';
        telegramAuthStatus.hidden = false;
        document.getElementById('telegram-auth-code').focus();
    } catch (error) {
        telegramAuthStatus.textContent = error.message || 'Не удалось отправить код. Попробуйте позже.';
        telegramAuthStatus.hidden = false;
    } finally {
        button.disabled = false;
    }
});

telegramAuthForm?.addEventListener('submit', async event => {
    event.preventDefault();
    const submitButton = document.getElementById('telegram-auth-verify');
    const username = document.getElementById('telegram-auth-username').value.trim().replace(/^@/, '');
    const code = document.getElementById('telegram-auth-code').value.trim();
    submitButton.disabled = true;
    telegramAuthStatus.hidden = true;
    try {
        const response = await fetch(`${telegramAuthEndpoint}/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, code, mode: telegramAuthMode })
        });
        const result = await response.json().catch(() => null);
        if (!response.ok || !result?.session?.access_token || !result?.session?.refresh_token) {
            throw new Error(result?.error || 'Не удалось подтвердить код.');
        }

        const { data, error } = await supabase.auth.setSession(result.session);
        if (error) throw error;
        if (!data.session) throw new Error('Сессию не удалось создать.');
        document.getElementById('telegram-auth-code').value = '';

        if (telegramAuthMode === 'recovery') {
            document.getElementById('telegram-auth-code-group').hidden = true;
            document.getElementById('telegram-auth-verify-actions').hidden = true;
            document.getElementById('telegram-new-password-group').hidden = false;
            document.getElementById('telegram-new-password').required = true;
            document.getElementById('telegram-auth-description').textContent = 'Код подтверждён. Придумайте новый пароль для аккаунта.';
            document.getElementById('telegram-new-password').focus();
            return;
        }
        markDeviceRegistrationPending(data.session.user.id);
        await check2FAAndRedirect();
    } catch (error) {
        telegramAuthStatus.textContent = error.message || 'Код неверный или устарел.';
        telegramAuthStatus.hidden = false;
    } finally {
        submitButton.disabled = false;
    }
});

document.getElementById('telegram-new-password-save')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    const password = document.getElementById('telegram-new-password').value;
    button.disabled = true;
    try {
        await validateNewPassword(password);
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        document.getElementById('telegram-new-password').value = '';
        telegramAuthStatus.textContent = 'Пароль изменён. Выполняем вход…';
        telegramAuthStatus.hidden = false;
        await check2FAAndRedirect();
    } catch (error) {
        telegramAuthStatus.textContent = error.message || 'Не удалось сохранить новый пароль.';
        telegramAuthStatus.hidden = false;
    } finally {
        button.disabled = false;
    }
});

// ==========================================
// 1. ВХОД ЧЕРЕЗ ЯНДЕКС И GOOGLE (оставляем как было)
// ==========================================
document.getElementById('btn-yandex')?.addEventListener('click', () => {
    const state = createOAuthState('yandex');
    if (!state) return;
    const authorizeUrl = new URL('https://oauth.yandex.ru/authorize');
    authorizeUrl.search = new URLSearchParams({
        response_type: 'code',
        client_id: 'b39d2bf86d0c448691056b68cd242e12',
        redirect_uri: 'https://drdarsun-site-main.layero.app/auth/v1/callback/yandex',
        state
    });
    window.location.href = authorizeUrl.href;
});

document.getElementById('btn-google')?.addEventListener('click', () => {
    const state = createOAuthState('google');
    if (!state) return;
    const authorizeUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authorizeUrl.search = new URLSearchParams({
        client_id: '1059795226527-fgrb9i2ccikq0e6pkolpjj36t2a6i2i3.apps.googleusercontent.com',
        redirect_uri: 'https://drdarsun-site-main.layero.app/auth/v1/callback/google',
        response_type: 'code',
        scope: 'email profile',
        state
    });
    window.location.href = authorizeUrl.href;
});

// ==========================================
// 2. РЕГИСТРАЦИЯ (только Supabase)
// ==========================================
document.getElementById('register-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('reg-name').value;
    const email = document.getElementById('reg-email').value;
    const password = document.getElementById('reg-password').value;
    try {
        await validateNewPassword(password);
    } catch (error) {
        alert(error.message);
        return;
    }
    const captchaToken = await getCaptchaToken('captcha-register').catch(error => {
        alert(error.message);
        return null;
    });
    if (captchaSiteKey && !captchaToken) return;

    const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: name }, captchaToken }
    });
    resetCaptcha('captcha-register');

    if (error) return alert('Ошибка: ' + error.message);

    // Supabase отправил письмо с кодом/ссылкой
    alert('Проверьте почту. Мы отправили код подтверждения.');
    // Если у тебя в Supabase включено подтверждение почты — код придёт.
    // Если нет — пользователь сразу залогинен.
    if (data.session) {
        markDeviceRegistrationPending(data.session.user.id);
        window.location.href = getPostLoginRedirect();
    } else {
        // Показываем форму для ввода кода (если она есть)
        const verifyBlock = document.getElementById('verify-block');
        if (verifyBlock) verifyBlock.style.display = 'block';
    }
});

// ==========================================
// 3. ВХОД ПО ПАРОЛЮ
// ==========================================
document.getElementById('login-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    const captchaToken = await getCaptchaToken('captcha-login').catch(error => {
        alert(error.message);
        return null;
    });
    if (captchaSiteKey && !captchaToken) return;

    const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
        options: { captchaToken }
    });
    resetCaptcha('captcha-login');
    if (error) {
        if (error.message.includes('Invalid login credentials')) {
            // ... OTP логика (оставь как есть)
        }
        return alert('Ошибка: ' + error.message);
    }

    await check2FAAndRedirect(); // <--- ВМЕСТО старой проверки
});

document.getElementById('btn-passkey')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    if (!window.isSecureContext || !window.PublicKeyCredential) {
        return alert('Вход по Passkey доступен в поддерживаемом браузере на безопасном сайте HTTPS.');
    }

    button.disabled = true;
    button.textContent = 'Подтвердите вход на устройстве…';
    try {
        const { data, error } = await supabase.auth.signInWithPasskey();
        if (error) throw error;
        if (!data?.session) throw new Error('Вход по Passkey не создал сессию.');
        await check2FAAndRedirect();
    } catch (error) {
        const cancelled = error.name === 'NotAllowedError' || error.code === 'ERROR_CEREMONY_ABORTED';
        if (!cancelled) alert('Не удалось войти по Passkey: ' + (error.message || 'попробуйте другой способ входа.'));
    } finally {
        button.disabled = false;
        button.textContent = 'Войти с Passkey · Face ID';
    }
});

// ==========================================
// 4. ВХОД ПО КОДУ (OTP)
// ==========================================
document.getElementById('otp-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const token = document.getElementById('otp-code').value;

    const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
    if (error) return alert('Неверный код: ' + error.message);

    await check2FAAndRedirect(); // <--- ДОБАВИТЬ
});

document.getElementById('back-to-login-from-otp')?.addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('otp-form').style.display = 'none';
    document.getElementById('login-form').style.display = 'block';
});

document.getElementById('backup-code-login')?.addEventListener('click', event => {
    event.preventDefault();
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('recovery-code-form').style.display = 'block';
    document.getElementById('recovery-code-input').focus();
});

document.getElementById('back-to-login-from-recovery')?.addEventListener('click', event => {
    event.preventDefault();
    document.getElementById('recovery-code-form').style.display = 'none';
    document.getElementById('login-form').style.display = 'block';
});

document.getElementById('recovery-code-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const submitButton = form.querySelector('button[type="submit"]');
    const code = document.getElementById('recovery-code-input').value.trim();
    if (!code) return alert('Введите резервный код.');

    submitButton.disabled = true;
    try {
        const { data, error } = await supabase.auth.mfa.recoveryCodes.verify({ code });
        if (error) throw error;
        if (!data?.user) throw new Error('Вход по резервному коду не создал сессию.');

        const response = await fetch('https://drdarsun-site-main.layero.app/api/recovery-codes/consume', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${data.access_token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ code })
        });
        if (!response.ok) {
            const result = await response.json().catch(() => ({}));
            console.error('Recovery code vault sync failed:', result.error || response.status);
        }
        markDeviceRegistrationPending(data.user.id);
        await check2FAAndRedirect();
    } catch (error) {
        alert('Не удалось войти по резервному коду: ' + (error.message || 'проверьте код и попробуйте ещё раз.'));
    } finally {
        submitButton.disabled = false;
    }
});



// ==========================================
// 6. ЗАБЫЛИ ПАРОЛЬ (только Supabase)
// ==========================================
const forgotForm = document.getElementById('forgot-form');
if (forgotForm) {
let cooldown = false;

forgotForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (cooldown) return alert('Подождите    немного');

    const email = document.getElementById('forgot-email').value;
    const captchaToken = await getCaptchaToken('captcha-forgot').catch(error => {
        alert(error.message);
        return null;
    });
    if (captchaSiteKey && !captchaToken) return;
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: 'https://drdarsun.ru/reset.html',
        captchaToken
    });
    resetCaptcha('captcha-forgot');

    if (error) {
        if (error.message.includes('For security purposes')) {
            alert('Код уже отправлен. Подожди минуту.');
        } else {
            alert('Ошибка: ' + error.message);
        }
        return;
    }

    cooldown = true;
    setTimeout(() => { cooldown = false; }, 60000);
    alert('Ссылка отправлена на почту.');
});
}

// ==========================================
// 7. ПЕРЕКЛЮЧЕНИЕ ФОРМ
// ==========================================
document.getElementById('forgot-password')?.addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('forgot-form').style.display = 'block';
});

document.getElementById('back-to-login')?.addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('forgot-form').style.display = 'none';
    document.getElementById('login-form').style.display = 'block';
});

// ==========================================
// 8. ВХОД ПО 2FA (TOTP)
// ==========================================
document.getElementById('mfa-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = document.getElementById('mfa-code').value;
    if (code.length !== 6) return alert('Введите 6 цифр');

    const { data: factors } = await supabase.auth.mfa.listFactors();
    const totpFactor = factors.totp[0];
    if (!totpFactor) return alert('Фактор не найден');

    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
        factorId: totpFactor.id,
        code: code
    });

    if (verifyError) alert('Неверный код: ' + verifyError.message);
    else window.location.href = getPostLoginRedirect();
});

// QR-вход: запрос создаётся на этом устройстве и подтверждается уже вошедшим телефоном.
const qrModal = document.getElementById('qr-login-modal');
const qrContainer = document.getElementById('qr-login-container');
const qrStatus = document.getElementById('qr-login-status');
const qrScanButton = document.getElementById('qr-login-scan');
let activeQrRequest;
let qrPollController;
let stopLoginScanner;
let qrFlowVersion = 0;
let qrCountdownInterval;

async function closeQrLogin() {
    qrFlowVersion += 1;
    qrPollController?.abort();
    qrPollController = null;
    clearInterval(qrCountdownInterval);
    qrCountdownInterval = null;
    if (stopLoginScanner) {
        await stopLoginScanner().catch(() => {});
        stopLoginScanner = null;
    }
    if (qrScanButton) {
        qrScanButton.disabled = false;
        qrScanButton.textContent = 'Сканировать QR этим устройством';
    }
    if (activeQrRequest) {
        await cancelQrLoginRequest(activeQrRequest).catch(error => console.error('QR cancel error:', error));
        activeQrRequest = null;
    }
    if (qrModal) {
        qrModal.style.display = 'none';
        qrModal.setAttribute('aria-hidden', 'true');
        delete qrModal.dataset.open;
    }
}

function startQrCountdown(expiresAt, controller) {
    clearInterval(qrCountdownInterval);
    const timeLabel = document.getElementById('qr-login-time');
    const progress = document.getElementById('qr-login-progress');
    const renewButton = document.getElementById('qr-login-renew');
    const totalSeconds = Math.max(1, Math.ceil((Date.parse(expiresAt) - Date.now()) / 1000));
    renewButton.hidden = true;

    const update = () => {
        const seconds = Math.max(0, Math.ceil((Date.parse(expiresAt) - Date.now()) / 1000));
        timeLabel.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
        progress.style.width = `${Math.max(0, seconds / totalSeconds * 100)}%`;
        if (seconds === 0) {
            clearInterval(qrCountdownInterval);
            qrCountdownInterval = null;
            qrStatus.textContent = 'Время действия QR-кода истекло. Создайте новый.';
            qrStatus.style.color = '#F44336';
            renewButton.hidden = false;
            controller.abort();
            if (activeQrRequest) {
                cancelQrLoginRequest(activeQrRequest).catch(error => console.error('QR expiry cleanup failed:', error));
                activeQrRequest = null;
            }
        }
    };

    update();
    qrCountdownInterval = window.setInterval(update, 1000);
}

document.getElementById('qr-login-trigger')?.addEventListener('click', async (event) => {
    event.preventDefault();
    if (qrModal.dataset.open === 'true') return;
    qrModal.dataset.open = 'true';
    qrModal.setAttribute('aria-hidden', 'false');
    qrModal.style.display = 'flex';
    qrContainer.innerHTML = '<p style="color:#aaa">Создаём защищённый QR-код...</p>';
    qrStatus.textContent = '';
    qrStatus.style.color = '';
    const flowVersion = ++qrFlowVersion;

    try {
        const request = await createQrLoginRequest();
        if (flowVersion !== qrFlowVersion) {
            await cancelQrLoginRequest(request).catch(error => console.error('QR cancel error:', error));
            return;
        }
        activeQrRequest = request;
        qrContainer.innerHTML = '';
        if (!window.QRCode) throw new Error('Генератор QR-кодов не загрузился. Обновите страницу.');
        new QRCode(qrContainer, {
            text: activeQrRequest.qrText,
            width: 220,
            height: 220,
            colorDark: '#000000',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.H
        });
        qrStatus.textContent = 'Ожидаем подтверждение с телефона. Код действует 2 минуты.';

        qrPollController = new AbortController();
        startQrCountdown(activeQrRequest.expiresAt, qrPollController);
        const approval = await waitForQrLoginApproval(activeQrRequest, qrPollController.signal);
        if (!approval) return;
        clearInterval(qrCountdownInterval);
        qrCountdownInterval = null;
        document.getElementById('qr-login-time').textContent = 'Вход подтверждён';
        document.getElementById('qr-login-progress').style.width = '100%';
        qrPollController = null;
        qrStatus.textContent = 'Вход подтверждён. Выполняем вход...';
        await completeQrLogin(approval);
        activeQrRequest = null;
        await closeQrLogin();
        await check2FAAndRedirect();
    } catch (error) {
        clearInterval(qrCountdownInterval);
        qrCountdownInterval = null;
        if (flowVersion === qrFlowVersion && error.name !== 'AbortError') {
            qrStatus.textContent = error.message || 'Не удалось выполнить вход по QR-коду.';
            qrStatus.style.color = '#F44336';
        }
    }
});

document.getElementById('qr-login-scan')?.addEventListener('click', async () => {
    if (stopLoginScanner) {
        await stopLoginScanner();
        stopLoginScanner = null;
        qrScanButton.textContent = 'Сканировать QR этим устройством';
        qrScanButton.disabled = false;
        return;
    }
    qrScanButton.disabled = true;
    qrPollController?.abort();
    qrPollController = null;
    if (activeQrRequest) {
        await cancelQrLoginRequest(activeQrRequest).catch(error => console.error('QR cancel error:', error));
        activeQrRequest = null;
    }
    qrContainer.innerHTML = '<div id="qr-login-reader" style="width:100%; max-width:300px; margin:auto;"></div>';
    qrStatus.style.color = '#aaa';
    qrStatus.textContent = 'Наведите камеру на QR-код. Для подтверждения нужно быть уже вошедшим в аккаунт.';
    try {
        stopLoginScanner = await startQrScanner('qr-login-reader', async (decodedText) => {
            const id = getQrLoginId(decodedText);
            await approveQrLogin(id);
            qrStatus.textContent = 'Вход подтверждён на этом устройстве.';
            qrStatus.style.color = '#4CAF50';
            qrScanButton.textContent = 'Сканировать QR этим устройством';
            qrScanButton.disabled = false;
            stopLoginScanner = null;
        }, (error) => {
            qrStatus.textContent = error.message || 'Не удалось подтвердить QR-код.';
            qrStatus.style.color = '#F44336';
            qrScanButton.textContent = 'Сканировать QR этим устройством';
            qrScanButton.disabled = false;
            stopLoginScanner = null;
        });
        qrScanButton.textContent = 'Остановить сканирование';
        qrScanButton.disabled = false;
    } catch (error) {
        qrStatus.textContent = `Ошибка камеры: ${error.message || error}`;
        qrStatus.style.color = '#F44336';
        qrScanButton.textContent = 'Сканировать QR этим устройством';
        qrScanButton.disabled = false;
    }
});

document.getElementById('close-qr-login')?.addEventListener('click', closeQrLogin);
document.getElementById('qr-login-renew')?.addEventListener('click', async () => {
    await closeQrLogin();
    document.getElementById('qr-login-trigger')?.click();
});
qrModal?.addEventListener('click', (event) => {
    if (event.target === qrModal) closeQrLogin();
});
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && qrModal?.dataset.open === 'true') closeQrLogin();
});

// Универсальная проверка 2FA после любого входа
async function check2FAAndRedirect() {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) {
        console.error('Login session lookup failed:', sessionError);
    } else if (sessionData.session) {
        markDeviceRegistrationPending(sessionData.session.user.id);
    }

    const { data: mfaData, error: mfaError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

    if (!mfaError && mfaData.nextLevel === 'aal2' && mfaData.currentLevel !== 'aal2') {
        // 2FA включена, но не пройдена — показываем форму
        document.getElementById('login-form').style.display = 'none';
        document.getElementById('telegram-auth-form').style.display = 'none';
        document.getElementById('forgot-form').style.display = 'none';
        document.getElementById('otp-form').style.display = 'none';
        document.getElementById('mfa-form').style.display = 'block';
        return true; // 2FA нужна
    }

    // 2FA не нужна — пускаем
    window.location.href = getPostLoginRedirect();
    return false;
}