(() => {
    const timerKey = 'floating-controls-auto-collapse';
    let collapseTimer;

    function setTrayOpen(tray, open) {
        tray.classList.toggle('is-open', open);
        tray.dataset.open = String(open);
        const toggle = tray.querySelector('.floating-controls__toggle');
        toggle.setAttribute('aria-expanded', String(open));
        toggle.setAttribute('aria-label', open ? 'Свернуть быстрые действия' : 'Открыть быстрые действия');
        clearTimeout(collapseTimer);
        if (open) collapseTimer = window.setTimeout(() => setTrayOpen(tray, false), 15000);
    }

    function start() {
        const launchers = [...document.querySelectorAll('.chat-launcher, .snake-launcher, .music-player__toggle')]
            .filter(element => !element.closest('.floating-controls'));
        if (launchers.length < 2) return;

        const tray = document.createElement('aside');
        tray.className = 'floating-controls';
        tray.setAttribute('aria-label', 'Быстрые действия');
        tray.dataset.open = 'false';
        tray.innerHTML = '<button class="floating-controls__toggle" type="button" aria-label="Открыть быстрые действия" aria-expanded="false"><span aria-hidden="true">←</span></button><div class="floating-controls__items"></div>';
        document.body.appendChild(tray);

        const items = tray.querySelector('.floating-controls__items');
        launchers.forEach((launcher, index) => {
            launcher.classList.add('floating-controls__item');
            launcher.style.setProperty('--item-index', String(index));
            items.appendChild(launcher);
        });

        tray.querySelector('.floating-controls__toggle').addEventListener('click', event => {
            event.stopPropagation();
            setTrayOpen(tray, tray.dataset.open !== 'true');
        });
        tray.addEventListener('pointerenter', () => clearTimeout(collapseTimer));
        tray.addEventListener('pointerleave', () => {
            if (tray.dataset.open === 'true') collapseTimer = window.setTimeout(() => setTrayOpen(tray, false), 15000);
        });
        tray.addEventListener('pointerdown', () => {
            clearTimeout(collapseTimer);
            if (tray.dataset.open === 'true') collapseTimer = window.setTimeout(() => setTrayOpen(tray, false), 15000);
        });

        const attachLateLauncher = () => {
            const late = document.querySelector('.music-player__toggle');
            if (!late || late.closest('.floating-controls')) return;
            late.classList.add('floating-controls__item');
            late.style.setProperty('--item-index', String(items.children.length));
            items.appendChild(late);
        };
        attachLateLauncher();
        const lateObserver = new MutationObserver(attachLateLauncher);
        lateObserver.observe(document.body, { childList: true, subtree: true });
    }

    function scheduleStart() {
        if (document.querySelector('.floating-controls')) return;
        start();
        if (!document.querySelector('.floating-controls')) {
            const observer = new MutationObserver(() => {
                if (document.querySelector('.floating-controls')) observer.disconnect();
                else if (document.querySelectorAll('.chat-launcher, .snake-launcher, .music-player__toggle').length >= 2) {
                    start();
                    if (document.querySelector('.floating-controls')) observer.disconnect();
                }
            });
            observer.observe(document.body, { childList: true, subtree: true });
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scheduleStart, { once: true });
    else scheduleStart();
})();
