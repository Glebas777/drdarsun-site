const TELEGRAM_BOT_INFO_URL = 'https://drdarsun-site-main.layero.app/api/telegram/client/info';

export async function initializeTelegramBotLinks() {
    const links = document.querySelectorAll('[data-telegram-bot-link]');
    if (!links.length) return;

    try {
        const response = await fetch(TELEGRAM_BOT_INFO_URL, {
            headers: { Accept: 'application/json' },
            cache: 'force-cache'
        });
        if (!response.ok) throw new Error(`Telegram bot info request failed (${response.status}).`);
        const result = await response.json();

        for (const link of links) {
            const url = link.dataset.telegramBotLink === 'support'
                ? result.supportUrl
                : result.url;
            if (typeof url !== 'string') continue;

            const botUrl = new URL(url);
            if (botUrl.protocol !== 'https:' || botUrl.hostname !== 't.me' ||
                !/^\/[A-Za-z0-9_]{5,32}$/.test(botUrl.pathname) || botUrl.search || botUrl.hash) {
                console.warn('Telegram bot info returned an invalid URL.');
                continue;
            }
            link.href = botUrl.toString();
            link.hidden = false;
        }
    } catch (error) {
        console.warn('Telegram bot links are unavailable:', error);
    }
}
