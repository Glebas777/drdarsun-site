import { supabase } from './supabase-client.js';

const YANDEX_CLIENT_ID = 'b39d2bf86d0c448691056b68cd242e12';

// 1. Кнопки входа через Яндекс и Google
document.getElementById('btn-yandex')?.addEventListener('click', () => {
    const yandexAuthUrl = `https://oauth.yandex.ru/authorize?response_type=code&client_id=${YANDEX_CLIENT_ID}&redirect_uri=https://drdarsun-site-main.layero.app/auth/v1/callback`;
    window.location.href = yandexAuthUrl;
});

document.getElementById('btn-google')?.addEventListener('click', () => {
    const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=1059795226527-fgrb9i2ccikq0e6pkolpjj36t2a6i2i3.apps.googleusercontent.com&redirect_uri=https://drdarsun-site-main.layero.app/auth/v1/callback&response_type=code&scope=email profile`;
    window.location.href = googleAuthUrl;
});

// 2. Отправка кода на почту
document.getElementById('send-code-btn')?.addEventListener('click', async () => {
    const email = document.getElementById('reg-email').value;
    if (!email) return alert('Введите email');

    const btn = document.getElementById('send-code-btn');
    btn.disabled = true;

    try {
        const res = await fetch('https://drdarsun-site-main.layero.app/api/send-code', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, method: 'email' })
        });
        const data = await res.json();
        
        if (data.success) {
            alert('Код отправлен на почту!');
            document.getElementById('verify-block').style.display = 'block';
            document.getElementById('submit-register').style.display = 'none'; // Скрываем кнопку регистрации
        } else {
            alert('Ошибка отправки: ' + data.message);
            btn.disabled = false;
        }
    } catch (e) {
        alert('Ошибка соединения');
        btn.disabled = false;
    }
});

// 3. Проверка кода
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
            alert('Почта подтверждена! Теперь вы можете завершить регистрацию.');
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

// 4. Финальная регистрация (когда код подтвержден)
document.getElementById('register-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const name = document.getElementById('reg-name').value;
    const email = document.getElementById('reg-email').value;
    const password = document.getElementById('reg-password').value;

    // Проверяем, что код был подтвержден (можно добавить флаг, но пока просто регистрируем)
    const { data, error } = await supabase.auth.signUp({
        email, password,
        options: { data: { full_name: name } }
    });

    if (error) {
        alert('Ошибка регистрации: ' + error.message);
    } else {
        alert('Аккаунт создан! Проверьте почту для подтверждения.');
        window.location.href = 'login.html';
    }
});