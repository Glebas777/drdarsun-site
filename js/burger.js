document.addEventListener('DOMContentLoaded', () => {
    const burgerBtn = document.getElementById('burger-btn');
    const mobileMenu = document.getElementById('mobile-menu');
    if (burgerBtn && mobileMenu) {
        const setOpen = (open) => {
            burgerBtn.classList.toggle('active', open);
            mobileMenu.classList.toggle('active', open);
            burgerBtn.setAttribute('aria-expanded', String(open));
            document.body.classList.toggle('menu-open', open);
        };

        burgerBtn.setAttribute('aria-expanded', 'false');
        burgerBtn.addEventListener('click', () => setOpen(!mobileMenu.classList.contains('active')));
        mobileMenu.querySelectorAll('a').forEach(link => link.addEventListener('click', () => setOpen(false)));
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape') setOpen(false);
        });
    }
});