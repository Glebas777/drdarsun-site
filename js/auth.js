import { supabase } from './supabase-client.js';

const YANDEX_CLIENT_ID = 'b39d2bf86d0c448691056b68cd242e12';
let isEmailVerified = false;
let countdownInterval = null;

// 1. Вход через Яндекс (с параметром provider, Layero его поймет)
document.getElementById('btn-yandex')?.addEventListener('click', () => {
    const yandexAuthUrl = `https://oauth.yandex.ru/authorize?response_type=code&client_id=${YANDEX_CLIENT_ID}&redirect_uri=https://drdarsun-site-main.layero.app/auth/v1/callback&provider=yandex`;
    window.location.href = yandexAuthUrl;
});

// 2. Вход через Google (БЕЗ provider, Google его не любит)
document.getElementById('btn-google')?.addEventListener('click', () => {
    const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=1059795226527-fgrb9i2ccikq0e6pkolpjj36t2a6i2i3.apps.googleusercontent.com&redirect_uri=https://drdarsun-site-main.layero.app/auth/v1/callback&response_type=code&scope=email profile`;
    window.location.href = googleAuthUrl;
});

// 3. Отправка кода (через Layero)
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
            startCountdown(15 * 60);
        } else {
            alert('Ошибка отправки: ' + data.message);
            btn.disabled = false;
        }
    } catch (e) {
        alert('Ошибка соединения');
        btn.disabled = false;
    }
});

// 4. Проверка кода (через Layero)
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
            isEmailVerified = true;
            document.getElementById('verify-block').style.display = 'none';
            document.getElementById('submit-register').style.display = 'block';
            document.getElementById('submit-register').textContent = 'Завершить регистрацию';
            if (countdownInterval) clearInterval(countdownInterval);
        } else {
            alert('Неверный код');
        }
    } catch (e) {
        alert('Ошибка проверки');
    }
});

// 5. Отмена подтверждения
document.getElementById('cancel-verify-btn')?.addEventListener('click', () => {
    document.getElementById('verify-block').style.display = 'none';
    document.getElementById('send-code-btn').disabled = false;
    document.getElementById('verify-code').value = '';
    isEmailVerified = false;
    if (countdownInterval) clearInterval(countdownInterval);
});

// 6. Таймер
function startCountdown(seconds) {
    if (countdownInterval) clearInterval(countdownInterval);
    const timerEl = document.getElementById('verify-timer');
    if (!timerEl) return;
    
    let timeLeft = seconds;
    timerEl.textContent = `Код действителен: ${formatTime(timeLeft)}`;
    
    countdownInterval = setInterval(() => {
        timeLeft--;
        timerEl.textContent = `Код действителен: ${formatTime(timeLeft)}`;
        if (timeLeft <= 0) {
            clearInterval(countdownInterval);
            timerEl.textContent = 'Код истек. Запросите новый.';
            document.getElementById('send-code-btn').disabled = false;
        }
    }, 1000);
}

function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
}

// 7. Регистрация (только после подтверждения)
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

// 8. Вход по Email
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

// 9. Бургер
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