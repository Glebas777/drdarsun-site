import { supabase } from './supabase-client.js';

// Функция, которая управляет кнопкой
function renderHeaderBtn(session) {
    const container = document.getElementById('auth-buttons');
    if (!container) return;

    if (session) {
        // Если вошли — показываем профиль
        container.innerHTML = `<a href="profile.html" class="header__btn" style="background: var(--accent-green); color: #fff; border: none; padding: 8px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">Профиль</a>`;
    } else {
        // Если не вошли — показываем войти
        container.innerHTML = `<a href="login.html" class="header__btn" style="background: var(--accent-green); color: #fff; border: none; padding: 8px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">Войти</a>`;
    }
}

// 1. Запускаем при загрузке страницы
document.addEventListener('DOMContentLoaded', async () => {
    const { data: { session } } = await supabase.auth.getSession();
    renderHeaderBtn(session);
});

// 2. Слушаем изменения сессии (вход/выход)
supabase.auth.onAuthStateChange((event, session) => {
    renderHeaderBtn(session);
});

// 3. Сторож (если какой-то другой скрипт попытается перезаписать кнопку)
setInterval(async () => {
    const container = document.getElementById('auth-buttons');
    if (!container) return;

    const hasBtn = container.querySelector('a');
    if (!hasBtn) {
        const { data: { session } } = await supabase.auth.getSession();
        renderHeaderBtn(session);
    }
}, 1000);