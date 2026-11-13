import { supabase } from './supabase-client.js';

document.addEventListener('DOMContentLoaded', async () => {
  const bookEl = document.getElementById('book');
  const prevBtn = document.getElementById('prev-page');
  const nextBtn = document.getElementById('next-page');
  const counter = document.getElementById('page-counter');

  // 1. Загружаем отзывы
  let reviews = [];
  try {
    const res = await fetch('/api/reviews');
    if (res.ok) reviews = await res.json();
  } catch (e) { console.error('Ошибка загрузки отзывов:', e); }

  // 2. Строим страницы
  let pagesHTML = `
    <div class="page page-cover" data-density="hard">
      <div class="page-content" style="justify-content: center; align-items: center;">
        <h2>Книга Отзывов</h2>
        <p>Dr. DarSun</p>
      </div>
    </div>`;

  reviews.forEach(rev => {
    const rating = rev.rating || 5;
    const stars = '★'.repeat(rating) + '☆'.repeat(5 - rating);
    pagesHTML += `
      <div class="page">
        <div class="page-content">
          <div style="color: var(--amber); font-size: 20px; margin-bottom: 10px;">${stars}</div>
          <p>«${rev.text}»</p>
          <div style="text-align: right; font-weight: bold; color: var(--primary); margin-top: 10px;">— ${rev.name || 'Аноним'}</div>
        </div>
      </div>`;
  });

  pagesHTML += `
    <div class="page" data-density="hard">
      <div class="page-content">
        <h3>Оставить отзыв</h3>
        <form id="review-form" style="display: flex; flex-direction: column; gap: 15px; height: 100%;">
          <input type="text" id="rev-name" class="review-input" placeholder="Ваше имя" required maxlength="20">
          <select id="rev-rating" class="review-input" style="cursor: pointer;">
            <option value="5">★★★★★ (Отлично)</option>
            <option value="4">★★★★☆ (Хорошо)</option>
            <option value="3">★★★☆☆ (Нормально)</option>
          </select>
          <textarea id="rev-text" class="review-input" placeholder="Ваш отзыв (до 500 символов)" required maxlength="500" style="flex: 1; resize: none;"></textarea>
          <button type="submit" class="btn btn--primary" style="width: 100%;">Записать</button>
        </form>
      </div>
    </div>`;
  
  bookEl.innerHTML = pagesHTML;

  // 3. Ждем загрузки библиотеки PageFlip (она подключена в about.html)
  if (typeof St === 'undefined') {
    console.error('PageFlip не загружен');
    return;
  }

  const pageFlip = new St.PageFlip(bookEl, {
    width: 600, height: 500, size: 'stretch',
    minWidth: 300, maxWidth: 700, minHeight: 400, maxHeight: 600,
    showCover: true, usePortrait: true, mobileScrollSupport: false
  });
  pageFlip.loadFromHTML(document.querySelectorAll('.page'));

  // 4. Кнопки и свайпы
  prevBtn.addEventListener('click', () => pageFlip.flipPrev());
  nextBtn.addEventListener('click', () => pageFlip.flipNext());

  let touchStartX = 0;
  bookEl.addEventListener('touchstart', (e) => { touchStartX = e.changedTouches[0].screenX; }, {passive: true});
  bookEl.addEventListener('touchend', (e) => {
    const touchEndX = e.changedTouches[0].screenX;
    if (touchEndX < touchStartX - 50) pageFlip.flipNext();
    if (touchEndX > touchStartX + 50) pageFlip.flipPrev();
  }, {passive: true});

  // 5. Счетчик страниц
  pageFlip.on('flip', (e) => {
    counter.textContent = `${e.data + 1} / ${pageFlip.getPageCount()}`;
  });

  // 6. Отправка формы
  document.getElementById('review-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('rev-name').value;
    const rating = parseInt(document.getElementById('rev-rating').value);
    const text = document.getElementById('rev-text').value;
    const { data: { session } } = await supabase.auth.getSession();
    
    try {
      const res = await fetch('/api/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: session ? session.user.id : null, name, rating, text, page_number: 1 })
      });
      if (res.ok) {
        window.showToast('Отзыв отправлен на модерацию!', 'success');
        e.target.reset();
      } else { window.showToast('Ошибка отправки', 'error'); }
    } catch (err) { window.showToast('Ошибка сети', 'error'); }
  });
});