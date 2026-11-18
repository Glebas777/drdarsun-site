document.addEventListener('DOMContentLoaded', () => {
    const preloader = document.getElementById('preloader');
    const progressBar = document.querySelector('.preloader-progress-bar');
    const textEl = document.getElementById('preloader-text');
    if (!preloader) return;

    // Список фраз
    const phrases = [
        "Вставляем картинки...",
        "Протираем пыль с картинок...",
        "Настраиваем свет...",
        "Доктор Брезель уже тут...",
        "Почти готово..."
    ];

    let phraseIndex = 0;
    
    // Меняем текст каждые 1.5 секунды
    const textInterval = setInterval(() => {
        if (textEl) {
            textEl.style.opacity = '0'; // Плавно скрываем
            setTimeout(() => {
                phraseIndex = (phraseIndex + 1) % phrases.length;
                textEl.textContent = phrases[phraseIndex];
                textEl.style.opacity = '1'; // Плавно показываем
            }, 300);
        }
    }, 1500);

    const startTime = Date.now();
    const MIN_DURATION = 3000;

    const hour = new Date().getHours();
    let activeBg = 'load_day';
    if (hour >= 5 && hour < 12) activeBg = 'load_morning';
    else if (hour >= 12 && hour < 18) activeBg = 'load_day';
    else if (hour >= 18 && hour < 23) activeBg = 'load_evening';
    else activeBg = 'load_night';
    
    const bgEl = document.getElementById(`bg-${activeBg}`);
    if (bgEl) bgEl.classList.add('active');

    let progress = 0;
    const progressInterval = setInterval(() => {
        progress += Math.random() * 10;
        if (progress > 90) progress = 90;
        if (progressBar) progressBar.style.width = `${progress}%`;
    }, 200);

    const hidePreloader = () => {
        clearInterval(textInterval);
        clearInterval(progressInterval);
        if (progressBar) progressBar.style.width = '100%';
        setTimeout(() => preloader.classList.add('hidden'), 500);
    };

    window.addEventListener('load', () => {
        const elapsedTime = Date.now() - startTime;
        if (elapsedTime < MIN_DURATION) {
            setTimeout(hidePreloader, MIN_DURATION - elapsedTime);
        } else {
            hidePreloader();
        }
    });
});

