const STATUS_URL = 'https://drdarsun-site-main.layero.app/api/site-status';
const MAINTENANCE_URL = 'maintenance.html';
const siteStatusScriptUrl = document.currentScript?.src || window.location.href;

const monitoredHosts = new Set(['drdarsun-site-main.layero.app', 'rrpcqrvkhmlrdqvffnax.supabase.co']);
const connectionFailures = [];
const CONNECTION_FAILURE_LIMIT = 3;
const CONNECTION_WINDOW_MS = 45_000;
const SITE_STATUS_CHECK_INTERVAL_MS = 60_000;
const CONNECTION_DISMISS_KEY = 'darsun:connection-notice-dismissed';
let connectionNotice;
let nativeFetch;

function isConnectionNoticeDismissed() {
    try {
        return Date.now() - Number(sessionStorage.getItem(CONNECTION_DISMISS_KEY) || 0) < 120_000;
    } catch (error) {
        return false;
    }
}

function showConnectionNotice() {
    if (connectionNotice || isConnectionNoticeDismissed()) return;

    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = new URL('../css/connection-guard.css?v=1', siteStatusScriptUrl).href;
    document.head.appendChild(stylesheet);

    connectionNotice = document.createElement('div');
    connectionNotice.className = 'connection-guard';
    connectionNotice.setAttribute('role', 'dialog');
    connectionNotice.setAttribute('aria-modal', 'true');
    connectionNotice.setAttribute('aria-labelledby', 'connection-guard-title');
    connectionNotice.innerHTML = `
        <section class="connection-guard__card">
            <div class="connection-guard__icon" aria-hidden="true">
                <svg viewBox="0 0 48 48"><path d="M5 18a29 29 0 0 1 38 0M12 26a18 18 0 0 1 24 0M19 34a8 8 0 0 1 10 0"/><circle cx="24" cy="41" r="1.5"/><path d="m8 8 32 32"/></svg>
            </div>
            <p class="connection-guard__eyebrow">ПРОВЕРКА СОЕДИНЕНИЯ</p>
            <h1 id="connection-guard-title">Не удаётся связаться с сервисами</h1>
            <p class="connection-guard__text">Некоторые данные могут не загрузиться. VPN, прокси, фильтр DNS или нестабильная сеть иногда мешают соединению. Попробуйте отключить VPN/прокси или сменить сеть и проверьте ещё раз.</p>
            <p class="connection-guard__note">Это не блокировка аккаунта. Мы не проверяем и не сохраняем ваш IP-адрес.</p>
            <div class="connection-guard__actions">
                <button class="connection-guard__retry" type="button">Проверить соединение</button>
                <button class="connection-guard__continue" type="button">Продолжить на сайт</button>
            </div>
            <p class="connection-guard__status" aria-live="polite"></p>
        </section>`;
    document.body.appendChild(connectionNotice);

    const retryButton = connectionNotice.querySelector('.connection-guard__retry');
    const continueButton = connectionNotice.querySelector('.connection-guard__continue');
    const status = connectionNotice.querySelector('.connection-guard__status');

    const dismiss = () => {
        try {
            sessionStorage.setItem(CONNECTION_DISMISS_KEY, String(Date.now()));
        } catch (error) {
            console.warn('Connection notice dismissal could not be saved:', error.message);
        }
        connectionNotice?.remove();
        connectionNotice = null;
    };

    retryButton.addEventListener('click', async () => {
        retryButton.disabled = true;
        status.textContent = 'Проверяем доступность…';
        try {
            const response = await nativeFetch(STATUS_URL, {
                cache: 'no-store',
                signal: AbortSignal.timeout(10_000)
            });
            if (!response.ok) {
                console.warn('Site health check returned HTTP', response.status);
                status.textContent = 'Сервис временно недоступен. Попробуйте проверить позже.';
                retryButton.disabled = false;
                return;
            }
            connectionFailures.length = 0;
            connectionNotice.remove();
            connectionNotice = null;
        } catch (error) {
            console.warn('Connection retry failed:', error.message);
            status.textContent = 'Не удалось проверить соединение. Проверьте сеть и попробуйте снова.';
            retryButton.disabled = false;
        }
    });
    continueButton.addEventListener('click', dismiss);
    retryButton.focus();
}

