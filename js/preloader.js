document.addEventListener('DOMContentLoaded', () => {
    const preloader = document.getElementById('preloader');
    const progressBar = document.querySelector('.preloader-progress-bar');
    if (!preloader) return;

    const startTime = Date.now();
    const MIN_DURATION = 3000; // 3 секунды

    // 1. Определяем время для фона
    const hour = new Date().getHours();
    let activeBg = 'load_day';
    if (hour >= 5 && hour < 12) activeBg = 'load_morning';
    else if (hour >= 12 && hour < 18) activeBg = 'load_day';
    else if (hour >= 18 && hour < 23) activeBg = 'load_evening';
    else activeBg = 'load_night';
    
    const bgEl = document.getElementById(`bg-${activeBg}`);
    if (bgEl) bgEl.classList.add('active');

    // 2. Имитация полоски прогресса
    let progress = 0;
    const progressInterval = setInterval(() => {
        progress += Math.random() * 10;
        if (progress > 90) progress = 90; 
        if (progressBar) progressBar.style.width = `${progress}%`;
    }, 200);

    // 3. Логика скрытия
    const hidePreloader = () => {
        clearInterval(progressInterval);
        if (progressBar) progressBar.style.width = '100%';
        
        setTimeout(() => {
            preloader.classList.add('hidden');
        }, 500);
    };

    window.addEventListener('load', () => {
        const elapsedTime = Date.now() - startTime;
        
        // Если сайт загрузился быстрее 3 секунд, ждем остаток
        if (elapsedTime < MIN_DURATION) {
            setTimeout(hidePreloader, MIN_DURATION - elapsedTime);
        } else {
            hidePreloader();
        }
    });
});