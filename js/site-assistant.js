const STICKERS = [
    { code: ':hello:', url: 'assets/images/hello.png' },
    { code: ':hooray:', url: 'assets/images/hooray.png' },
    { code: ':ok:', url: 'assets/images/ok.png' },
    { code: ':oops:', url: 'assets/images/oops.png' },
    { code: ':question:', url: 'assets/images/question.png' },
    { code: ':eat:', url: 'assets/images/eat.png' }
];

const assistant = document.querySelector('[data-site-assistant]');
const toggle = assistant && document.querySelector(`[aria-controls="${assistant.id}"]`);
const closeButton = assistant?.querySelector('[data-assistant-close]');
const messages = assistant?.querySelector('[data-assistant-messages]');
const form = assistant?.querySelector('[data-assistant-form]');
const input = assistant?.querySelector('[data-assistant-input]');
const sendButton = assistant?.querySelector('[data-assistant-send]');
const stickersButton = assistant?.querySelector('[data-assistant-stickers]');
const stickersPanel = assistant?.querySelector('[data-assistant-stickers-panel]');
const voiceButton = assistant?.querySelector('[data-assistant-voice]');
const context = assistant?.dataset.context === 'catalog' ? 'catalog' : 'site';
const historyKey = `drdarsun-site-assistant-v1-${context}`;
const stickerByCode = new Map(STICKERS.map(sticker => [sticker.code, sticker]));
let busy = false;
let recognition;

