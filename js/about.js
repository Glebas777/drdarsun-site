import { supabase } from './supabase-client.js';

document.addEventListener('DOMContentLoaded', async () => {
    const bookContainer = document.getElementById('book');
    if (!bookContainer) return;

    // Подключаем PageFlip
    const script = document.createElement('script');
    script.src = "https://cdn.jsdelivr.net/npm/page-flip/dist/js/page-flip.browser.js";
    document.head.appendChild(script);

    script.onload = async () => {
        // Загружаем одобренные отзывы
        let reviews = [];
        try {
            const res = await fetch('https://supabase-proxy.turgleb7.workers.dev/api/reviews');
            reviews = await res.json();
        } catch (e) { console.error(e); }

        // Генерируем страницы
        let pagesHTML = `
            <div class="page page-cover"><div class="page-content" style="justify-content:center;"><h2>Отзывы</h2><p>Dr. DarSun</p></div></div>
        `;

        // 10 страниц для отзывов
        for (let i = 1; i <= 10; i++) {
            const rev = reviews[i-1];
            const content = rev ? `<p style="font-style:italic;">«${rev.text}»</p><p style="text-align:right;font-weight:bold;">— ${rev.user_id.substring(0,5)}...</p>` : '';
            pagesHTML += `<div class="page"><div class="page-content">${content}<div style="margin-top:auto;font-size:12px;color:#999;">Стр. ${i+1}</div></div></div>`;
        }

        bookContainer.innerHTML = pagesHTML;

        // Инициализация
        const pageFlip = new St.PageFlip(bookContainer, {
            width: 700, height: 500, size: 'stretch', minWidth: 300, maxWidth: 800, minHeight: 400, maxHeight: 600, showCover: true, usePortrait: true
        });
        pageFlip.loadFromHTML(document.querySelectorAll('.page'));
    };
});