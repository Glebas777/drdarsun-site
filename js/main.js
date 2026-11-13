import { supabase } from './supabase-client.js';

document.addEventListener('DOMContentLoaded', () => {
    // Проверка сессии для хедера
    const authButtons = document.getElementById('auth-buttons');
    if (authButtons) {
        supabase.auth.getSession().then(({ data: { session } }) => {
            if (session) {
                authButtons.innerHTML = `
                    <a href="profile.html" class="btn btn--outline">Профиль</a>
                    <a href="cart.html" class="btn btn--primary">Корзина</a>
                `;
            }
        });
    }
});

// Toast
window.showToast = (message, type = 'success') => {
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
};