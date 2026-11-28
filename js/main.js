const themeToggle = document.getElementById('theme-toggle');
const heroVideo = document.getElementById('hero-video');
const heroOilLabel = document.getElementById('hero-oil-label');
let heroVideoActive = false;

const moonIcon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>';
const sunIcon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="5"></circle><path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72 1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"></path></svg>';

function updateTheme(isDark) {
    if (themeToggle) {
        themeToggle.innerHTML = isDark ? sunIcon : moonIcon;
        themeToggle.setAttribute('aria-label', isDark ? 'Включить светлую тему' : 'Включить тёмную тему');
        themeToggle.setAttribute('aria-pressed', String(isDark));
    }

    if (heroVideo && heroVideoActive) {
        const nextSource = isDark ? heroVideo.dataset.darkSrc : heroVideo.dataset.lightSrc;
        if (!heroVideo.currentSrc.endsWith(encodeURI(nextSource)) && !heroVideo.src.endsWith(nextSource)) {
            heroVideo.src = nextSource;
            heroVideo.load();
        }
        if (heroVideo.paused) heroVideo.play().catch(() => {});
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

if (heroVideo) {
    const videoShell = heroVideo.closest('.video-section-shell');
    const startVideo = () => {
        heroVideoActive = true;
        updateTheme(document.body.classList.contains('dark-theme'));
    };
    if ('IntersectionObserver' in window && videoShell) {
        const videoObserver = new IntersectionObserver(([entry]) => {
            if (entry.isIntersecting) {
                startVideo();
            } else {
                heroVideo.pause();
            }
        }, { rootMargin: '200px 0px' });
        videoObserver.observe(videoShell);
    } else {
        startVideo();
    }
}

if (heroOilLabel) {
    const oils = [
        'Натуральные растительные масла',
        'Натуральные масла холодного отжима',
        'Натуральные масла для яркого вкуса',
        'Натуральные масла с заботой о качестве'
    ];
    const prefix = 'Натуральные';
    const text = document.createTextNode(oils[0]);
    const caret = document.createElement('span');
    caret.className = 'hero__title-oil-caret';
    caret.setAttribute('aria-hidden', 'true');
    heroOilLabel.replaceChildren(text, caret);

    function waitUntilVisible() {
        if (!document.hidden) return Promise.resolve();
        return new Promise(resolve => {
            const onVisibilityChange = () => {
                if (document.hidden) return;
                document.removeEventListener('visibilitychange', onVisibilityChange);
                resolve();
            };
            document.addEventListener('visibilitychange', onVisibilityChange);
        });
    }

    async function pause(duration) {
        await waitUntilVisible();
        await new Promise(resolve => window.setTimeout(resolve, duration));
        await waitUntilVisible();
    }

    function setEditingMode(mode) {
        heroOilLabel.classList.toggle('is-erasing', mode === 'erasing');
        heroOilLabel.classList.toggle('is-writing', mode === 'writing');
    }

    async function eraseTo(target) {
        setEditingMode('erasing');
        const targetLength = Array.from(target).length;
        while (Array.from(text.data).length > targetLength) {
            text.data = Array.from(text.data).slice(0, -1).join('');
            await pause(32 + Math.random() * 36);
        }
        setEditingMode('');
    }

    async function writeTo(target) {
        setEditingMode('writing');
        const characters = Array.from(target);
        while (Array.from(text.data).length < characters.length) {
            const nextCharacter = characters[Array.from(text.data).length];
            text.data += nextCharacter;
            const isWordBoundary = nextCharacter === ' ';
            await pause(isWordBoundary ? 95 + Math.random() * 90 : 42 + Math.random() * 75);
        }
        heroOilLabel.setAttribute('aria-label', target);
        setEditingMode('');
    }

    async function animateOilHeading() {
        await pause(5000);
        await eraseTo(prefix);
        await writeTo(oils[0]);
        await pause(1400);
        await eraseTo('');

        let oilIndex = 1;
        while (true) {
            await writeTo(oils[oilIndex]);
            oilIndex = (oilIndex + 1) % oils.length;
            await pause(5000);
            await eraseTo('');
        }
    }

    animateOilHeading();
}

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

window.showToast = function(message, type = 'success', durationMs = 3500) {
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
    container.scrollTop = container.scrollHeight;
    requestAnimationFrame(() => toast.classList.add('show'));

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 400);
    }, Math.max(1000, durationMs));
    return toast;
};
