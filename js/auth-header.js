import { supabase } from './supabase-client.js';

async function updateHeader() {
    const container = document.getElementById('auth-buttons');
    if (!container) return;

    try {
        const { data: { session } } = await supabase.auth.getSession();
        
        if (session) {
            // Если вошел — показываем Профиль
            container.innerHTML = `
                <a href="profile.html" class="header__btn" style="text-decoration: none; background: var(--accent-green); color: #fff; padding: 8px 20px; border-radius: 8px;">Профиль</a>
            `;
        } else {
            // Если не вошел — показываем Войти
            container.innerHTML = `
                <a href="login.html" class="header__btn" style="text-decoration: none; background: var(--accent-green); color: #fff; padding: 8px 20px; border-radius: 8px;">Войти</a>
            `;
        }
    } catch (e) {
        console.error('Header Error:', e);
        container.innerHTML = `<a href="login.html" class="header__btn">Войти</a>`;
    }
}

document.addEventListener('DOMContentLoaded', updateHeader);
supabase.auth.onAuthStateChange(() => updateHeader());