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

// 3. Отправка кода (только для регистрации)
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

// 4. Проверка кода (только для регистрации)
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

document.getElementById('reg-password')?.addEventListener('blur', async () => {
    const val = document.getElementById('reg-password').value;
    if (val.length < 6) return;

    const hintPwned = document.getElementById('hint-pwned');
    if (!hintPwned) return;

    hintPwned.innerHTML = '⏳ Проверка на утечки...';
    hintPwned.style.color = '#888';

    try {
        const msgBuffer = new TextEncoder().encode(val);
        const hashBuffer = await crypto.subtle.digest('SHA-1', msgBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
        const prefix = hashHex.substring(0, 5);
        const suffix = hashHex.substring(5);
        const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`);
        const text = await response.text();
        const lines = text.split('\n');
        let isPwned = false;
        let count = 0;
        for (const line of lines) {
            const [lineSuffix, lineCount] = line.split(':');
            if (lineSuffix === suffix) {
                isPwned = true;
                count = parseInt(lineCount);
                break;
            }
        }
        if (isPwned) {
            hintPwned.innerHTML = `❌ Пароль слит ${count} раз. Придумай другой.`;
            hintPwned.style.color = '#F44336';
        } else {
            hintPwned.innerHTML = '✅ Пароль не найден в утечках';
            hintPwned.style.color = '#4CAF50';
        }
    } catch (e) {
        hintPwned.innerHTML = '⚠️ Не удалось проверить утечки';
        hintPwned.style.color = '#FFA600';
    }
});

// 6. Вход по Email
document.getElementById('login-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
        return alert('Ошибка: ' + error.message);
    }

    // Проверяем, нужен ли код 2FA
    const { data: mfaData, error: mfaError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    
    if (!mfaError && mfaData.nextLevel === 'aal2' && mfaData.currentLevel !== 'aal2') {
        // 2FA включена — показываем поле для кода
        document.getElementById('login-form').style.display = 'none';
        document.getElementById('mfa-form').style.display = 'block';
        return;
    }

    // Если 2FA нет — пускаем сразу
    window.location.href = 'profile.html';
});

// 7. Восстановление пароля
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

// 8. Меню (троеточие)
const menuToggle = document.getElementById('menu-toggle');
const menuDropdown = document.getElementById('menu-dropdown');
if (menuToggle && menuDropdown) {
    menuToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        menuDropdown.classList.toggle('active');
    });
    document.addEventListener('click', (e) => {
        if (!menuToggle.contains(e.target) && !menuDropdown.contains(e.target)) {
            menuDropdown.classList.remove('active');
        }
    });
}

// 9. Переключение на форму восстановления
document.getElementById('forgot-password')?.addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('forgot-form').style.display = 'block';
    document.getElementById('menu-dropdown').classList.remove('active');
});

// 10. Возврат ко входу
document.getElementById('back-to-login')?.addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('forgot-form').style.display = 'none';
    document.getElementById('login-form').style.display = 'block';
});

// Вход по 2FA коду
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

    if (verifyError) {
        alert('Неверный код: ' + verifyError.message);
    } else {
        window.location.href = 'profile.html';
    }
});