const STICKERS = [
    { code: ':hello:', url: 'assets/images/hello.png' },
    { code: ':hooray:', url: 'assets/images/hooray.png' },
    { code: ':ok:', url: 'assets/images/ok.png' },
    { code: ':oops:', url: 'assets/images/oops.png' },
    { code: ':question:', url: 'assets/images/question.png' },
    { code: ':eat:', url: 'assets/images/eat.png' }
];

const HISTORY_KEY = 'dr_darsun_chat_v2';
const chatBtn = document.getElementById('chat-send');
const chatInput = document.getElementById('chat-input');
const messagesContainer = document.getElementById('chat-messages');
const micBtn = document.getElementById('mic-btn');
const stickersBtn = document.getElementById('stickers-btn');
const stickersPanel = document.getElementById('stickers-panel');
const chatToggle = document.getElementById('bot-toggle');
const chatModal = document.getElementById('bot-modal');
const chatClose = document.getElementById('bot-close');

let isBotBusy = false;
let messageQueue = [];
let isListening = false;

function scrollToLatest() {
    if (messagesContainer) messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function addMessage(text, sender, stickerCode = '') {
    if (!messagesContainer) return null;

    const wrapper = document.createElement('div');
    wrapper.className = `msg-wrapper ${sender}`;
    wrapper.dataset.sender = sender;
    wrapper.dataset.text = text;
    if (stickerCode) wrapper.dataset.sticker = stickerCode;

    const bubble = document.createElement('div');
    bubble.className = 'msg';

    if (stickerCode) {
        const sticker = STICKERS.find(item => item.code === stickerCode);
        if (sticker) {
            const image = document.createElement('img');
            image.src = sticker.url;
            image.className = 'msg-sticker-img';
            image.alt = 'Стикер';
            image.width = 100;
            image.height = 100;
            bubble.appendChild(image);
        }
    } else {
        bubble.textContent = text;
    }

    const meta = document.createElement('div');
    meta.className = 'msg-meta';
    const time = document.createElement('span');
    time.textContent = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    meta.appendChild(time);
    wrapper.append(bubble, meta);
    messagesContainer.appendChild(wrapper);
    scrollToLatest();
    saveHistory();
    return wrapper;
}

function saveHistory() {
    if (!messagesContainer) return;
    const history = Array.from(messagesContainer.querySelectorAll('.msg-wrapper'))
        .filter(wrapper => wrapper.dataset.sender && wrapper.dataset.sender !== 'typing')
        .slice(-40)
        .map(wrapper => ({
            sender: wrapper.dataset.sender,
            text: wrapper.dataset.text || '',
            sticker: wrapper.dataset.sticker || ''
        }));

    try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch (error) {
        console.warn('Chat history could not be saved:', error);
    }
}

function loadHistory() {
    if (!messagesContainer) return;
    try {
        const stored = localStorage.getItem(HISTORY_KEY);
        if (!stored) return;
        const history = JSON.parse(stored);
        if (!Array.isArray(history)) throw new Error('Invalid chat history format');

        messagesContainer.replaceChildren();
        history.slice(-40).forEach(item => {
            if (!item || !['user', 'bot'].includes(item.sender) || typeof item.text !== 'string') return;
            const sticker = STICKERS.find(entry => entry.code === item.sticker);
            addMessage(item.text.slice(0, 1200), item.sender, sticker ? sticker.code : '');
        });
        scrollToLatest();
    } catch (error) {
        console.warn('Chat history could not be restored:', error);
        messagesContainer.replaceChildren();
        localStorage.removeItem(HISTORY_KEY);
    }
}

function setChatOpen(open) {
    chatModal?.classList.toggle('active', open);
    chatToggle?.setAttribute('aria-expanded', String(open));
    if (open) chatInput?.focus();
}

chatToggle?.addEventListener('click', () => setChatOpen(!chatModal.classList.contains('active')));
chatClose?.addEventListener('click', () => setChatOpen(false));
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setChatOpen(false);
});

if (stickersPanel) {
    STICKERS.forEach((sticker) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'sticker-item';
        button.setAttribute('aria-label', `Отправить стикер ${sticker.code}`);
        const image = document.createElement('img');
        image.src = sticker.url;
        image.alt = '';
        button.appendChild(image);
        button.addEventListener('click', () => {
            sendSticker(sticker.code, 'user');
            stickersPanel.classList.remove('active');
            stickersBtn?.setAttribute('aria-expanded', 'false');
        });
        stickersPanel.appendChild(button);
    });
}

