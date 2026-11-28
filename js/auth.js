import { supabase } from './supabase-client.js';
import { validateNewPassword } from './password-policy.mjs';
import { initializeTelegramBotLinks } from './telegram-bot-links.js';
import { initializeTelegramLogin } from './telegram-login.js?v=telegram-account-auth-1';
import {
    cancelQrLoginRequest,
    approveQrLogin,
    completeQrLogin,
    createQrLoginRequest,
    getQrLoginId,
    startQrScanner,
    waitForQrLoginApproval
} from './qr-login.js';

const AUTH_CONFIRM_URL = 'https://drdarsun.ru/auth/confirm.html';
const AUTH_RESET_URL = 'https://drdarsun.ru/reset.html';
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
        const state = { token: null, widgetId: null, waiters: [], initialization: null };
        captchaStates.set(element.id, state);
        element.hidden = false;
        state.initialization = (async () => {
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
                        element.hidden = true;
                        state.waiters.splice(0).forEach(resolve => resolve(null));
                    }
                });
            } catch (error) {
                console.error('CAPTCHA initialization failed:', error);
                element.dataset.error = 'true';
                element.hidden = true;
            }
        })();
        await state.initialization;
    });
}

async function getCaptchaToken(elementId) {
    if (!captchaSiteKey) return undefined;
    const state = captchaStates.get(elementId);
    if (!state) return undefined;
    await state.initialization;
    if (!state.widgetId) return undefined;
    if (state.token) return state.token;
    return new Promise(resolve => {
        const waiter = token => {
            window.clearTimeout(timeoutId);
            resolve(token);
        };
        const timeoutId = window.setTimeout(() => {
            const waiterIndex = state.waiters.indexOf(waiter);
            if (waiterIndex !== -1) state.waiters.splice(waiterIndex, 1);
            console.warn('CAPTCHA verification timed out; the auth service will validate the request.');
            resolve(null);
        }, 15000);
        state.waiters.push(waiter);
    });
}

function resetCaptcha(elementId) {
    const state = captchaStates.get(elementId);
    if (!state) return;
    state.token = null;
    if (state.widgetId && window.turnstile) window.turnstile.reset(state.widgetId);
}

function showAuthMessage(elementId, message, kind = 'error') {
    const element = document.getElementById(elementId);
    if (!element) return;
    element.textContent = message;
    element.hidden = !message;
    element.dataset.state = kind;
}

function setFormPending(form, pending, pendingText = 'Проверяем…') {
    const button = form.querySelector('button[type="submit"]');
    if (!button) return;
    const label = button.querySelector('.auth-submit-btn__label') || button;
    if (pending) {
        if (!button.dataset.idleLabel) button.dataset.idleLabel = label.textContent.trim();
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        label.textContent = pendingText;
        return;
    }
    button.disabled = false;
    button.removeAttribute('aria-busy');
    if (button.dataset.idleLabel) label.textContent = button.dataset.idleLabel;
}

