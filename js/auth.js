import { supabase } from './supabase-client.js';

// Переключение вкладок
const tabLogin = document.getElementById('tab-login');
const tabRegister = document.getElementById('tab-register');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');

tabLogin?.addEventListener('click', () => {
    tabLogin.classList.add('active'); tabRegister.classList.remove('active');
    loginForm.style.display = 'flex'; registerForm.style.display = 'none';
});
tabRegister?.addEventListener('click', () => {
    tabRegister.classList.add('active'); tabLogin.classList.remove('active');
    registerForm.style.display = 'flex'; loginForm.style.display = 'none';
});

loginForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) showToast('Ошибка: ' + error.message, 'error');
    else window.location.href = 'profile.html';
});

registerForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('reg-name').value;
    const email = document.getElementById('reg-email').value;
    const password = document.getElementById('reg-password').value;
    const { error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: name } } });
    if (error) showToast('Ошибка: ' + error.message, 'error');
    else showToast('Аккаунт создан!', 'success');
});

document.getElementById('btn-google')?.addEventListener('click', () => supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin + '/profile.html' } }));
document.getElementById('btn-yandex')?.addEventListener('click', () => supabase.auth.signInWithOAuth({ provider: 'custom:yandex', options: { redirectTo: window.location.origin + '/profile.html' } }));
document.getElementById('btn-telegram')?.addEventListener('click', async () => {
    const { data } = await supabase.auth.signInWithOAuth({ provider: 'custom:telegram', options: { skipBrowserRedirect: true, redirectTo: window.location.origin + '/profile.html' } });
    if (data) window.location.href = data.url;
});