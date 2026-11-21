import { supabase } from './supabase-client.js';
import { addToCart, updateCartCount } from './cart.js';
import { toggleFavorite } from './favorites.js';
import { SAMPLE_PRODUCTS } from './catalog-demo-products.js';

const urlParams = new URLSearchParams(window.location.search);
const productId = urlParams.get('id');
const demoId = urlParams.get('demo');
const OIL_COMPOSITION_PROFILES = [
    { match: ['олив', 'olive'], title: 'Оливковое масло', items: ['Олеиновая кислота обычно преобладает; в предоставленном учебном профиле указано около 71%.', 'Также присутствуют линолевая и пальмитиновая кислоты, фитостеролы и токоферолы.'] },
    { match: ['персик', 'peach'], title: 'Персиковое масло', items: ['В профиле обычно указывают олеиновую, линолевую, пальмитиновую и стеариновую кислоты.', 'Состав минорных веществ зависит от сырья и способа обработки.'] },
    { match: ['подсолнеч', 'sunflower'], title: 'Подсолнечное масло', items: ['В обычных сортах часто преобладает линолевая кислота; высокоолеиновые сорта имеют иной профиль.', 'Также встречаются олеиновая, пальмитиновая, стеариновая и другие жирные кислоты; состав зависит от сорта.'] },
    { match: ['миндал', 'almond'], title: 'Миндальное масло', items: ['Обычно преобладает мононенасыщенная олеиновая кислота; значимую долю составляет линолевая.', 'Также присутствуют пальмитиновая кислота и токоферолы.'] },
    { match: ['виноград', 'grape'], title: 'Масло виноградной косточки', items: ['Обычно преобладает линолевая кислота; также присутствуют олеиновая, пальмитиновая и стеариновая.', 'Приведённые в учебном материале значения являются ориентировочными.'] },
    { match: ['авокад', 'avocado'], title: 'Масло авокадо', items: ['Часто преобладает олеиновая кислота; также присутствуют пальмитиновая, линолевая и пальмитолеиновая.', 'Профили масла из мякоти и семени различаются.'] },
    { match: ['жожоб', 'jojoba'], title: 'Масло жожоба', items: ['По составу это преимущественно жидкие восковые эфиры длинноцепочечных жирных кислот и спиртов, а не типичные триацилглицерины.', 'Жожоба обычно используют как косметическое сырьё; проверяйте назначение и маркировку продукта.'] },
    { match: ['какао', 'cocoa'], title: 'Масло какао', items: ['Основные жирные кислоты — стеариновая, олеиновая и пальмитиновая.', 'Соотношение кислот влияет на твёрдость и температуру плавления.'] },
    { match: ['кокос', 'coconut'], title: 'Кокосовое масло', items: ['Содержит значительную долю насыщенных жирных кислот, включая лауриновую и миристиновую.', 'Также присутствуют каприловая, каприновая, пальмитиновая, олеиновая и другие кислоты.'] },
    { match: ['зародыш', 'пшенич', 'wheat germ'], title: 'Масло зародышей пшеницы', items: ['В профиле присутствуют линолевая, олеиновая, пальмитиновая, стеариновая и альфа-линоленовая кислоты.', 'В нерафинированном масле могут сохраняться токоферолы и фосфолипиды.'] },
    { match: ['макадам', 'macadamia'], title: 'Масло макадамии', items: ['Характерны мононенасыщенные олеиновая и пальмитолеиновая кислоты.', 'Также присутствуют линолевая, пальмитиновая и другие жирные кислоты.'] },
    { match: ['грецк', 'walnut'], title: 'Масло грецкого ореха', items: ['Содержит полиненасыщенные линолевую и альфа-линоленовую кислоты, а также олеиновую.', 'Высокая доля полиненасыщенных кислот делает правильное хранение особенно важным.'] },
    { match: ['тыквен', 'pumpkin'], title: 'Тыквенное масло', items: ['В жирнокислотном профиле обычно представлены линолевая и олеиновая кислоты.', 'Также присутствуют пальмитиновая и стеариновая кислоты и минорные компоненты.'] },
    { match: ['облепих', 'sea buckthorn'], title: 'Облепиховое масло', items: ['Состав масла из семян отличается от масла из мякоти плодов.', 'В разных профилях встречаются пальмитолеиновая, олеиновая, линолевая, альфа-линоленовая и пальмитиновая кислоты.'] }
];

function renderOilComposition(product) {
    const name = String(product.name || '').toLocaleLowerCase('ru-RU').normalize('NFD').replace(/\p{Diacritic}/gu, '');
    const profile = OIL_COMPOSITION_PROFILES.find(item => item.match.some(term => name.includes(term)));
    if (!profile) return;

    const section = document.createElement('section');
    section.className = 'product-composition';
    const heading = document.createElement('h2');
    heading.textContent = `Состав: ${profile.title}`;
    const list = document.createElement('ul');
    for (const component of profile.items) {
        const row = document.createElement('li');
        row.textContent = component;
        list.appendChild(row);
    }
    const note = document.createElement('p');
    note.textContent = 'Это справочный профиль вида масла, а не лабораторный анализ конкретной партии. Фактический состав зависит от сорта сырья, происхождения и обработки.';
    section.append(heading, list, note);
    document.querySelector('.specs')?.after(section);
}

