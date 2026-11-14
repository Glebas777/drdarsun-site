import { supabase } from './supabase-client.js';

// 1. Вход через Яндекс
document.getElementById('btn-yandex')?.addEventListener('click', async () => {
    const { error } = await supabase.auth.signInWithOAuth({
        provider: 'custom:yandex',
        options: { redirectTo: window.location.origin + '/profile.html' }
    });
    if (error) alert('Ошибка Яндекса: ' + error.message);
});

// 2. Вход через Google
document.getElementById('btn-google')?.addEventListener('click', async () => {
    const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin + '/profile.html' }
    });
    if (error) alert('Ошибка Google: ' + error.message);
});

// 3. Вход через Telegram
document.getElementById('btn-telegram')?.addEventListener('click', async () => {
    const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'custom:telegram',
        options: { 
            redirectTo: window.location.origin + '/profile.html',
            skipBrowserRedirect: true
        }
    });
    if (error) return alert('Ошибка Telegram: ' + error.message);

    document.getElementById('tg-web-link').href = data.url;
    document.getElementById('tg-app-link').href = `tg://resolve?domain=darsun_auth_bot`; 
    document.getElementById('tg-modal').style.display = 'flex';
});

document.getElementById('close-tg')?.addEventListener('click', () => {
    document.getElementById('tg-modal').style.display = 'none';
});

// 4. Вход по Email
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

// 5. Меню (три точки)
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