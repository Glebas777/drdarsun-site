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

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
        // Если пароль неверный — предлагаем войти по коду (OTP)
        if (error.message.includes('Invalid login credentials')) {
            alert('Пароль неверный. Сейчас отправим код на почту.');
            const { error: otpError } = await supabase.auth.signInWithOtp({ email });
            if (otpError) return alert('Ошибка: ' + otpError.message);

            document.getElementById('login-form').style.display = 'none';
            document.getElementById('otp-form').style.display = 'block';
            return;
        }
        return alert('Ошибка: ' + error.message);
    }

    // Проверяем 2FA
    const { data: mfaData, error: mfaError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (!mfaError && mfaData.nextLevel === 'aal2' && mfaData.currentLevel !== 'aal2') {
        document.getElementById('login-form').style.display = 'none';
        document.getElementById('mfa-form').style.display = 'block';
        return;
    }

    window.location.href = 'profile.html';
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

    window.location.href = 'profile.html';
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
    forgotForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('forgot-email').value;

        const { error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: 'https://drdarsun.ru/reset.html'
        });

        if (error) alert('Ошибка: ' + error.message);
        else alert('Письмо для сброса пароля отправлено на почту.');
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