function getAuthErrorMessage(error, flow) {
    const message = String(error?.message || '').toLowerCase();
    const code = String(error?.code || '').toLowerCase();
    console.error(`Authentication ${flow} failed:`, {
        status: error?.status,
        code: error?.code,
        name: error?.name
    });

    if (flow === 'login' && /invalid login credentials|invalid_credentials/.test(`${message} ${code}`)) {
        return 'Email или пароль указаны неверно.';
    }
    if (/email not confirmed|email_not_confirmed/.test(`${message} ${code}`)) {
        return 'Подтвердите email по ссылке из письма, затем войдите снова.';
    }
    if (/otp_expired|token has expired|expired or invalid/.test(`${message} ${code}`)) {
        return 'Ссылка или код уже истекли. Запросите новое письмо и используйте его сразу.';
    }
    if (/captcha|turnstile/.test(`${message} ${code}`)) {
        return 'Проверка безопасности не пройдена или не загрузилась. Обновите страницу и попробуйте снова.';
    }
    if (/rate limit|too many requests|security purposes/.test(`${message} ${code}`)) {
        return 'Слишком много попыток. Подождите немного и попробуйте снова.';
    }
    if (/^пароль должен|^добавьте заглавную|^этот пароль найден|^не удалось проверить пароль/.test(message)) {
        return error.message;
    }
    if (/weak_password|password should be at least|password is too weak/.test(`${message} ${code}`)) {
        return 'Выберите более надёжный пароль: от 12 символов, с заглавной и строчной буквами, цифрой и символом.';
    }
    if (/redirect.*(not allowed|invalid)|invalid.*redirect/.test(`${message} ${code}`)) {
        return 'Ссылка возврата не разрешена в настройках авторизации. Обратитесь к администратору.';
    }
    if (/mfa assurance|two-factor assurance/.test(message)) {
        return 'Не удалось безопасно проверить двухфакторную защиту. Не закрывайте страницу и попробуйте снова.';
    }
    if (error?.name === 'TypeError' || /network|fetch|timeout|timed out/.test(message)) {
        return 'Сервис входа временно недоступен. Проверьте соединение и попробуйте снова.';
    }
    return 'Не удалось выполнить запрос. Проверьте данные и попробуйте позже.';
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

initializeTelegramBotLinks();
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
    const form = e.currentTarget;
    const name = document.getElementById('reg-name').value.trim();
    const email = document.getElementById('reg-email').value.trim().toLowerCase();
    const password = document.getElementById('reg-password').value;
    showAuthMessage('register-message', '');
    setFormPending(form, true, 'Проверяем пароль…');

    try {
        await validateNewPassword(password);
        const captchaToken = await getCaptchaToken('captcha-register');
        const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: {
                data: { full_name: name },
                emailRedirectTo: AUTH_CONFIRM_URL,
                ...(captchaToken ? { captchaToken } : {})
            }
        });
        resetCaptcha('captcha-register');
        if (error) throw error;

        document.getElementById('reg-password').value = '';
        if (data.session?.user?.id) {
            await check2FAAndRedirect();
            return;
        }

        showAuthMessage(
            'register-message',
            'Если этот адрес можно зарегистрировать, письмо для подтверждения уже отправлено. Проверьте входящие и папку «Спам», затем перейдите по ссылке.',
            'success'
        );
        document.getElementById('resend-confirmation').hidden = false;
    } catch (error) {
        resetCaptcha('captcha-register');
        showAuthMessage('register-message', getAuthErrorMessage(error, 'registration'));
    } finally {
        setFormPending(form, false);
    }
});

const resendConfirmationButton = document.getElementById('resend-confirmation');
if (resendConfirmationButton) {
    if (new URLSearchParams(window.location.search).get('resend') === '1') {
        resendConfirmationButton.hidden = false;
        showAuthMessage('register-message', 'Введите email регистрации и запросите новое письмо подтверждения.', 'success');
    }

    resendConfirmationButton.addEventListener('click', async () => {
        const email = document.getElementById('reg-email').value.trim().toLowerCase();
        if (!email) {
            showAuthMessage('register-message', 'Введите email, на который нужно отправить письмо.');
            document.getElementById('reg-email').focus();
            return;
        }

        resendConfirmationButton.disabled = true;
        resendConfirmationButton.setAttribute('aria-busy', 'true');
        showAuthMessage('register-message', '');
        try {
            const captchaToken = await getCaptchaToken('captcha-register');
            const { error } = await supabase.auth.resend({
                type: 'signup',
                email,
                options: {
                    emailRedirectTo: AUTH_CONFIRM_URL,
                    ...(captchaToken ? { captchaToken } : {})
                }
            });
            resetCaptcha('captcha-register');
            if (error) throw error;
            showAuthMessage(
                'register-message',
                'Если для этого адреса есть неподтверждённая регистрация, новое письмо отправлено. Проверьте входящие и папку «Спам».',
                'success'
            );
        } catch (error) {
            resetCaptcha('captcha-register');
            showAuthMessage('register-message', getAuthErrorMessage(error, 'resend confirmation'));
        } finally {
            resendConfirmationButton.disabled = false;
            resendConfirmationButton.removeAttribute('aria-busy');
        }
    });
}

