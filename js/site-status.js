const STATUS_URL = 'https://drdarsun-site-main.layero.app/api/site-status';
const MAINTENANCE_URL = 'maintenance.html';

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
window.setInterval(checkSiteStatus, 3000);
window.addEventListener('pageshow', event => {
    if (event.persisted) checkSiteStatus();
});
