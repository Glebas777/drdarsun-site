const themeToggle = document.getElementById('theme-toggle');
const body = document.body;
const heroVideo = document.getElementById('hero-video');

// Контурные SVG
const moonIcon = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>`;
const sunIcon = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>`;

function updateTheme(isDark) {
    // Иконка переключателя
    if (themeToggle) {
        themeToggle.innerHTML = isDark ? sunIcon : moonIcon;
        themeToggle.style.color = isDark ? '#F5B51B' : '#1B5E20';
    }

    // Видео на главной
    if (heroVideo) {
        heroVideo.src = isDark ? 'assets/videos/маслотёмное.mp4' : 'assets/videos/маслосветлое.mp4';
        heroVideo.load();
        heroVideo.play().catch(e => console.log('Автоплей заблокирован'));
    }
}

// Проверка темы при загрузке
const savedTheme = localStorage.getItem('theme');
if (savedTheme === 'dark') {
    body.classList.add('dark-theme');
    updateTheme(true);
} else {
    updateTheme(false);
}

// Переключение
if (themeToggle) {
    themeToggle.addEventListener('click', () => {
        body.classList.toggle('dark-theme');
        const isDark = body.classList.contains('dark-theme');
        localStorage.setItem('theme', isDark ? 'dark' : 'light');
        updateTheme(isDark);
    });
}