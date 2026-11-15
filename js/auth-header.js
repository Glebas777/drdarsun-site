import { supabase } from './supabase-client.js';

async function updateHeader() {
    const authContainer = document.getElementById('auth-buttons');
    if (!authContainer) return;

    const { data: { session } } = await supabase.auth.getSession();

    if (session) {
        authContainer.innerHTML = `
            <a href="cart.html" class="header__btn" style="text-decoration: none;">Корзина</a>
            <a href="profile.html" class="header__btn" style="text-decoration: none;">Личный кабинет</a>
        `;
    } else {
        authContainer.innerHTML = `<a href="login.html" class="header__btn" style="text-decoration: none;">Войти</a>`;
    }
}

// Обновляем хедер при загрузке страницы
document.addEventListener('DOMContentLoaded', updateHeader);

// Слушаем изменения сессии (если вошел/вышел на этой же странице)
supabase.auth.onAuthStateChange(() => {
    updateHeader();
});