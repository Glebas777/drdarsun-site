import { supabase } from './supabase-client.js';

const YANDEX_CLIENT_ID = 'b39d2bf86d0c448691056b68cd242e12';
let isEmailVerified = false;

// 1. Вход через Яндекс
document.getElementById('btn-yandex')?.addEventListener('click', () => {
    const yandexAuthUrl = `https://oauth.yandex.ru/authorize?response_type=code&client_id=${YANDEX_CLIENT_ID}&redirect_uri=https://drdarsun-site-main.layero.app/auth/v1/callback`;
    window.location.href = yandexAuthUrl;
});

// 2. Вход через Google
document.getElementById('btn-google')?.addEventListener('click', () => {
    const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=1059795226527-fgrb9i2ccikq0e6pkolpjj36t2a6i2i3.apps.googleusercontent.com&redirect_uri=https://drdarsun-site-main.layero.app/auth/v1/callback&response_type=code&scope=email profile`;
    window.location.href = googleAuthUrl;
});

document.getElementById('send-code-btn')?.addEventListener('click', async () => {
    const email = document.getElementById('reg-email').value;
    if (!email) return alert('Введите email');

    const btn = document.getElementById('send-code-btn');
    btn.disabled = true;

    // Отправляем код через Supabase (он уже настроен на твою почту)
    const { error } = await supabase.auth.signInWithOtp({
        email: email,
        options: {
            shouldCreateUser: true,
        }
    });

    if (error) {
        alert('Ошибка отправки: ' + error.message);
        btn.disabled = false;
    } else {
        alert('Код отправлен на почту!');
        document.getElementById('verify-block').style.display = 'block';
    }
});

document.getElementById('verify-btn')?.addEventListener('click', async () => {
    const email = document.getElementById('reg-email').value;
    const code = document.getElementById('verify-code').value;

    const { error } = await supabase.auth.verifyOtp({
        email: email,
        token: code,
        type: 'email'
    });

    if (error) {
        alert('Неверный код: ' + error.message);
    } else {
        alert('Почта подтверждена! Теперь вы можете завершить регистрацию.');
        isEmailVerified = true;
        document.getElementById('verify-block').style.display = 'none';
        document.getElementById('submit-register').style.display = 'block';
        document.getElementById('submit-register').textContent = 'Завершить регистрацию';
    }
});

// 5. Регистрация (уже после подтверждения)
document.getElementById('register-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!isEmailVerified) {
        alert('Сначала подтвердите почту!');
        return;
    }

    const name = document.getElementById('reg-name').value;
    const email = document.getElementById('reg-email').value;
    const password = document.getElementById('reg-password').value;

    const { data, error } = await supabase.auth.signUp({
        email, password,
        options: { data: { full_name: name } }
    });

    if (error) {
        alert('Ошибка регистрации: ' + error.message);
    } else {
        alert('Аккаунт создан!');
        window.location.href = 'login.html';
    }
});

// 6. Вход по Email
document.getElementById('login-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
        alert('Ошибка входа: ' + error.message);
    } else {
        window.location.href = 'profile.html';
    }
});

// 7. Бургер (без изменений)
const burgerBtn = document.getElementById('burger-btn');
const mobileMenu = document.getElementById('mobile-menu');
if (burgerBtn && mobileMenu) {
    burgerBtn.addEventListener('click', () => {
        burgerBtn.classList.toggle('active');
        mobileMenu.classList.toggle('active');
        if (mobileMenu.classList.contains('active')) {
            document.body.style.overflow = 'hidden';
            mobileMenu.style.opacity = '1';
            mobileMenu.style.pointerEvents = 'auto';
        } else {
            document.body.style.overflow = '';
            mobileMenu.style.opacity = '0';
            mobileMenu.style.pointerEvents = 'none';
        }
    });
}