import { supabase } from './supabase-client.js';

// --- УНИВЕРСАЛЬНЫЙ ХЕДЕР ---
async function updateHeaderAuth() {
    const container = document.getElementById('auth-buttons');
    if (!container) return;

    container.innerHTML = `<span style="color: #888; font-size: 14px;">...</span>`;

    try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
            const userName = session.user.user_metadata.full_name || 'Профиль';
            container.innerHTML = `
                <a href="cart.html" class="header__btn" style="text-decoration: none; margin-right: 10px;">Корзина</a>
                <a href="profile.html" class="header__btn" style="text-decoration: none;">${userName.split(' ')[0]}</a>
            `;
        } else {
            container.innerHTML = `<a href="login.html" class="header__btn" style="text-decoration: none;">Войти</a>`;
        }
    } catch (e) {
        console.error('Header Auth Error:', e);
        container.innerHTML = `<a href="login.html" class="header__btn" style="text-decoration: none;">Войти</a>`;
    }
}

document.addEventListener('DOMContentLoaded', updateHeaderAuth);
supabase.auth.onAuthStateChange(() => updateHeaderAuth());

// --- СМЕНА ТЕМЫ ---
const themeToggle = document.getElementById('theme-toggle');
const heroVideo = document.getElementById('hero-video');

const moonIcon = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>`;
const sunIcon = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>`;

function updateTheme(isDark) {
    if (themeToggle) {
        themeToggle.innerHTML = isDark ? sunIcon : moonIcon;
        themeToggle.style.color = isDark ? '#F5B51B' : '#1B5E20';
    }
    if (heroVideo) {
        heroVideo.src = isDark ? 'assets/videos/маслотёмное.mp4' : 'assets/videos/маслосветлое.mp4';
        heroVideo.load();
        heroVideo.play().catch(e => console.log('Автоплей заблокирован'));
    }
}

const savedTheme = localStorage.getItem('theme');
if (savedTheme === 'dark') {
    document.body.classList.add('dark-theme');
    updateTheme(true);
} else {
    updateTheme(false);
}

if (themeToggle) {
    themeToggle.addEventListener('click', () => {
        document.body.classList.toggle('dark-theme');
        const isDark = document.body.classList.contains('dark-theme');
        localStorage.setItem('theme', isDark ? 'dark' : 'light');
        updateTheme(isDark);
    });
}

// --- ЧАТ НА ГЛАВНОЙ ---
const botToggle = document.getElementById('bot-toggle');
const botModal = document.getElementById('bot-modal');
const botClose = document.getElementById('bot-close');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const chatSend = document.getElementById('chat-send');

if (botToggle && botModal) {
    botToggle.addEventListener('click', () => {
        botModal.style.display = botModal.style.display === 'flex' ? 'none' : 'flex';
    });
}
if (botClose) botClose.addEventListener('click', () => botModal.style.display = 'none');

if (chatSend && chatInput) {
    chatSend.addEventListener('click', async () => {
        const text = chatInput.value.trim();
        if (!text) return;
        
        chatMessages.innerHTML += `<div class="msg-wrapper user"><div class="msg">${text}</div></div>`;
        chatInput.value = '';
        chatMessages.scrollTop = chatMessages.scrollHeight;

        try {
            const res = await fetch('https://drdarsun-site-main.layero.app/api/gigachat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: text, history: [] })
            });
            const data = await res.json();
            chatMessages.innerHTML += `<div class="msg-wrapper bot"><div class="msg">${data.reply || 'Ошибка'}</div></div>`;
            chatMessages.scrollTop = chatMessages.scrollHeight;
        } catch (e) {
            chatMessages.innerHTML += `<div class="msg-wrapper bot"><div class="msg">Ошибка связи</div></div>`;
        }
    });
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') chatSend.click();
    });
}

// --- ГОЛОСОВОЙ ВВОД ---
const micBtn = document.getElementById('mic-btn');
if (micBtn) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.lang = 'ru-RU';
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;

        micBtn.addEventListener('click', () => {
            recognition.start();
            micBtn.style.color = 'var(--accent-gold)';
        });

        recognition.onresult = (event) => {
            const text = event.results[0][0].transcript;
            if (chatInput) chatInput.value = text;
            micBtn.style.color = '';
        };

        recognition.onerror = () => { micBtn.style.color = ''; };
        recognition.onend = () => { micBtn.style.color = ''; };
    } else {
        micBtn.style.display = 'none';
    }
}

// --- ТОСТЫ ---
window.showToast = function(message, type = 'success') {
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 400);
    }, 3000);
};