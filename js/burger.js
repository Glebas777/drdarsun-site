document.addEventListener('DOMContentLoaded', () => {
    const burgerBtn = document.getElementById('burger-btn');
    const mobileMenu = document.getElementById('mobile-menu');

    if (burgerBtn && mobileMenu) {
        burgerBtn.addEventListener('click', () => {
            burgerBtn.classList.toggle('active');
            mobileMenu.classList.toggle('active');
            
            // Блокируем скролл body, когда меню открыто
            if (mobileMenu.classList.contains('active')) {
                document.body.style.overflow = 'hidden';
                mobileMenu.style.opacity = '1';
                mobileMenu.style.pointerEvents = 'auto';
            } else {
                document.body.style.overflow = '';
                mobileMenu.style.opacity = '0';
                mobileMenu.style.pointerEvents = 'none';
            }
        });
    }
});