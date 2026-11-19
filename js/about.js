import { supabase } from './supabase-client.js';

const reviewBook = document.getElementById('review-book');
const previousBookButton = document.getElementById('review-book-prev');
const nextBookButton = document.getElementById('review-book-next');
const bookPageStatus = document.getElementById('review-book-page-status');
const reviewList = document.getElementById('brand-review-list');
const moderationSection = document.getElementById('review-moderation');
const moderationList = document.getElementById('review-moderation-list');
const REVIEWS_API = 'https://drdarsun-site-main.layero.app/api/reviews';

let currentSession = null;
let moderationRequest = false;

function isPageSwipeSurface(target) {
    if (!(target instanceof Element) || !target.closest('.review-book__page')) return false;
    return !target.closest([
        'a', 'button', 'input', 'select', 'textarea', 'label', 'img', 'video', 'audio',
        '[contenteditable="true"]', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'span', 'strong', 'em', 'small', 'time', '.review-entry', '.review-moderation-item'
    ].join(','));
}

function initializeBook() {
    if (!reviewBook) return;
    const pages = Array.from(reviewBook.querySelectorAll('.review-book__page'));
    const pageNames = ['Обложка', 'О книге', 'Вступление', 'Отзывы читателей', 'Послесловие', 'Задняя обложка'];

    const PageFlip = window.St?.PageFlip;
    if (!PageFlip) {
        let currentPage = 0;
        const showFallbackPage = index => {
            currentPage = Math.max(0, Math.min(index, pages.length - 1));
            pages.forEach((page, pageIndex) => { page.hidden = pageIndex !== currentPage; });
            previousBookButton.disabled = currentPage === 0;
            nextBookButton.disabled = currentPage === pages.length - 1;
            bookPageStatus.textContent = pageNames[currentPage] || `Страница ${currentPage + 1}`;
        };
        let fallbackPointerStart = null;
        reviewBook.addEventListener('pointerdown', event => {
            if (!isPageSwipeSurface(event.target)) return;
            if (event.pointerType === 'mouse' || event.button !== 0 || !event.isPrimary) return;
            fallbackPointerStart = { id: event.pointerId, x: event.clientX, y: event.clientY };
        }, true);
        document.addEventListener('pointerup', event => {
            if (!fallbackPointerStart || event.pointerId !== fallbackPointerStart.id) return;
            const deltaX = event.clientX - fallbackPointerStart.x;
            const deltaY = event.clientY - fallbackPointerStart.y;
            fallbackPointerStart = null;
            if (Math.abs(deltaX) < 48 || Math.abs(deltaX) < Math.abs(deltaY) * 1.25) return;
            showFallbackPage(currentPage + (deltaX < 0 ? 1 : -1));
        });
        document.addEventListener('pointercancel', () => { fallbackPointerStart = null; });
        previousBookButton?.addEventListener('click', () => showFallbackPage(currentPage - 1));
        nextBookButton?.addEventListener('click', () => showFallbackPage(currentPage + 1));
        showFallbackPage(0);
        return;
    }

    const pageFlip = new PageFlip(reviewBook, {
        width: 420,
        height: 560,
        size: 'stretch',
        minWidth: 280,
        maxWidth: 420,
        minHeight: 420,
        maxHeight: 590,
        autoSize: false,
        showCover: true,
        usePortrait: true,
        useMouseEvents: false,
        mobileScrollSupport: false,
        drawShadow: true,
        maxShadowOpacity: 0.38,
        flippingTime: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 450 : 850,
        startPage: 0,
        disableFlipByClick: true
    });
    let previousPage = 0;

    function updateBookControls() {
        const pageIndex = pageFlip.getCurrentPageIndex();
        const orientation = pageFlip.getOrientation();
        const spreadSize = orientation === 'landscape' && pageIndex > 0 ? 2 : 1;
        const visibleNames = pages.slice(pageIndex, pageIndex + spreadSize).map((_, index) => pageNames[pageIndex + index]);
        previousBookButton.disabled = pageIndex === 0;
        nextBookButton.disabled = pageIndex >= pages.length - 1;
        bookPageStatus.textContent = visibleNames.join(' · ') || pageNames[pageIndex] || `Страница ${pageIndex + 1}`;
    }

    pageFlip.on('flip', () => {
        updateBookControls();
        const pageIndex = pageFlip.getCurrentPageIndex();
        if (pageIndex === 0 && previousPage > 0) {
            reviewBook.classList.remove('is-closing');
            void reviewBook.offsetWidth;
            reviewBook.classList.add('is-closing');
        }
        previousPage = pageIndex;
    });
    pageFlip.on('changeOrientation', updateBookControls);
    pageFlip.on('init', updateBookControls);
    let pointerStart = null;
    reviewBook.addEventListener('pointerdown', event => {
        if (!isPageSwipeSurface(event.target)) return;
        if (event.pointerType === 'mouse' || event.button !== 0 || !event.isPrimary) return;
        pointerStart = { id: event.pointerId, x: event.clientX, y: event.clientY };
    }, true);
    document.addEventListener('pointerup', event => {
        if (!pointerStart || event.pointerId !== pointerStart.id) return;
        const deltaX = event.clientX - pointerStart.x;
        const deltaY = event.clientY - pointerStart.y;
        pointerStart = null;
        if (Math.abs(deltaX) < 48 || Math.abs(deltaX) < Math.abs(deltaY) * 1.25) return;
        if (deltaX < 0) pageFlip.flipNext();
        else pageFlip.flipPrev();
    });
    document.addEventListener('pointercancel', () => { pointerStart = null; });
    pageFlip.loadFromHTML(pages);
    previousBookButton?.addEventListener('click', () => pageFlip.flipPrev());
    nextBookButton?.addEventListener('click', () => pageFlip.flipNext());
    reviewBook.addEventListener('animationend', event => {
        if (event.animationName === 'review-book-close-spin') reviewBook.classList.remove('is-closing');
    });
    updateBookControls();
}