if (assistant && toggle && messages && form && input && sendButton) {
    function scrollToLatest() {
        messages.scrollTop = messages.scrollHeight;
    }

    function appendTextWithStickers(element, text) {
        const pattern = /:(?:hello|hooray|ok|oops|question|eat):/g;
        let cursor = 0;
        for (const match of text.matchAll(pattern)) {
            element.append(document.createTextNode(text.slice(cursor, match.index)));
            const sticker = stickerByCode.get(match[0]);
            if (sticker) {
                const image = document.createElement('img');
                image.className = 'msg-sticker-img';
                image.src = sticker.url;
                image.alt = 'Стикер';
                image.width = 64;
                image.height = 64;
                element.appendChild(image);
            }
            cursor = match.index + match[0].length;
        }
        element.append(document.createTextNode(text.slice(cursor)));
    }

    function addMessage(text, sender) {
        const wrapper = document.createElement('div');
        wrapper.className = `msg-wrapper ${sender}`;
        wrapper.dataset.sender = sender;
        wrapper.dataset.text = text;

        const bubble = document.createElement('div');
        bubble.className = 'msg';
        appendTextWithStickers(bubble, text);

        const meta = document.createElement('div');
        meta.className = 'msg-meta';
        meta.textContent = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        wrapper.append(bubble, meta);
        messages.appendChild(wrapper);
        scrollToLatest();
        saveHistory();
        return wrapper;
    }

    function saveHistory() {
        const history = Array.from(messages.querySelectorAll('.msg-wrapper'))
            .filter(wrapper => ['user', 'bot'].includes(wrapper.dataset.sender))
            .slice(-40)
            .map(wrapper => ({
                sender: wrapper.dataset.sender,
                text: wrapper.dataset.text.slice(0, 1200)
            }));
        try {
            localStorage.setItem(historyKey, JSON.stringify(history));
        } catch (error) {
            console.warn('Site assistant history could not be saved:', error);
        }
    }

    function restoreHistory() {
        try {
            const stored = localStorage.getItem(historyKey);
            if (!stored) return;
            const history = JSON.parse(stored);
            if (!Array.isArray(history)) throw new Error('Invalid assistant history format');
            messages.replaceChildren();
            history.slice(-40).forEach(item => {
                if (!item || !['user', 'bot'].includes(item.sender) || typeof item.text !== 'string') return;
                addMessage(item.text.slice(0, 1200), item.sender);
            });
        } catch (error) {
            console.warn('Site assistant history could not be restored:', error);
            messages.replaceChildren();
            try {
                localStorage.removeItem(historyKey);
            } catch (storageError) {
                console.warn('Invalid site assistant history could not be removed:', storageError);
            }
        }
    }

    function setOpen(open) {
        assistant.classList.toggle('active', open);
        assistant.setAttribute('aria-hidden', String(!open));
        assistant.inert = !open;
        toggle.setAttribute('aria-expanded', String(open));
        toggle.setAttribute('aria-label', open ? 'Закрыть чат с Доктором ДарСан' : 'Открыть чат с Доктором ДарСан');
        if (open) input.focus({ preventScroll: true });
        else toggle.focus({ preventScroll: true });
    }

    function getHistoryForRequest() {
        return Array.from(messages.querySelectorAll('.msg-wrapper'))
            .filter(wrapper => ['user', 'bot'].includes(wrapper.dataset.sender))
            .slice(0, -1)
            .slice(-8)
            .map(wrapper => ({
                role: wrapper.dataset.sender === 'bot' ? 'assistant' : 'user',
                content: wrapper.dataset.text
            }));
    }

    async function requestReply(text) {
        const typing = document.createElement('div');
        typing.className = 'msg-wrapper bot is-typing';
        typing.dataset.sender = 'typing';
        const bubble = document.createElement('div');
        bubble.className = 'msg';
        bubble.textContent = 'Доктор ДарСан печатает…';
        typing.appendChild(bubble);
        messages.appendChild(typing);
        scrollToLatest();

        try {
            const response = await fetch('https://drdarsun-site-main.layero.app/api/site-assistant', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: text, history: getHistoryForRequest(), context }),
                signal: AbortSignal.timeout(35_000)
            });
            const data = await response.json().catch(() => null);
            if (!response.ok) throw new Error(data?.error || 'Помощник временно недоступен. Попробуйте позже.');
            if (typeof data?.reply !== 'string' || !data.reply.trim()) {
                throw new Error('Не удалось получить ответ. Попробуйте позже.');
            }
            addMessage(data.reply.trim().slice(0, 4000), 'bot');
        } catch (error) {
            addMessage(error.message || 'Не удалось связаться с помощником. Попробуйте позже.', 'bot');
            console.error('Site assistant request failed:', error);
        } finally {
            typing.remove();
            busy = false;
            sendButton.disabled = false;
            input.disabled = false;
            input.focus({ preventScroll: true });
        }
    }

    function sendMessage(text = input.value.trim()) {
        if (!text || busy || text.length > 1200) return;
        addMessage(text, 'user');
        input.value = '';
        busy = true;
        sendButton.disabled = true;
        input.disabled = true;
        requestReply(text);
    }

    toggle.addEventListener('click', () => setOpen(!assistant.classList.contains('active')));
    closeButton?.addEventListener('click', () => setOpen(false));
    form.addEventListener('submit', event => {
        event.preventDefault();
        sendMessage();
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && assistant.classList.contains('active')) setOpen(false);
    });

    if (stickersButton && stickersPanel) {
        STICKERS.forEach(sticker => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'sticker-item';
            button.setAttribute('aria-label', `Отправить стикер ${sticker.code}`);
            const image = document.createElement('img');
            image.src = sticker.url;
            image.alt = '';
            button.appendChild(image);
            button.addEventListener('click', () => {
                stickersPanel.classList.remove('active');
                stickersButton.setAttribute('aria-expanded', 'false');
                sendMessage(sticker.code);
            });
            stickersPanel.appendChild(button);
        });
        stickersButton.addEventListener('click', () => {
            const open = !stickersPanel.classList.contains('active');
            stickersPanel.classList.toggle('active', open);
            stickersButton.setAttribute('aria-expanded', String(open));
        });
    }

    if (voiceButton) {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            voiceButton.hidden = true;
        } else {
            recognition = new SpeechRecognition();
            recognition.lang = 'ru-RU';
            recognition.interimResults = false;
            recognition.maxAlternatives = 1;
            voiceButton.addEventListener('click', () => {
                try {
                    recognition.start();
                    voiceButton.classList.add('is-listening');
                    input.placeholder = 'Говорите…';
                } catch (error) {
                    console.warn('Voice input could not start:', error);
                }
            });
            recognition.onresult = event => {
                input.value = event.results[0][0].transcript.slice(0, 1200);
                sendMessage();
            };
            recognition.onerror = () => {
                voiceButton.classList.remove('is-listening');
                input.placeholder = input.dataset.placeholder;
            };
            recognition.onend = () => {
                voiceButton.classList.remove('is-listening');
                input.placeholder = input.dataset.placeholder;
            };
        }
    }

    input.dataset.placeholder = input.placeholder;
    assistant.inert = true;
    restoreHistory();
}
