const API_URL = 'https://drdarsun-site-main.layero.app/api/telegram/public-bots';
const BOT_PURPOSES = {
    client: 'каталог, заказы и привязка аккаунта',
    support: 'ответы на вопросы и связь с поддержкой',
    auth: 'безопасное подключение Telegram к профилю'
};

async function loadTelegramBots() {
    const containers = [
        document.getElementById('about-telegram-bots'),
        document.getElementById('news-telegram-bots')
    ].filter(Boolean);
    if (!containers.length) return;

    try {
        const response = await fetch(API_URL, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
        if (!response.ok) throw new Error(`Bot link request failed: ${response.status}`);
        const result = await response.json();
        const bots = Array.isArray(result?.bots)
            ? result.bots.filter(bot =>
                ['client', 'support', 'auth'].includes(bot?.role) &&
                typeof bot.username === 'string' &&
                /^https:\/\/t\.me\/[A-Za-z0-9_]+$/.test(bot.url)
            )
            : [];
        for (const container of containers) {
            container.replaceChildren();
            if (container.id === 'news-telegram-bots') {
                for (const bot of bots) {
                    const item = document.createElement('li');
                    const link = document.createElement('a');
                    link.href = bot.url;
                    link.target = '_blank';
                    link.rel = 'noopener noreferrer';
                    link.textContent = `${bot.label} · @${bot.username}`;
                    item.append(link, ` — ${BOT_PURPOSES[bot.role]}.`);
                    container.appendChild(item);
                }
                if (!bots.length) {
                    const item = document.createElement('li');
                    item.textContent = 'Ссылки на Telegram-ботов появятся здесь, когда боты будут доступны.';
                    container.appendChild(item);
                }
            } else {
                for (const bot of bots) {
                    const link = document.createElement('a');
                    link.href = bot.url;
                    link.target = '_blank';
                    link.rel = 'noopener noreferrer';
                    link.textContent = `${bot.label} · @${bot.username}`;
                    container.appendChild(link);
                }
            }
        }
    } catch (error) {
        console.warn('Telegram bot links are not available:', error.message);
    }
}

loadTelegramBots();
