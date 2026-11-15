import { supabase } from './supabase-client.js';

async function updateHeader() {
    const container = document.getElementById('auth-buttons');
    if (!container) return;

    const { data: { session } } = await supabase.auth.getSession();

    if (session) {
        container.innerHTML = `
            <a href="profile.html" class="header__btn" style="text-decoration: none; background: var(--accent-green); color: #fff; padding: 8px 20px; border-radius: 8px;">Профиль</a>
        `;
    } else {
        container.innerHTML = `
            <a href="login.html" class="header__btn" style="text-decoration: none; background: var(--accent-green); color: #fff; padding: 8px 20px; border-radius: 8px;">Войти</a>
        `;
    }
}

document.addEventListener('DOMContentLoaded', updateHeader);
supabase.auth.onAuthStateChange(() => updateHeader());