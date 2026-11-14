import { supabase } from './supabase-client.js';

// --- СМЕНА ТЕМЫ ---
const themeToggle = document.getElementById('theme-toggle');
if (themeToggle) {
    const body = document.body;
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') body.classList.add('dark-theme');

    themeToggle.addEventListener('click', () => {
        body.classList.toggle('dark-theme');
        localStorage.setItem('theme', body.classList.contains('dark-theme') ? 'dark' : 'light');
    });
}

// --- ИИ-ЧАТ НА ГЛАВНОЙ (ЗАГЛУШКА, НО РАБОТАЕТ) ---
const chatInput = document.getElementById('chat-input');
const chatSend = document.getElementById('chat-send');
const chatMessages = document.getElementById('chat-messages');

if (chatSend && chatInput && chatMessages) {
    chatSend.addEventListener('click', async () => {
        const text = chatInput.value.trim();
        if (!text) return;

        chatMessages.innerHTML += `<div class="msg user">${text}</div>`;
        chatInput.value = '';

        try {
            const res = await fetch('https://drdarsun-site-main.layero.app/api/gigachat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: text, sessionId: 'user_123', history: [] })
            });
            const data = await res.json();
            chatMessages.innerHTML += `<div class="msg bot">${data.reply || 'Ошибка'}</div>`;
            chatMessages.scrollTop = chatMessages.scrollHeight;
        } catch (e) {
            chatMessages.innerHTML += `<div class="msg bot">Ошибка связи.</div>`;
        }
    });
}