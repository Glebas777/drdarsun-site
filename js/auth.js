import { supabase } from './supabase-client.js';
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

// ==========================================
// 1. ВХОД ЧЕРЕЗ ЯНДЕКС И GOOGLE (оставляем как было)
// ==========================================
document.getElementById('btn-yandex')?.addEventListener('click', () => {
    window.location.href = 'https://oauth.yandex.ru/authorize?response_type=code&client_id=b39d2bf86d0c448691056b68cd242e12&redirect_uri=https://drdarsun-site-main.layero.app/auth/v1/callback/yandex';
});

document.getElementById('btn-google')?.addEventListener('click', () => {
    window.location.href = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=1059795226527-fgrb9i2ccikq0e6pkolpjj36t2a6i2i3.apps.googleusercontent.com&redirect_uri=https://drdarsun-site-main.layero.app/auth/v1/callback/google&response_type=code&scope=email profile';
});

// ==========================================
// 2. РЕГИСТРАЦИЯ (только Supabase)
// ==========================================
document.getElementById('register-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('reg-name').value;
    const email = document.getElementById('reg-email').value;
    const password = document.getElementById('reg-password').value;

    const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: name } }
    });

    if (error) return alert('Ошибка: ' + error.message);

    // Supabase отправил письмо с кодом/ссылкой
    alert('Проверьте почту. Мы отправили код подтверждения.');
    // Если у тебя в Supabase включено подтверждение почты — код придёт.
    // Если нет — пользователь сразу залогинен.
    if (data.session) {
        window.location.href = 'profile.html';
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

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
        if (error.message.includes('Invalid login credentials')) {
            // ... OTP логика (оставь как есть)
        }
        return alert('Ошибка: ' + error.message);
    }

    await check2FAAndRedirect(); // <--- ВМЕСТО старой проверки
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
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: 'https://drdarsun.ru/reset.html'
    });

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
    else window.location.href = 'profile.html';
});

// QR-вход: запрос создаётся на этом устройстве и подтверждается уже вошедшим телефоном.
const qrModal = document.getElementById('qr-login-modal');
const qrContainer = document.getElementById('qr-login-container');
const qrStatus = document.getElementById('qr-login-status');
const qrScanButton = document.getElementById('qr-login-scan');
let activeQrRequest;
let qrPollController;
let stopLoginScanner;

async function closeQrLogin() {
    qrPollController?.abort();
    qrPollController = null;
    if (stopLoginScanner) {
        await stopLoginScanner().catch(() => {});
        stopLoginScanner = null;
    }
    if (qrScanButton) qrScanButton.disabled = false;
    if (activeQrRequest) {
        await cancelQrLoginRequest(activeQrRequest).catch(error => console.error('QR cancel error:', error));
        activeQrRequest = null;
    }
    if (qrModal) qrModal.style.display = 'none';
}

document.getElementById('qr-login-trigger')?.addEventListener('click', async (event) => {
    event.preventDefault();
    qrModal.style.display = 'flex';
    qrContainer.innerHTML = '<p style="color:#aaa">Создаём защищённый QR-код...</p>';
    qrStatus.textContent = '';

    try {
        activeQrRequest = await createQrLoginRequest();
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
        qrStatus.textContent = 'Откройте Dr. DarSun на телефоне, войдите в аккаунт и отсканируйте этот код в разделе «Безопасность». Код действует 2 минуты.';

        qrPollController = new AbortController();
        const approval = await waitForQrLoginApproval(activeQrRequest, qrPollController.signal);
        if (!approval) return;
        qrPollController = null;
        qrStatus.textContent = 'Вход подтверждён. Выполняем вход...';
        await completeQrLogin(approval);
        activeQrRequest = null;
        await check2FAAndRedirect();
    } catch (error) {
        if (error.name !== 'AbortError') {
            qrStatus.textContent = error.message || 'Не удалось выполнить вход по QR-коду.';
            qrStatus.style.color = '#F44336';
        }
    }
});

document.getElementById('qr-login-scan')?.addEventListener('click', async () => {
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
            qrScanButton.disabled = false;
            stopLoginScanner = null;
        }, (error) => {
            qrStatus.textContent = error.message || 'Не удалось подтвердить QR-код.';
            qrStatus.style.color = '#F44336';
            qrScanButton.disabled = false;
            stopLoginScanner = null;
        });
    } catch (error) {
        qrStatus.textContent = `Ошибка камеры: ${error.message || error}`;
        qrStatus.style.color = '#F44336';
        qrScanButton.disabled = false;
    }
});

document.getElementById('close-qr-login')?.addEventListener('click', closeQrLogin);

// Универсальная проверка 2FA после любого входа
async function check2FAAndRedirect() {
    const { data: mfaData, error: mfaError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

    if (!mfaError && mfaData.nextLevel === 'aal2' && mfaData.currentLevel !== 'aal2') {
        // 2FA включена, но не пройдена — показываем форму
        document.getElementById('login-form').style.display = 'none';
        document.getElementById('otp-form').style.display = 'none';
        document.getElementById('mfa-form').style.display = 'block';
        return true; // 2FA нужна
    }

    // 2FA не нужна — пускаем
    window.location.href = 'profile.html';
    return false;
}