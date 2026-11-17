const themeToggle = document.getElementById('theme-toggle');
const heroVideo = document.getElementById('hero-video');

const moonIcon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>';
const sunIcon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="5"></circle><path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72 1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"></path></svg>';

function updateTheme(isDark) {
    if (themeToggle) {
        themeToggle.innerHTML = isDark ? sunIcon : moonIcon;
        themeToggle.setAttribute('aria-label', isDark ? 'Включить светлую тему' : 'Включить тёмную тему');
        themeToggle.setAttribute('aria-pressed', String(isDark));
    }

    if (heroVideo) {
        const nextSource = isDark ? 'assets/videos/маслотёмное.mp4' : 'assets/videos/маслосветлое.mp4';
        if (!heroVideo.currentSrc.endsWith(encodeURI(nextSource)) && !heroVideo.src.endsWith(nextSource)) {
            heroVideo.src = nextSource;
            heroVideo.load();
            heroVideo.play().catch(() => {});
        }
    }
}

let savedTheme = 'light';
try {
    savedTheme = localStorage.getItem('theme') || 'light';
} catch (error) {
    console.warn('Theme preference is unavailable:', error);
}
document.body.classList.toggle('dark-theme', savedTheme === 'dark');
updateTheme(savedTheme === 'dark');

themeToggle?.addEventListener('click', () => {
    const isDark = !document.body.classList.contains('dark-theme');
    document.body.classList.toggle('dark-theme', isDark);
    try {
        localStorage.setItem('theme', isDark ? 'dark' : 'light');
    } catch (error) {
        console.warn('Theme preference could not be saved:', error);
    }
    updateTheme(isDark);
});

const revealItems = document.querySelectorAll('.hero__content, .hero__image, .feature-card');

if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const revealObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
        });
    }, { threshold: 0.12 });

    revealItems.forEach((item, index) => {
        item.classList.add('reveal-on-scroll');
        item.style.setProperty('--reveal-index', String(index));
        revealObserver.observe(item);
    });
} else {
    revealItems.forEach(item => item.classList.add('is-visible'));
}

window.showToast = function(message, type = 'success') {
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 400);
    }, 3500);
};