// ==========================================
// 3. ВХОД ПО ПАРОЛЮ
// ==========================================
document.getElementById('login-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const email = document.getElementById('login-email').value.trim().toLowerCase();
    const password = document.getElementById('login-password').value;
    showAuthMessage('login-message', '');
    setFormPending(form, true, 'Входим…');

    try {
        const captchaToken = await getCaptchaToken('captcha-login');
        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password,
            options: captchaToken ? { captchaToken } : undefined
        });
        resetCaptcha('captcha-login');
        if (error) throw error;
        if (!data?.session) throw new Error('Вход не создал сессию.');
        await check2FAAndRedirect();
    } catch (error) {
        resetCaptcha('captcha-login');
        showAuthMessage('login-message', getAuthErrorMessage(error, 'login'));
    } finally {
        setFormPending(form, false);
    }
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
    const form = e.currentTarget;
    const email = document.getElementById('login-email').value;
    const token = document.getElementById('otp-code').value;

    setFormPending(form, true, 'Проверяем код…');
    showAuthMessage('login-message', '');
    try {
        const { data, error } = await supabase.auth.verifyOtp({
            email: email.trim().toLowerCase(),
            token: token.trim(),
            type: 'email'
        });
        if (error) throw error;
        if (!data?.session) throw new Error('Email OTP did not create an auth session.');
        await check2FAAndRedirect();
    } catch (error) {
        showAuthMessage('login-message', getAuthErrorMessage(error, 'login'));
    } finally {
        setFormPending(form, false);
    }
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
    if (cooldown) return showAuthMessage('forgot-message', 'Подождите немного перед следующей попыткой.');
    const email = document.getElementById('forgot-email').value.trim().toLowerCase();
    showAuthMessage('forgot-message', '');
    setFormPending(forgotForm, true, 'Отправляем…');

    try {
        const captchaToken = await getCaptchaToken('captcha-forgot');
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: AUTH_RESET_URL,
            ...(captchaToken ? { captchaToken } : {})
        });
        resetCaptcha('captcha-forgot');
        if (error) throw error;

        cooldown = true;
        window.setTimeout(() => { cooldown = false; }, 60000);
        showAuthMessage(
            'forgot-message',
            'Если для этого адреса есть аккаунт, письмо со ссылкой восстановления отправлено. Проверьте входящие и папку «Спам».',
            'success'
        );
    } catch (error) {
        resetCaptcha('captcha-forgot');
        showAuthMessage('forgot-message', getAuthErrorMessage(error, 'password recovery'));
    } finally {
        setFormPending(forgotForm, false);
    }
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
    const form = e.currentTarget;
    const code = document.getElementById('mfa-code').value.trim();
    showAuthMessage('mfa-message', '');
    if (!/^\d{6}$/.test(code)) {
        showAuthMessage('mfa-message', 'Введите шестизначный код.');
        return;
    }

    setFormPending(form, true, 'Проверяем код…');
    try {
        const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors();
        if (factorsError) throw factorsError;
        const factor = factors?.totp?.find(item => item.status === 'verified');
        if (!factor) throw new Error('Verified TOTP factor not found.');

        const { error } = await supabase.auth.mfa.challengeAndVerify({
            factorId: factor.id,
            code
        });
        if (error) throw error;
        await check2FAAndRedirect();
    } catch (error) {
        showAuthMessage('mfa-message', getAuthErrorMessage(error, 'mfa'));
    } finally {
        setFormPending(form, false);
    }
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
    if (sessionError) throw new Error('Authentication session check failed.');
    if (!sessionData?.session?.user?.id) throw new Error('Authentication session is missing.');

    const { data: mfaData, error: mfaError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (mfaError || !mfaData?.nextLevel) {
        console.error('MFA assurance lookup failed:', {
            status: mfaError?.status,
            code: mfaError?.code
        });
        throw new Error('MFA assurance check failed.');
    }

    if (mfaData.nextLevel === 'aal2' && mfaData.currentLevel !== 'aal2') {
        document.getElementById('login-form').style.display = 'none';
        document.getElementById('forgot-form').style.display = 'none';
        document.getElementById('otp-form').style.display = 'none';
        document.getElementById('mfa-form').style.display = 'block';
        document.getElementById('mfa-code')?.focus();
        showAuthMessage('mfa-message', 'Введите код из приложения для двухфакторной аутентификации.', 'success');
        return true;
    }

    markDeviceRegistrationPending(sessionData.session.user.id);
    window.location.href = getPostLoginRedirect();
    return false;
}

initializeTelegramLogin(check2FAAndRedirect);

const loginForm = document.getElementById('login-form');
if (loginForm && new URLSearchParams(window.location.search).get('mfa') === 'required') {
    loginForm.style.display = 'none';
    check2FAAndRedirect().catch(error => {
        loginForm.style.display = 'block';
        showAuthMessage('login-message', getAuthErrorMessage(error, 'mfa'));
    });
}