import { supabase } from './supabase-client.js';

let isEmailVerified = false;

// 1. Вход через Яндекс
document.getElementById('btn-yandex')?.addEventListener('click', () => {
    window.location.href = 'https://oauth.yandex.ru/authorize?response_type=code&client_id=b39d2bf86d0c448691056b68cd242e12&redirect_uri=https://drdarsun-site-main.layero.app/auth/v1/callback/yandex';
});

// 2. Вход через Google
document.getElementById('btn-google')?.addEventListener('click', () => {
    window.location.href = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=1059795226527-fgrb9i2ccikq0e6pkolpjj36t2a6i2i3.apps.googleusercontent.com&redirect_uri=https://drdarsun-site-main.layero.app/auth/v1/callback/google&response_type=code&scope=email profile';
});

// 3. Отправка кода
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

// 4. Проверка кода
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

// 5. Регистрация
document.getElementById('register-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!isEmailVerified) return alert('Сначала подтвердите почту!');

    const name = document.getElementById('reg-name').value;
    const email = document.getElementById('reg-email').value;
    const password = document.getElementById('reg-password').value;

    const { error } = await supabase.auth.signUp({
        email, password,
        options: { data: { full_name: name } }
    });

    if (error) alert('Ошибка: ' + error.message);
    else { alert('Аккаунт создан!'); window.location.href = 'login.html'; }
});

// 6. Вход по Email
document.getElementById('login-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) alert('Ошибка: ' + error.message);
    else window.location.href = 'profile.html';
});