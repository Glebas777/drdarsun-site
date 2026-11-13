import { supabase } from './supabase-client.js';

// 1. Вход через Google
document.getElementById('btn-google')?.addEventListener('click', async () => {
    const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin + '/profile.html' }
    });
    if (error) alert('Ошибка Google: ' + error.message);
});

// 2. Вход через Яндекс
document.getElementById('btn-yandex')?.addEventListener('click', async () => {
    const { error } = await supabase.auth.signInWithOAuth({
        provider: 'custom:yandex',
        options: { redirectTo: window.location.origin + '/profile.html' }
    });
    if (error) alert('Ошибка Яндекса: ' + error.message);
});

// 3. Вход через Telegram (Модалка)
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

// 4. Логика ИИ
const aiBtn = document.getElementById('ai-btn');
const aiModal = document.getElementById('ai-modal');
const closeAi = document.getElementById('close-ai');
const aiInput = document.getElementById('ai-input');
const aiSend = document.getElementById('ai-send');
const aiMessages = document.getElementById('ai-messages');

if (aiBtn && aiModal) {
    aiBtn.addEventListener('click', () => {
        aiModal.style.display = aiModal.style.display === 'flex' ? 'none' : 'flex';
    });
    closeAi.addEventListener('click', () => {
        aiModal.style.display = 'none';
    });
}

if (aiSend && aiInput) {
    aiSend.addEventListener('click', async () => {
        const text = aiInput.value.trim();
        if (!text) return;

        aiMessages.innerHTML += `<div style="background: #D4AF37; color: #000; padding: 10px 15px; border-radius: 12px; border-bottom-right-radius: 2px; font-size: 14px; max-width: 80%; align-self: flex-end;">${text}</div>`;
        aiInput.value = '';

        try {
            const res = await fetch('https://drdarsun-site-main.layero.app/api/gigachat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: text, sessionId: 'test', history: [] })
            });
            const data = await res.json();
            aiMessages.innerHTML += `<div style="background: #222; padding: 10px 15px; border-radius: 12px; border-bottom-left-radius: 2px; font-size: 14px; max-width: 80%;">${data.reply || 'Ошибка'}</div>`;
        } catch (e) {
            aiMessages.innerHTML += `<div style="background: #F44336; color: #fff; padding: 10px 15px; border-radius: 12px; border-bottom-left-radius: 2px; font-size: 14px; max-width: 80%;">Ошибка связи.</div>`;
        }
    });
}

// --- БЛОКИРОВАТОР VPN ---
async function checkVPN() {
    try {
        const res = await fetch('https://ipapi.co/json/');
        const data = await res.json();
        const isVpn = data.org && (data.org.toLowerCase().includes('vpn') || data.org.toLowerCase().includes('proxy') || data.org.toLowerCase().includes('hosting'));
        if (isVpn) {
            const blocker = document.getElementById('vpn-blocker');
            if (blocker) blocker.style.display = 'flex';
        }
    } catch (e) {}
}
setTimeout(checkVPN, 1000);