function recordConnectionFailure() {
    const now = Date.now();
    connectionFailures.push(now);
    while (connectionFailures.length && now - connectionFailures[0] > CONNECTION_WINDOW_MS) {
        connectionFailures.shift();
    }
    if (connectionFailures.length >= CONNECTION_FAILURE_LIMIT) showConnectionNotice();
}

if (typeof window.fetch === 'function') {
    nativeFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
        let host;
        try {
            host = new URL(args[0] instanceof Request ? args[0].url : args[0], window.location.href).hostname;
        } catch (error) {
            return nativeFetch(...args);
        }
        if (!monitoredHosts.has(host)) return nativeFetch(...args);

        try {
            return await nativeFetch(...args);
        } catch (error) {
            if (error?.name === 'TypeError') recordConnectionFailure();
            throw error;
        }
    };
}

const footer = document.querySelector('.footer');
if (footer && !document.getElementById('visitor-counter-count')) {
    const counter = document.createElement('section');
    counter.className = 'visitor-counter';
    counter.setAttribute('aria-labelledby', 'visitor-counter-title');
    counter.innerHTML = `
        <div class="container visitor-counter__inner">
            <div class="visitor-counter__copy">
                <span class="visitor-counter__icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24"><path d="M16 20v-1.6a3.4 3.4 0 0 0-3.4-3.4H6.4A3.4 3.4 0 0 0 3 18.4V20"/><circle cx="9.5" cy="7" r="3.5"/><path d="M17 11a3.5 3.5 0 1 0-1.4-6.7M21 20v-1.6a3.4 3.4 0 0 0-2.5-3.3"/></svg>
                </span>
                <div>
                    <h2 id="visitor-counter-title">Посетители сегодня</h2>
                    <p data-visitor-counter-status aria-live="polite">Загружаем счётчик…</p>
                </div>
            </div>
            <div class="visitor-counter__reading">
                <span id="visitor-counter-count" class="visitor-counter__value" aria-live="polite" aria-atomic="true">—</span>
                <button class="visitor-counter__refresh" type="button" data-visitor-counter-refresh aria-label="Обновить счётчик" title="Обновить счётчик">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5"/><path d="M19.2 12a7.2 7.2 0 1 1-2-5L20 12"/></svg>
                    <span>Обновить</span>
                </button>
            </div>
        </div>`;
    footer.before(counter);
}

import(new URL('visitor-counter.js?v=visitor-roll-6', siteStatusScriptUrl).href).catch(error => {
    console.error('Visitor counter could not be loaded:', error);
});

import(new URL('site-toasts.js?v=service-timeouts-2', document.currentScript.src).href).catch(error => {
    console.error('Site notifications could not be loaded:', error);
});

if (!document.querySelector('[data-global-music-player]')) {
    const playerScript = document.createElement('script');
    playerScript.src = new URL('music-player.js', document.currentScript.src).href;
    playerScript.dataset.globalMusicPlayer = 'true';
    document.body.appendChild(playerScript);
}

if (!document.querySelector('[data-floating-controls]')) {
    const controlsScript = document.createElement('script');
    controlsScript.src = new URL('floating-controls.js', document.currentScript.src).href;
    controlsScript.dataset.floatingControls = 'true';
    document.body.appendChild(controlsScript);
}

let siteStatusCheck;
async function checkSiteStatus() {
    if (!['drdarsun.ru', 'www.drdarsun.ru'].includes(window.location.hostname)) return;
    if (siteStatusCheck) return siteStatusCheck;
    siteStatusCheck = (async () => {
    try {
        const response = await fetch(STATUS_URL, {
            cache: 'no-store',
            signal: AbortSignal.timeout(10_000)
        });
        if (!response.ok) return;
        const result = await response.json();
        const onMaintenancePage = window.location.pathname.endsWith('/maintenance.html');
        if (result.maintenance === true && !onMaintenancePage) {
            window.location.replace(MAINTENANCE_URL);
        } else if (result.maintenance !== true && onMaintenancePage) {
            window.location.replace('/');
        }
    } catch (error) {
        console.warn('Site maintenance status check failed:', error.message);
    }
    })().finally(() => {
        siteStatusCheck = null;
    });
    return siteStatusCheck;
}

checkSiteStatus();
window.setInterval(() => {
    if (!document.hidden) checkSiteStatus();
}, SITE_STATUS_CHECK_INTERVAL_MS);
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkSiteStatus();
});
window.addEventListener('pageshow', event => {
    if (event.persisted) checkSiteStatus();
});
