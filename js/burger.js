document.addEventListener('DOMContentLoaded', () => {
    const burgerBtn = document.getElementById('burger-btn');
    const mobileMenu = document.getElementById('mobile-menu');
    const closeBtn = document.getElementById('mobile-close-btn');

    if (burgerBtn && mobileMenu) {
        const toggle = () => {
            burgerBtn.classList.toggle('active');
            mobileMenu.classList.toggle('active');
            document.body.style.overflow = mobileMenu.classList.contains('active') ? 'hidden' : '';
        };
        burgerBtn.addEventListener('click', toggle);
        closeBtn?.addEventLisdocument.addEventListener('DOMContentLoaded', () => {
    const burgerBtn = document.getElementById('burger-btn');
    const mobileMenu = document.getElementById('mobile-menu');
    const closeBtn = document.getElementById('mobile-close-btn');

    if (burgerBtn && mobileMenu) {
        const toggle = () => {
            burgerBtn.classList.toggle('active');
            mobileMenu.classList.toggle('active');
            document.body.style.overflow = mobileMenu.classList.contains('active') ? 'hidden' : '';
        };
        burgerBtn.addEventListener('click', toggle);
        closeBtn?.addEventListener('click', toggle);
    }
});tener('click', toggle);
    }
});