async function loadProduct() {
    if (demoId) {
        let catalogState;
        try {
            const { data, error: stateError } = await supabase
                .from('catalog_demo_state')
                .select('retired')
                .eq('id', 1)
                .maybeSingle();
            catalogState = data;
            if (stateError) console.warn('Demo catalog retirement state is unavailable:', stateError.message);
        } catch (stateError) {
            console.warn('Demo catalog retirement state is unavailable:', stateError);
        }
        if (catalogState?.retired === true) {
            showProductNotFound();
            return;
        }
        const demoProduct = SAMPLE_PRODUCTS.find(product => product.id === demoId);
        if (!demoProduct) {
            showProductNotFound();
            return;
        }
        renderProduct(demoProduct, true);
        return;
    }

    const query = supabase.from('products').select('*');
    let product;
    let error;
    try {
        ({ data: product, error } = productId
            ? await query.eq('id', productId).single()
            : await query.limit(1).single());
    } catch (loadError) {
        error = loadError;
    }
    if (error || !product) {
        console.error('Product load failed:', error);
        showProductNotFound();
        return;
    }

    await renderProduct(product);
}

function showProductNotFound() {
    document.getElementById('product-name').textContent = 'Товар не найден';
    document.getElementById('product-desc').textContent = 'Вернитесь в каталог и выберите доступный товар.';
    document.getElementById('add-to-cart-btn').disabled = true;
    document.getElementById('favorite-btn').disabled = true;
}

async function renderProduct(product, isDemo = false) {
    document.getElementById('product-name').textContent = product.name;
    document.getElementById('product-price').textContent = `${new Intl.NumberFormat('ru-RU').format(Number(product.price) || 0)} ₽`;
    document.getElementById('product-desc').textContent = product.description || '';
    document.getElementById('spec-volume').textContent = product.volume || 'Не указан';
    document.getElementById('spec-pressing').textContent = product.pressing_type || 'Не указан';
    document.getElementById('spec-shelf-life').textContent = Number.isSafeInteger(Number(product.shelf_life_months))
        ? `${Number(product.shelf_life_months)} месяцев`
        : 'Не указан';
    document.getElementById('spec-packaging').textContent = product.packaging_type || 'Не указана';
    renderOilComposition(product);

    const demoNote = document.getElementById('demo-product-note');
    const addButton = document.getElementById('add-to-cart-btn');
    const favoriteButton = document.getElementById('favorite-btn');
    if (isDemo) {
        document.querySelector('.product-kicker').textContent = 'ДЕМО-ПРИМЕР · НЕ ПРОДАЁТСЯ';
        demoNote.hidden = false;
        addButton.textContent = 'Только пример';
        addButton.disabled = true;
        addButton.title = 'Демонстрационные товары нельзя заказать';
        favoriteButton.hidden = true;
        document.querySelector('.product-reviews').hidden = true;
    }

    const mainImg = document.getElementById('main-img');
    mainImg.alt = product.name || 'Товар Dr. DarSun';
    const placeholderImage = 'assets/images/product-bottle-placeholder.png';
    mainImg.addEventListener('error', () => {
        if (mainImg.dataset.placeholderApplied) return;
        mainImg.dataset.placeholderApplied = 'true';
        mainImg.src = placeholderImage;
    }, { once: true });
    mainImg.src = product.image_url || placeholderImage;

    if (isDemo) return;

    addButton.addEventListener('click', async () => {
        addButton.disabled = true;
        try {
            await addToCart({
                id: product.id,
                name: product.name,
                price: product.price,
                image: product.image_url || placeholderImage
            });
        } finally {
            addButton.disabled = false;
        }
    });

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
    await initializeProductReviewForm(productId);

    const { data: reviews, error } = await supabase.from('brand_reviews')
        .select('user_name,rating,created_at')
        .eq('product_id', productId)
        .eq('status', 'approved')
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
        card.append(top);
        container.appendChild(card);
    });
}

async function initializeProductReviewForm(productId) {
    const form = document.getElementById('product-review-form');
    const loginLink = document.getElementById('product-review-login-link');
    const nameInput = document.getElementById('product-review-user-name');
    const status = document.getElementById('product-review-status');
    const submitButton = document.getElementById('product-review-submit');
    if (!form || !loginLink || !nameInput || !status || !submitButton) return;

    const { data, error } = await supabase.auth.getSession();
    if (error) {
        console.error('Product review session lookup failed:', error);
        status.textContent = 'Не удалось проверить вход. Обновите страницу и попробуйте снова.';
        return;
    }
    const session = data.session;
    if (!session) {
        loginLink.hidden = false;
        loginLink.href = `login.html?redirect=${encodeURIComponent(window.location.pathname + window.location.search + '#product-reviews')}`;
        return;
    }

    const metadata = session.user?.user_metadata || {};
    nameInput.value = metadata.full_name || metadata.name || session.user?.email?.split('@')[0] || '';
    form.hidden = false;
    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (!form.reportValidity()) return;
        submitButton.disabled = true;
        status.textContent = '';
        try {
            const { data: currentData, error: currentSessionError } = await supabase.auth.getSession();
            if (currentSessionError) throw currentSessionError;
            if (!currentData.session) throw new Error('Войдите в аккаунт, чтобы оставить отзыв.');
            const formData = new FormData(form);
            const response = await fetch('https://drdarsun-site-main.layero.app/api/reviews/submit', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${currentData.session.access_token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    product_id: productId,
                    user_name: nameInput.value,
                    rating: Number(formData.get('rating'))
                })
            });
            const result = await response.json().catch(() => null);
            if (!response.ok) throw new Error(result?.error || 'Не удалось отправить отзыв.');
            const submittedName = nameInput.value;
            form.reset();
            nameInput.value = submittedName;
            status.textContent = 'Спасибо! Отзыв отправлен на проверку и появится после публикации.';
            window.showToast?.('Отзыв отправлен на проверку.', 'success');
        } catch (submitError) {
            status.textContent = submitError.message || 'Не удалось отправить отзыв. Попробуйте позже.';
            window.showToast?.(status.textContent, 'error');
        } finally {
            submitButton.disabled = false;
        }
    }, { once: true });
}

loadProduct();