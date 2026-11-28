const API_URL = 'https://drdarsun-site-main.layero.app/api/visitor-count';
const STORAGE_KEY = 'drdarsun:visitor-counter:last-counted-day';
const countElement = document.getElementById('visitor-counter-count');
const statusElement = document.querySelector('[data-visitor-counter-status]');
const refreshButton = document.querySelector('[data-visitor-counter-refresh]');
let countAnimationObserver = null;
function renderCount(value, { animate = false } = {}) {
    if (!countElement) return;
    const count = Number(value);
    if (!Number.isSafeInteger(count) || count < 0) {
        throw new Error('Visitor count response is invalid.');
    }
    countAnimationObserver?.disconnect();
    countAnimationObserver = null;
    const formattedCount = new Intl.NumberFormat('ru-RU').format(count);
    const accessibleCount = document.createElement('span');
    accessibleCount.className = 'sr-only';
    accessibleCount.textContent = formattedCount;

    const digits = document.createElement('span');
    digits.className = 'visitor-counter__digits';
    digits.setAttribute('aria-hidden', 'true');
    const valueText = String(count);
    const shouldAnimate = animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    valueText.split('').forEach((digit, index) => {
        if (index > 0 && (valueText.length - index) % 3 === 0) {
            const separator = document.createElement('span');
            separator.className = 'visitor-counter__separator';
            separator.textContent = '\u202f';
            digits.appendChild(separator);
        }

        const digitWindow = document.createElement('span');
        digitWindow.className = 'visitor-counter__digit-window';
        const reel = document.createElement('span');
        reel.className = 'visitor-counter__digit-reel';
        reel.style.setProperty('--start-position', '-14.5em');
        reel.style.setProperty('--end-position', `-${(20 + Number(digit)) * 1.45}em`);
        reel.style.setProperty('--roll-delay', `${index * 18}ms`);
        reel.style.transform = shouldAnimate
            ? 'translateY(var(--start-position))'
            : 'translateY(var(--end-position))';
        for (let turn = 0; turn < 3; turn += 1) {
            for (let value = 0; value < 10; value += 1) {
                const reelDigit = document.createElement('span');
                reelDigit.className = 'visitor-counter__reel-digit';
                reelDigit.textContent = String(value);
                reel.appendChild(reelDigit);
            }
        }
        digitWindow.appendChild(reel);
        digits.appendChild(digitWindow);
    });

    countElement.replaceChildren(accessibleCount, digits);
    countElement.removeAttribute('title');
    if (shouldAnimate) {
        const startAnimation = () => digits.classList.add('is-rolling');
        if ('IntersectionObserver' in window) {
            const observer = new IntersectionObserver(entries => {
                if (!entries.some(entry => entry.isIntersecting)) return;
                observer.disconnect();
                if (countAnimationObserver === observer) countAnimationObserver = null;
                startAnimation();
            }, { threshold: 0.25 });
            countAnimationObserver = observer;
            observer.observe(countElement);
        } else {
            startAnimation();
        }
    }
}

async function requestCount(isNewDailyVisit, forceRefresh = false) {
    const url = forceRefresh ? `${API_URL}?refresh=1` : API_URL;
    const response = await fetch(url, {
        method: isNewDailyVisit ? 'POST' : 'GET',
        ...(forceRefresh ? { cache: 'no-store' } : {}),
        ...(isNewDailyVisit ? {
            headers: { 'Content-Type': 'application/json' },
            body: '{}'
        } : {}),
        signal: AbortSignal.timeout(15_000)
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(result?.error || `Visitor count request failed: ${response.status}`);
    return result;
}

async function updateVisitorCounter({ forceRefresh = false } = {}) {
    const today = new Date().toISOString().slice(0, 10);
    let lastCountedDay = '';
    try {
        lastCountedDay = localStorage.getItem(STORAGE_KEY) || '';
    } catch (error) {
        console.warn('Visitor counter state is unavailable:', error.message);
    }

    const isNewDailyVisit = !forceRefresh && lastCountedDay !== today;
    try {
        const result = await requestCount(isNewDailyVisit, forceRefresh);
        renderCount(result.count, { animate: true });
        if (statusElement) statusElement.textContent = 'Посещения за текущий день';
        if (isNewDailyVisit) {
            try {
                localStorage.setItem(STORAGE_KEY, today);
            } catch (error) {
                console.warn('Visitor counter state could not be saved:', error.message);
            }
        }
    } catch (error) {
        if (countElement && !forceRefresh) {
            countElement.textContent = '—';
            countElement.title = 'Счётчик временно недоступен';
        }
        if (statusElement) statusElement.textContent = 'Счётчик временно недоступен';
        console.warn('Visitor counter could not be updated:', error.message);
    } finally {
        if (refreshButton) {
            refreshButton.disabled = false;
            refreshButton.classList.remove('is-loading');
        }
    }
}

refreshButton?.addEventListener('click', () => {
    if (refreshButton.disabled) return;
    refreshButton.disabled = true;
    refreshButton.classList.add('is-loading');
    if (statusElement) statusElement.textContent = 'Обновляем счётчик…';
    updateVisitorCounter({ forceRefresh: true });
});

updateVisitorCounter();
