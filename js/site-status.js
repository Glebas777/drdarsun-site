const STATUS_URL = 'https://drdarsun-site-main.layero.app/api/site-status';
const MAINTENANCE_URL = 'maintenance.html';

import(new URL('site-toasts.js', document.currentScript.src).href).catch(error => {
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

async function checkSiteStatus() {
    if (window.location.pathname.endsWith('/maintenance.html')) return;
    try {
        const response = await fetch(STATUS_URL, {
            cache: 'no-store',
            signal: AbortSignal.timeout(3000)
        });
        if (!response.ok) return;
        const result = await response.json();
        if (result.maintenance === true) window.location.replace(MAINTENANCE_URL);
    } catch (error) {
        console.warn('Site maintenance status check failed:', error.message);
    }
}

checkSiteStatus();
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkSiteStatus();
});
window.addEventListener('pageshow', event => {
    if (event.persisted) checkSiteStatus();
});
