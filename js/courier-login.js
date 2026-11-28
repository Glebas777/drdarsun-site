import { supabase } from './supabase-client.js';

const form = document.getElementById('courier-login-form');
const errorElement = document.getElementById('courier-login-error');
const submitButton = form.querySelector('button[type="submit"]');

form.addEventListener('submit', async event => {
    event.preventDefault();
    errorElement.hidden = true;
    submitButton.disabled = true;
    submitButton.textContent = 'Проверяем доступ…';
    try {
        const { data, error } = await supabase.auth.signInWithPassword({
            email: document.getElementById('courier-email').value.trim(),
            password: document.getElementById('courier-password').value
        });
        if (error) throw new Error('Не удалось войти. Проверьте почту и пароль.');
        if (!data.session) throw new Error('Вход не подтверждён. Попробуйте ещё раз.');

        const response = await fetch('https://drdarsun-site-main.layero.app/api/courier/orders', {
            headers: { Authorization: `Bearer ${data.session.access_token}` },
            cache: 'no-store',
            signal: AbortSignal.timeout(8000)
        });
        const result = await response.json().catch(() => null);
        if (!response.ok) {
            await supabase.auth.signOut({ scope: 'local' });
            throw new Error(result?.error || 'Этому аккаунту не назначен доступ курьера.');
        }
        window.location.replace('courier.html');
    } catch (error) {
        errorElement.textContent = error.message || 'Не удалось войти в панель курьера.';
        errorElement.hidden = false;
    } finally {
        submitButton.disabled = false;
        submitButton.textContent = 'Войти в панель';
    }
});
