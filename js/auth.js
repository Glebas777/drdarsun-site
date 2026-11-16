import { supabase } from './supabase-client.js';

let isEmailVerified = false;

document.getElementById('btn-yandex')?.addEventListener('click', () => {
    window.location.href = 'https://oauth.yandex.ru/authorize?response_type=code&client_id=b39d2bf86d0c448691056b68cd242e12&redirect_uri=https://drdarsun-site-main.layero.app/auth/v1/callback/yandex';
});

document.getElementById('btn-google')?.addEventListener('click', () => {
    window.location.href = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=1059795226527-fgrb9i2ccikq0e6pkolpjj36t2a6i2i3.apps.googleusercontent.com&redirect_uri=https://drdarsun-site-main.layero.app/auth/v1/callback/google&response_type=code&scope=email profile';
});

document.getElementById('send-code-btn')?.addEventListener('click', async () => {
    const email = document.getElementById('reg-email').value;
    if (!email) return alert('Введите email');

    const btn = document.getElementById('send-code-btn');
    btn.disabled = true;

    try {
        const res = await fetch('https://drdarsun-site-main.layero.app/api/send-code', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        const data = await res.json();
        
        if (data.success) {
            alert('Код отправлен на почту!');
            document.getElementById('verify-block').style.display = 'block';
        } else {
            alert('Ошибка: ' + data.message);
            btn.disabled = false;
        }
    } catch (e) {
        alert('Ошибка соединения');
        btn.disabled = false;
    }
});

document.getElementById('verify-btn')?.addEventListener('click', async () => {
    const email = document.getElementById('reg-email').value;
    const code = document.getElementById('verify-code').value;

    try {
        const res = await fetch('https://drdarsun-site-main.layero.app/api/verify-code', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, code })
        });
        const data = await res.json();

        if (data.success) {
            alert('Почта подтверждена!');
            isEmailVerified = true;
            document.getElementById('verify-block').style.display = 'none';
            document.getElementById('submit-register').style.display = 'block';
            document.getElementById('submit-register').textContent = 'Завершить регистрацию';
        } else {
            alert('Неверный код');
        }
    } catch (e) {
        alert('Ошибка проверки');
    }
});

document.getElementById('register-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!isEmailVerified) return alert('Сначала подтвердите почту!');

    const name = document.getElementById('reg-name').value;
    const email = document.getElementById('reg-email').value;
    const password = document.getElementById('reg-password').value;

    const res = await fetch('https://drdarsun-site-main.layero.app/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name })
    });

    const data = await res.json();
    if (data.success) {
        alert('Аккаунт создан! Войдите.');
        window.location.href = 'login.html';
    } else {
        alert('Ошибка: ' + data.message);
    }
});

// Вход по Email (через OTP)
document.getElementById('login-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;

    // Сначала пробуем обычный вход по паролю
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (!error) {
        // Пароль верный — проверяем 2FA
        const { data: mfaData, error: mfaError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if (!mfaError && mfaData.nextLevel === 'aal2' && mfaData.currentLevel !== 'aal2') {
            document.getElementById('login-form').style.display = 'none';
            document.getElementById('mfa-form').style.display = 'block';
            return;
        }
        window.location.href = 'profile.html';
        return;
    }

    // Если пароль неверный — предлагаем войти по OTP (код на почту)
    if (error.message.includes('Invalid login credentials')) {
        const { error: otpError } = await supabase.auth.signInWithOtp({ email });
        if (otpError) return alert('Ошибка: ' + otpError.message);

        alert('Пароль неверный. Мы отправили код на вашу почту.');
        document.getElementById('login-form').style.display = 'none';
        document.getElementById('otp-form').style.display = 'block';
        return;
    }

    alert('Ошибка: ' + error.message);
});

// Проверка OTP-кода
document.getElementById('otp-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const token = document.getElementById('otp-code').value;

    const { error } = await supabase.auth.verifyOtp({
        email: email,
        token: token,
        type: 'email'
    });

    if (error) return alert('Неверный код: ' + error.message);
    window.location.href = 'profile.html';
});

// Кнопка "Назад" из OTP-формы
document.getElementById('back-to-login-from-otp')?.addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('otp-form').style.display = 'none';
    document.getElementById('login-form').style.display = 'block';
});

const forgotForm = document.getElementById('forgot-form');
if (forgotForm) {
    forgotForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('forgot-email').value;

        try {
            const res = await fetch('https://drdarsun-site-main.layero.app/api/reset-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });
            const data = await res.json();

            if (data.success) {
                alert('Ссылка для сброса отправлена на почту.');
            } else {
                alert('Ошибка: ' + (data.message || 'Не удалось отправить письмо'));
            }
        } catch (e) {
            alert('Ошибка соединения с сервером.');
        }
    });
}