import { supabase } from './supabase-client.js';
import { addToCart, updateCartCount } from './cart.js';
import { toggleFavorite } from './favorites.js';

const urlParams = new URLSearchParams(window.location.search);
const productId = urlParams.get('id');

async function loadProduct() {
    const query = supabase.from('products').select('*');
    const { data: product, error } = productId
        ? await query.eq('id', productId).single()
        : await query.limit(1).single();
    if (error || !product) {
        console.error('Product load failed:', error);
        document.getElementById('product-name').textContent = 'Товар не найден';
        document.getElementById('product-desc').textContent = 'Вернитесь в каталог и выберите доступный товар.';
        document.getElementById('add-to-cart-btn').disabled = true;
        return;
    }

    document.getElementById('product-name').textContent = product.name;
    document.getElementById('product-price').textContent = `${new Intl.NumberFormat('ru-RU').format(Number(product.price) || 0)} ₽`;
    document.getElementById('product-desc').textContent = product.description || '';
    document.getElementById('spec-volume').textContent = product.volume || 'Не указан';
    
    // Картинки (с заглушкой для п.5)
    const mainImg = document.getElementById('main-img');
    mainImg.src = product.image_url || 'assets/images/logo.png';
    mainImg.alt = product.name || 'Товар Dr. DarSun';

    document.getElementById('add-to-cart-btn').addEventListener('click', () => {
        addToCart({
            id: product.id,
            name: product.name,
            price: product.price,
            image: product.image_url
        });
    });

    const favoriteButton = document.getElementById('favorite-btn');
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) {
        console.error('Favorite session lookup failed:', sessionError);
    } else if (sessionData.session) {
        const userId = sessionData.session.user.id;
        const { data: favorite, error: favoriteError } = await supabase
            .from('favorites')
            .select('product_id')
            .eq('user_id', userId)
            .eq('product_id', String(product.id))
            .maybeSingle();
        if (favoriteError) console.error('Favorite lookup failed:', favoriteError);
        const updateFavoriteButton = (isFavorite) => {
            favoriteButton.classList.toggle('is-favorite', isFavorite);
            favoriteButton.setAttribute('aria-pressed', String(isFavorite));
            favoriteButton.setAttribute('aria-label', isFavorite ? 'Убрать из избранного' : 'Добавить в избранное');
            favoriteButton.textContent = isFavorite ? '♥' : '♡';
        };
        updateFavoriteButton(Boolean(favorite));
        favoriteButton.addEventListener('click', async () => {
            favoriteButton.disabled = true;
            try {
                updateFavoriteButton(await toggleFavorite(userId, product.id));
            } catch (favoriteToggleError) {
                console.error('Favorite toggle failed:', favoriteToggleError);
                window.showToast?.('Не удалось изменить избранное. Проверьте подключение.', 'error');
            } finally {
                favoriteButton.disabled = false;
            }
        });
    } else {
        favoriteButton.addEventListener('click', () => {
            window.showToast?.('Войдите в аккаунт, чтобы сохранять избранное.', 'error');
            window.location.href = `login.html?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`;
        });
    }

    await loadReviews(product.id);
    
    updateCartCount();
}

async function loadReviews(productId) {
    const container = document.getElementById('reviews-list');
    if (!container) return;

    const { data: reviews, error } = await supabase.from('reviews')
        .select('user_name,rating,text,created_at')
        .eq('product_id', productId)
        .order('created_at', { ascending: false })
        .limit(30);
    container.replaceChildren();
    if (error) {
        console.error('Product reviews load failed:', error);
        const unavailable = document.createElement('p');
        unavailable.className = 'product-reviews__empty';
        unavailable.textContent = 'Отзывы временно недоступны.';
        container.appendChild(unavailable);
        return;
    }

    if (!reviews?.length) {
        const empty = document.createElement('p');
        empty.className = 'product-reviews__empty';
        empty.textContent = 'Пока нет отзывов о товаре.';
        container.appendChild(empty);
        return;
    }

    reviews.forEach(review => {
        const card = document.createElement('article');
        card.className = 'product-review';
        const top = document.createElement('div');
        top.className = 'product-review__top';
        const name = document.createElement('strong');
        name.className = 'product-review__name';
        name.textContent = review.user_name || 'Покупатель';
        const rating = Number(review.rating);
        const stars = document.createElement('span');
        stars.className = 'product-review__rating';
        stars.textContent = Number.isInteger(rating) && rating >= 1 && rating <= 5
            ? `${'★'.repeat(rating)}${'☆'.repeat(5 - rating)}`
            : '';
        top.append(name, stars);
        const text = document.createElement('p');
        text.textContent = review.text || '';
        card.append(top, text);
        container.appendChild(card);
    });
}

loadProduct();