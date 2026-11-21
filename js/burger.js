document.addEventListener('DOMContentLoaded', () => {
    const burgerBtn = document.getElementById('burger-btn');
    const mobileMenu = document.getElementById('mobile-menu');
    if (burgerBtn && mobileMenu) {
        const desktopNav = document.querySelector('.header .nav');
        if (desktopNav) {
            const canonicalLinks = [
                ['index.html', 'Главная'],
                ['catalog.html', 'Каталог'],
                ['oil-catalog.html', 'Масла'],
                ['scientists-about-oils.html', 'Учёные о маслах'],
                ['about.html', 'О нас'],
                ['delivery.html', 'Доставка'],
                ['faq.html', 'Вопросы']
            ];
            const currentPage = window.location.pathname.split('/').pop() || 'index.html';
            const links = canonicalLinks.map(([href, text]) => {
                const link = document.createElement('a');
                link.href = href;
                link.textContent = text;
                if (href === currentPage) {
                    link.classList.add('active');
                    link.setAttribute('aria-current', 'page');
                }
                return link;
            });
            desktopNav.replaceChildren(...links);

            const closeButton = mobileMenu.querySelector('#mobile-close-btn, .mobile-close');
            const accountLink = mobileMenu.querySelector('[data-mobile-account]');
            const mobileLinks = links.map(link => link.cloneNode(true));
            mobileMenu.replaceChildren(
                ...(closeButton ? [closeButton] : []),
                ...links,
                ...(accountLink ? [accountLink] : [])
            );
        }
        document.body.appendChild(mobileMenu);
        mobileMenu.setAttribute('role', 'navigation');
        mobileMenu.setAttribute('aria-label', 'Мобильная навигация');
        mobileMenu.setAttribute('aria-hidden', 'true');
        burgerBtn.setAttribute('aria-controls', mobileMenu.id);
        let savedScrollY = 0;
        let savedBodyStyles;
        let savedHtmlOverflow;
        const getClosestLink = target => target instanceof Element ? target.closest('a, .mobile-close') : null;

        const setOpen = (open) => {
            burgerBtn.classList.toggle('active', open);
            mobileMenu.classList.toggle('active', open);
            burgerBtn.setAttribute('aria-expanded', String(open));
            burgerBtn.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
            mobileMenu.setAttribute('aria-hidden', String(!open));

            if (open) {
                savedScrollY = window.scrollY;
                savedBodyStyles = {
                    position: document.body.style.position,
                    top: document.body.style.top,
                    left: document.body.style.left,
                    right: document.body.style.right,
                    width: document.body.style.width,
                    overflow: document.body.style.overflow
                };
                savedHtmlOverflow = document.documentElement.style.overflow;
                document.body.style.position = 'fixed';
                document.body.style.top = `-${savedScrollY}px`;
                document.body.style.left = '0';
                document.body.style.right = '0';
                document.body.style.width = '100%';
                document.body.style.overflow = 'hidden';
                document.documentElement.style.overflow = 'hidden';
                document.body.classList.add('menu-open');
                return;
            }

            if (savedBodyStyles) {
                Object.assign(document.body.style, savedBodyStyles);
                document.documentElement.style.overflow = savedHtmlOverflow;
                savedBodyStyles = null;
                document.body.classList.remove('menu-open');
                window.scrollTo(0, savedScrollY);
            }
        };

        burgerBtn.setAttribute('aria-expanded', 'false');
        burgerBtn.setAttribute('aria-label', 'Открыть меню');
        burgerBtn.addEventListener('click', () => setOpen(!mobileMenu.classList.contains('active')));
        mobileMenu.addEventListener('click', event => {
            if (event.target === mobileMenu || getClosestLink(event.target)) setOpen(false);
        });
        mobileMenu.addEventListener('touchmove', event => {
            const touch = event.touches[0];
            const startX = Number(mobileMenu.dataset.touchStartX);
            const startY = Number(mobileMenu.dataset.touchStartY);
            if (touch && Math.abs(touch.clientX - startX) > Math.abs(touch.clientY - startY)) {
                event.preventDefault();
            }
        }, { passive: false });
        mobileMenu.addEventListener('touchstart', event => {
            const touch = event.touches[0];
            if (!touch) return;
            mobileMenu.dataset.touchStartX = String(touch.clientX);
            mobileMenu.dataset.touchStartY = String(touch.clientY);
        }, { passive: true });
        document.getElementById('mobile-close-btn')?.addEventListener('click', () => setOpen(false));
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape') setOpen(false);
        });
    }
});