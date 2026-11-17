function initializePreloader() {
    const preloader = document.getElementById('preloader');
    if (!preloader || preloader.dataset.initialized === 'true') return;
    preloader.dataset.initialized = 'true';

    const progressBar = preloader.querySelector('.preloader-progress-bar');
    const text = preloader.querySelector('.preloader-text');
    const phrases = [
        'Вставляем картинки...',
        'Настраиваем свет...',
        'Готовим витрину...',
        'Почти готово...'
    ];
    let phraseIndex = 0;
    let progress = 0;
    const startTime = Date.now();
    const minimumDuration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 350;

    const hour = new Date().getHours();
    const backgroundId = hour >= 5 && hour < 12
        ? 'bg-load_morning'
        : hour >= 12 && hour < 18
            ? 'bg-load_day'
            : hour >= 18 && hour < 23
                ? 'bg-load_evening'
                : 'bg-load_night';
    document.getElementById(backgroundId)?.classList.add('active');

    const progressInterval = window.setInterval(() => {
        progress = Math.min(progress + 4, 88);
        if (progressBar) progressBar.style.width = `${progress}%`;
    }, 100);
    const textInterval = text ? window.setInterval(() => {
        phraseIndex = (phraseIndex + 1) % phrases.length;
        text.textContent = phrases[phraseIndex];
    }, 1400) : null;

    let hidden = false;
    const hide = () => {
        if (hidden) return;
        hidden = true;
        window.clearInterval(progressInterval);
        if (textInterval) window.clearInterval(textInterval);
        if (progressBar) progressBar.style.width = '100%';
        const remaining = Math.max(0, minimumDuration - (Date.now() - startTime));
        window.setTimeout(() => preloader.classList.add('hidden'), remaining);
    };

    window.addEventListener('load', hide, { once: true });
    window.setTimeout(hide, 8000);
    if (document.readyState === 'complete') hide();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializePreloader, { once: true });
} else {
    initializePreloader();
}
