import { supabase } from './supabase-client.js';

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
// 5. ВХОД ПО РЕЗЕРВНОМУ КОДУ (2FA)
// ==========================================
document.getElementById('backup-code-login')?.addEventListener('click', async (e) => {
    e.preventDefault();
    const code = prompt('Введите резервный код:');
    if (!code) return;

    // Проверяем код через Layero (он умеет искать в таблице backup_codes)
    try {
        const res = await fetch('https://drdarsun-site-main.layero.app/api/verify-backup-code', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: code.toUpperCase() })
        });
        const data = await res.json();

        if (data.success && data.access_token) {
            await supabase.auth.setSession({
                access_token: data.access_token,
                refresh_token: data.refresh_token
            });
            window.location.href = 'profile.html';
        } else {
            alert('Неверный или использованный код');
        }
    } catch (e) {
        alert('Ошибка соединения');
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

// ==========================================
// ВХОД ПО QR-КОДУ (из модалки на логине)
// ==========================================
document.getElementById('qr-login-trigger')?.addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('qr-login-modal').style.display = 'flex';

    const container = document.getElementById('qr-login-container');
    container.innerHTML = '<div id="qr-reader" style="width:100%; max-width:300px;"></div>';

    const html5QrCode = new Html5Qrcode("qr-reader");
    html5QrCode.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: 250 },
        (decodedText) => {
            html5QrCode.stop();
            document.getElementById('qr-login-modal').style.display = 'none';
            // Здесь обработка отсканированного QR — пока просто показываем
            alert('Отсканировано: ' + decodedText);
        },
        () => {}
    ).catch(err => {
        container.innerHTML = '<p style="color: #F44336;">Ошибка камеры: ' + err + '</p>';
    });
});

document.getElementById('close-qr-login')?.addEventListener('click', () => {
    document.getElementById('qr-login-modal').style.display = 'none';
});

// ==========================================
// ВХОД ПО РЕЗЕРВНЫМ КОДАМ (их 6)
// ==========================================
document.getElementById('backup-code-login')?.addEventListener('click', async (e) => {
    e.preventDefault();

    const code = prompt('Введите один из 6 резервных кодов:');
    if (!code) return;

    try {
        const res = await fetch('https://drdarsun-site-main.layero.app/api/verify-backup-code', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: code.toUpperCase() })
        });
        const data = await res.json();

        if (data.success && data.access_token) {
            await supabase.auth.setSession({
                access_token: data.access_token,
                refresh_token: data.refresh_token
            });
            window.location.href = 'profile.html';
        } else {
            alert('Неверный или использованный код');
        }
    } catch (e) {
        alert('Ошибка соединения');
    }
});

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