function createReviewCard(review, { moderation = false } = {}) {
    const card = document.createElement('article');
    card.className = moderation ? 'review-moderation-item' : 'review-entry';

    const top = document.createElement('div');
    top.className = 'review-entry__top';
    const name = document.createElement('strong');
    name.className = 'review-entry__name';
    name.textContent = review.user_name || 'Покупатель Dr. DarSun';
    const rating = document.createElement('span');
    rating.className = 'review-entry__rating';
    rating.setAttribute('aria-label', `Оценка: ${review.rating} из 5`);
    rating.textContent = `${'★'.repeat(review.rating)}${'☆'.repeat(5 - review.rating)}`;
    top.append(name, rating);

    const text = document.createElement('p');
    text.textContent = review.review_text;
    card.append(top, text);

    if (!moderation) {
        const date = document.createElement('time');
        date.className = 'review-entry__date';
        date.dateTime = review.created_at;
        date.textContent = new Date(review.created_at).toLocaleDateString('ru-RU', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
        card.appendChild(date);
    }

    if (moderation) {
        const actions = document.createElement('div');
        actions.className = 'review-moderation-item__actions';
        for (const [status, label] of [['approved', 'Опубликовать'], ['rejected', 'Отклонить']]) {
            const button = document.createElement('button');
            button.className = status === 'approved' ? 'btn btn--primary' : 'btn review-delete-btn';
            button.type = 'button';
            button.textContent = label;
            button.addEventListener('click', () => moderateReview(review.id, status, button));
            actions.appendChild(button);
        }
        card.appendChild(actions);
    }
    return card;
}

async function loadPublishedReviews() {
    const { data, error } = await supabase
        .from('brand_reviews')
        .select('id,user_id,user_name,rating,review_text,created_at')
        .eq('status', 'approved')
        .order('created_at', { ascending: false })
        .limit(30);
    if (error) throw error;

    reviewList.replaceChildren();
    if (!data?.length) {
        const empty = document.createElement('p');
        empty.className = 'review-form-card__hint';
        empty.textContent = 'Здесь появятся первые опубликованные истории.';
        reviewList.appendChild(empty);
        return;
    }
    reviewList.append(...data.map(review => createReviewCard(review)));
}

async function loadModerationQueue() {
    if (!currentSession || moderationRequest) return;
    moderationRequest = true;
    try {
        const response = await fetch(`${REVIEWS_API}/moderation`, {
            headers: { Authorization: `Bearer ${currentSession.access_token}` },
            cache: 'no-store'
        });
        if (response.status === 401 || response.status === 403 || response.status === 503) return;
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Не удалось загрузить очередь модерации.');
        moderationSection.hidden = false;
        moderationList.className = 'review-moderation-list';
        moderationList.replaceChildren();
        if (!result.reviews.length) {
            const empty = document.createElement('p');
            empty.className = 'review-form-card__hint';
            empty.textContent = 'Новых отзывов на проверку нет.';
            moderationList.appendChild(empty);
            return;
        }
        moderationList.append(...result.reviews.map(review => createReviewCard(review, { moderation: true })));
    } catch (error) {
        console.error('Review moderation queue failed:', error);
    } finally {
        moderationRequest = false;
    }
}

async function moderateReview(id, status, button) {
    button.disabled = true;
    try {
        const response = await fetch(`${REVIEWS_API}/moderation/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            headers: {
                Authorization: `Bearer ${currentSession.access_token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ status })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Не удалось сохранить решение.');
        await Promise.all([loadPublishedReviews(), loadModerationQueue()]);
    } catch (error) {
        button.disabled = false;
        window.showToast?.(error.message || 'Ошибка модерации.', 'error');
    }
}

async function initializeReviews() {
    try {
        const sessionResult = await supabase.auth.getSession();
        if (sessionResult.error) throw sessionResult.error;
        currentSession = sessionResult.data.session;
        await loadPublishedReviews();
        await loadModerationQueue();
    } catch (error) {
        const message = document.createElement('p');
        message.className = 'review-form-card__hint';
        message.textContent = 'Не удалось загрузить книгу отзывов. Обновите страницу через минуту.';
        reviewList.replaceChildren(message);
        console.error('Brand reviews initialization failed:', error);
    }
}

initializeBook();
initializeReviews();