stickersBtn?.addEventListener('click', () => {
    const open = !stickersPanel.classList.contains('active');
    stickersPanel.classList.toggle('active', open);
    stickersBtn.setAttribute('aria-expanded', String(open));
});

function sendSticker(code, sender) {
    addMessage('', sender, code);
    if (sender === 'user') {
        messageQueue.push({ text: `Я отправил стикер ${code}` });
        processQueue();
    }
}

function getHistoryForRequest() {
    return Array.from(messagesContainer.querySelectorAll('.msg-wrapper'))
        .filter(wrapper => ['user', 'bot'].includes(wrapper.dataset.sender))
        .slice(0, -1)
        .slice(-8)
        .map(wrapper => ({
            role: wrapper.dataset.sender === 'bot' ? 'assistant' : 'user',
            content: wrapper.dataset.sticker
                ? `Стикер ${wrapper.dataset.sticker}`
                : wrapper.dataset.text
        }))
        .filter(item => item.content);
}

async function getBotResponse(text) {
    const typing = document.createElement('div');
    typing.className = 'msg-wrapper bot is-typing';
    typing.dataset.sender = 'typing';
    const bubble = document.createElement('div');
    bubble.className = 'msg';
    bubble.textContent = 'Доктор ДарСан печатает…';
    typing.appendChild(bubble);
    messagesContainer.appendChild(typing);
    scrollToLatest();

    try {
        const response = await fetch('https://drdarsun-site-main.layero.app/api/gigachat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: text, history: getHistoryForRequest(), context: 'help' })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Помощник временно недоступен.');
        if (typeof data.reply !== 'string' || !data.reply.trim()) throw new Error('Не удалось получить ответ.');

        typing.remove();
        const reply = data.reply.trim();
        const stickers = STICKERS.filter(sticker => reply.includes(sticker.code));
        const textReply = STICKERS.reduce((result, sticker) => result.replaceAll(sticker.code, '').trim(), reply);
        if (textReply) addMessage(textReply, 'bot');
        stickers.forEach(sticker => addMessage('', 'bot', sticker.code));
    } catch (error) {
        typing.remove();
        addMessage(error.message || 'Помощник временно недоступен. Попробуйте позже.', 'bot');
        console.error('Chat request failed:', error);
    }
}

async function processQueue() {
    if (isBotBusy || messageQueue.length === 0) return;
    isBotBusy = true;
    const message = messageQueue.shift();
    try {
        await getBotResponse(message.text);
    } finally {
        isBotBusy = false;
        processQueue();
    }
}

function sendMessage() {
    const text = chatInput?.value.trim();
    if (!text || !chatBtn || chatBtn.disabled) return;
    if (text.length > 1200) {
        chatInput.setCustomValidity('Сообщение должно быть не длиннее 1200 символов.');
        chatInput.reportValidity();
        return;
    }

    chatInput.setCustomValidity('');
    addMessage(text, 'user');
    chatInput.value = '';
    messageQueue.push({ text });
    processQueue();
}

chatBtn?.addEventListener('click', sendMessage);
chatInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
    }
});

if (micBtn) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        micBtn.hidden = true;
    } else {
        const recognition = new SpeechRecognition();
        recognition.lang = 'ru-RU';
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;

        micBtn.addEventListener('click', () => {
            if (isListening) {
                recognition.stop();
                return;
            }
            try {
                recognition.start();
                isListening = true;
                micBtn.classList.add('is-listening');
                chatInput.placeholder = 'Говорите…';
            } catch (error) {
                console.warn('Speech recognition could not start:', error);
            }
        });

        recognition.onresult = (event) => {
            chatInput.value = event.results[0][0].transcript.slice(0, 1200);
            sendMessage();
        };
        recognition.onerror = () => {
            isListening = false;
            micBtn.classList.remove('is-listening');
            chatInput.placeholder = 'Спросить Доктора…';
        };
        recognition.onend = () => {
            isListening = false;
            micBtn.classList.remove('is-listening');
            chatInput.placeholder = 'Спросить Доктора…';
        };
    }
}

loadHistory();
