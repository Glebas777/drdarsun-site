import { supabase } from './supabase-client.js';

const reviewBook = document.getElementById('review-book');
const openBookButton = document.getElementById('review-book-open');
const reviewForm = document.getElementById('review-form');
const reviewList = document.getElementById('brand-review-list');
const authHint = document.getElementById('review-auth-hint');
const loginLink = document.getElementById('review-login-link');
const ownerStatus = document.getElementById('review-owner-status');
const saveButton = document.getElementById('review-save');
const deleteButton = document.getElementById('review-delete');
const moderationSection = document.getElementById('review-moderation');
const moderationList = document.getElementById('review-moderation-list');
const REVIEWS_API = 'https://drdarsun-site-main.layero.app/api/reviews';

let currentSession = null;
let ownReview = null;
let moderationRequest = false;
let pageFlip = null;

function updateBookControls() {
    if (!pageFlip) return;
    const index = pageFlip.getCurrentPageIndex();
    const count = pageFlip.getPageCount();
    const prev = document.getElementById('review-book-prev');
    const next = document.getElementById('review-book-next');
    const status = document.getElementById('review-book-page-status');

    prev.disabled = index <= 0;
    next.disabled = index >= count - 1;
    status.textContent = index === 0
        ? 'Обложка'
        : index === count - 1
            ? 'Конец книги'
            : `Страница ${index} из ${count - 2}`;
    openBookButton.setAttribute('aria-expanded', String(index > 0 && index < count - 1));
}

function initializeBook() {
    const PageFlip = window.St?.PageFlip;
    if (!PageFlip || !reviewBook) {
        reviewBook.classList.add('review-book--fallback');
        return;
    }

    pageFlip = new PageFlip(reviewBook, {
        width: 440,
        height: 610,
        size: 'stretch',
        minWidth: 280,
        maxWidth: 520,
        minHeight: 420,
        maxHeight: 680,
        drawShadow: true,
        flippingTime: 900,
        usePortrait: true,
        startPage: 0,
        startZIndex: 10,
        autoSize: true,
        maxShadowOpacity: 0.36,
        showCover: true,
        mobileScrollSupport: false,
        swipeDistance: 28,
        clickEventForward: true,
        useMouseEvents: true
    });
    pageFlip.loadFromHTML(reviewBook.querySelectorAll('.review-book__page'));
    pageFlip.on('flip', updateBookControls);
    pageFlip.on('init', updateBookControls);

    openBookButton?.addEventListener('click', () => pageFlip.flipNext());
    document.getElementById('review-book-prev')?.addEventListener('click', () => pageFlip.flipPrev());
    document.getElementById('review-book-next')?.addEventListener('click', () => pageFlip.flipNext());
    reviewBook.addEventListener('pointerdown', event => {
        if (event.target.closest('button, input, select, textarea, a, label')) event.stopPropagation();
    }, true);
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
        empty.textContent = 'Книга пока ждёт первых историй. Вы можете написать свою.';
        reviewList.appendChild(empty);
        return;
    }
    reviewList.append(...data.map(review => createReviewCard(review)));
}

async function loadOwnReview() {
    const { data, error } = await supabase
        .from('brand_reviews')
        .select('id,user_id,user_name,rating,review_text,created_at,status')
        .eq('user_id', currentSession.user.id)
        .maybeSingle();
    if (error) throw error;

    ownReview = data;
    reviewForm.hidden = false;
    loginLink.hidden = true;
    authHint.textContent = 'Один аккаунт может оставить только один отзыв. После изменений отзыв снова уйдёт на проверку.';
    reviewForm.elements.namedItem('review-text').value = ownReview?.review_text || '';
    document.getElementById('review-rating').value = String(ownReview?.rating || 5);
    document.getElementById('review-form-title').textContent = ownReview ? 'Ваша страница' : 'Ваша история';
    saveButton.textContent = ownReview ? 'Сохранить и отправить на проверку' : 'Отправить на модерацию';
    deleteButton.hidden = !ownReview;
    ownerStatus.textContent = ownReview
        ? `Ваш отзыв: ${ownReview.status === 'approved' ? 'опубликован' : ownReview.status === 'rejected' ? 'отклонён — его можно изменить и отправить снова' : 'ожидает решения модератора'}.`
        : 'Отправим отзыв на модерацию от имени вашего аккаунта.';
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

reviewForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!currentSession) return;
    saveButton.disabled = true;

    const payload = {
        user_name: (currentSession.user.user_metadata?.full_name || currentSession.user.email?.split('@')[0] || 'Покупатель').trim().slice(0, 80),
        rating: Number(document.getElementById('review-rating').value),
        review_text: reviewForm.elements.namedItem('review-text').value.trim()
    };
    try {
        const result = ownReview
            ? await supabase.from('brand_reviews').update(payload).eq('id', ownReview.id).eq('user_id', currentSession.user.id)
            : await supabase.from('brand_reviews').insert({ ...payload, user_id: currentSession.user.id });

        if (result.error) {
            window.showToast?.(
                result.error.code === '23505'
                    ? 'У вас уже есть отзыв. Его можно изменить ниже.'
                    : `Не удалось сохранить отзыв: ${result.error.message}`,
                'error'
            );
            return;
        }
        window.showToast?.('Отзыв отправлен на модерацию.');
        await Promise.all([loadOwnReview(), loadPublishedReviews()]);
    } catch (error) {
        console.error('Brand review save failed:', error);
        window.showToast?.('Не удалось сохранить отзыв. Проверьте соединение и попробуйте ещё раз.', 'error');
    } finally {
        saveButton.disabled = false;
    }
});

deleteButton?.addEventListener('click', async () => {
    if (!ownReview || !confirm('Удалить ваш отзыв? Это действие нельзя отменить.')) return;
    deleteButton.disabled = true;
    try {
        const { error } = await supabase.from('brand_reviews').delete()
            .eq('id', ownReview.id)
            .eq('user_id', currentSession.user.id);
        if (error) {
            window.showToast?.(`Не удалось удалить отзыв: ${error.message}`, 'error');
            return;
        }
        ownReview = null;
        reviewForm.reset();
        window.showToast?.('Отзыв удалён. Теперь можно написать новый.');
        await Promise.all([loadOwnReview(), loadPublishedReviews()]);
    } catch (error) {
        console.error('Brand review delete failed:', error);
        window.showToast?.('Не удалось удалить отзыв. Проверьте соединение.', 'error');
    } finally {
        deleteButton.disabled = false;
    }
});

async function initializeReviews() {
    try {
        const [sessionResult] = await Promise.all([
            supabase.auth.getSession(),
            loadPublishedReviews()
        ]);
        if (sessionResult.error) throw sessionResult.error;
        currentSession = sessionResult.data.session;
        if (!currentSession) {
            authHint.textContent = 'Отзывы доступны всем, а написать, изменить или удалить свой может только авторизованный пользователь.';
            loginLink.hidden = false;
            return;
        }
        await loadOwnReview();
        await loadModerationQueue();
    } catch (error) {
        const message = document.createElement('p');
        message.className = 'review-form-card__hint';
        message.textContent = 'Не удалось загрузить книгу отзывов. Обновите страницу через минуту.';
        reviewList.replaceChildren(message);
        authHint.textContent = 'Раздел отзывов временно недоступен.';
        console.error('Brand reviews initialization failed:', error);
    }
}

initializeBook();
initializeReviews();
