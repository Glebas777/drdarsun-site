import { supabase } from './supabase-client.js';

// Твои стикеры
const STICKERS = [
    { code: ':hello:', url: 'assets/images/hello.png' },
    { code: ':hooray:', url: 'assets/images/hooray.png' },
    { code: ':ok:', url: 'assets/images/ok.png' },
    { code: ':oops:', url: 'assets/images/oops.png' },
    { code: ':question:', url: 'assets/images/question.png' },
    { code: ':eat:', url: 'assets/images/eat.png' }
];

const chatBtn = document.getElementById('chat-send');
const chatInput = document.getElementById('chat-input');
const messagesContainer = document.getElementById('chat-messages');
const micBtn = document.getElementById('mic-btn');
const stickersBtn = document.getElementById('stickers-btn');
const stickersPanel = document.getElementById('stickers-panel');

let isBotBusy = false;
let messageQueue = [];
let isListening = false;

// --- 1. ГОЛОСОВОЙ ВВОД ---
if (micBtn) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.lang = 'ru-RU';
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;

        micBtn.addEventListener('click', () => {
            if (isListening) {
                recognition.stop();
                return;
            }
            recognition.start();
            isListening = true;
            micBtn.style.color = 'var(--accent-gold)';
            chatInput.placeholder = 'Говорите...';
        });

        recognition.onresult = (event) => {
            const text = event.results[0][0].transcript;
            chatInput.value = text;
            sendMessage();
        };

        recognition.onerror = () => {
            isListening = false;
            micBtn.style.color = '';
            chatInput.placeholder = 'Спросить Доктора...';
        };

        recognition.onend = () => {
            isListening = false;
            micBtn.style.color = '';
            chatInput.placeholder = 'Спросить Доктора...';
        };
    } else {
        micBtn.style.display = 'none';
    }
}

// --- 2. СТИКЕРЫ (ТЕПЕРЬ КАРТИНКИ) ---
if (stickersPanel) {
    STICKERS.forEach((sticker) => {
        const stickerDiv = document.createElement('div');
        stickerDiv.className = 'sticker-item';
        stickerDiv.style.backgroundImage = `url('${sticker.url}')`;
        stickerDiv.style.backgroundSize = 'contain';
        stickerDiv.style.backgroundRepeat = 'no-repeat';
        stickerDiv.style.backgroundPosition = 'center';
        stickerDiv.addEventListener('click', () => {
            sendSticker(sticker.code, 'user');
            stickersPanel.classList.remove('active');
        });
        stickersPanel.appendChild(stickerDiv);
    });
}

if (stickersBtn) stickersBtn.addEventListener('click', () => stickersPanel.classList.toggle('active'));

// --- 3. ДОБАВЛЕНИЕ СООБЩЕНИЙ ---
function addMessage(text, sender, isSticker = false) {
    if (!messagesContainer) return;
    const time = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    const wrapper = document.createElement('div');
    wrapper.className = `msg-wrapper ${sender}`;

    let content = '';
    if (isSticker) {
        // Ищем стикер по коду
        const sticker = STICKERS.find(s => s.code === text);
        if (sticker) {
            content = `<img src="${sticker.url}" class="msg-sticker-img" style="width: 100px; height: 100px; object-fit: contain;" alt="стикер">`;
        }
    } else {
        if (sender === 'bot') {
            content = marked.parse(text);
        } else {
            content = text;
        }
    }

    wrapper.innerHTML = `
        <div class="msg">${content}</div>
        <div class="msg-meta"><span>${time}</span></div>
    `;

    messagesContainer.appendChild(wrapper);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    saveHistory();
}

// --- 4. ИСТОРИЯ ---
function saveHistory() {
    if (!messagesContainer) return;
    const msgs = Array.from(messagesContainer.children).map(w => ({ html: w.innerHTML, className: w.className }));
    localStorage.setItem('dr_brezel_history', JSON.stringify(msgs));
}

function loadHistory() {
    if (!messagesContainer) return;
    const saved = localStorage.getItem('dr_brezel_history');
    if (saved) {
        messagesContainer.innerHTML = '';
        JSON.parse(saved).forEach(m => {
            const div = document.createElement('div');
            div.className = m.className;
            div.innerHTML = m.html;
            messagesContainer.appendChild(div);
        });
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
}
loadHistory();

// --- 5. ОТПРАВКА СТИКЕРА ---
function sendSticker(code, sender) {
    addMessage(code, sender, true);
    if (sender === 'user') {
        messageQueue.push({ text: `Я отправил стикер ${code}`, isSticker: true });
        processQueue();
    }
}

async function getBotResponse(text) {
    const typingId = 'typing-' + Date.now();
    const typingWrapper = document.createElement('div');
    typingWrapper.className = 'msg-wrapper bot';
    typingWrapper.id = typingId;
    typingWrapper.innerHTML = `<div class="msg"><i>Доктор ДарСан печатает...</i></div>`;
    messagesContainer.appendChild(typingWrapper);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    const history = Array.from(messagesContainer.querySelectorAll('.msg-wrapper'))
        .slice(-6)
        .map(w => ({ sender: w.classList.contains('user') ? 'user' : 'bot', text: w.querySelector('.msg')?.innerText || '' }));

    try {
        const res = await fetch('https://drdarsun-site-main.layero.app/api/gigachat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: text, sessionId: 'user_darsun', history: history })
        });
        
        if (!res.ok) throw new Error('Сервер упал');

        const data = await res.json();
        const reply = data.reply || 'Доктор задумался.';
        
        document.getElementById(typingId)?.remove();

        // Ищем стикеры в ответе
        const foundStickers = STICKERS.filter(s => reply.includes(s.code));
        let textReply = reply;
        
        // Убираем коды стикеров из текста
        foundStickers.forEach(s => { 
            textReply = textReply.replace(s.code, '').trim(); 
        });

        if (textReply) addMessage(textReply, 'bot');
        
        // Отправляем стикеры
        foundStickers.forEach(s => { 
            setTimeout(() => addMessage(s.code, 'bot', true), 500); 
        });

    } catch (e) {
        document.getElementById(typingId)?.remove();
        addMessage('Ошибка связи. Попробуйте позже.', 'bot');
        console.error(e);
    }
}

// --- 7. ОЧЕРЕДЬ ---
async function processQueue() {
    if (isBotBusy || messageQueue.length === 0) return;
    isBotBusy = true;
    const msg = messageQueue.shift();
    await getBotResponse(msg.text);
    isBotBusy = false;
    processQueue();
}

// --- 8. ОТПРАВКА СООБЩЕНИЯ ---
async function sendMessage() {
    const text = chatInput.value.trim();
    if (!text) return;

    addMessage(text, 'user');
    chatInput.value = '';
    messageQueue.push({ text });
    processQueue();
}

if (chatBtn && chatInput) {
    chatBtn.addEventListener('click', sendMessage);
    chatInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });
}