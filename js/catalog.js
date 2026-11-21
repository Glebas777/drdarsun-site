import { supabase } from './supabase-client.js';
import { addToCart, updateCartCount } from './cart.js';
import { getFavoriteIds, toggleFavorite } from './favorites.js';
import { SAMPLE_PRODUCTS } from './catalog-demo-products.js';

const grid = document.getElementById('product-grid');
const filtersSidebar = document.getElementById('filters-sidebar');
const filtersMobileBtn = document.getElementById('filters-mobile-btn');
const filtersClose = document.getElementById('filters-close');
const filtersBackdrop = document.getElementById('filters-backdrop');
const filterReset = document.getElementById('filter-reset');
const categoryFilters = document.getElementById('category-filters');
const priceRange = document.getElementById('price-range');
const priceValue = document.getElementById('price-value');
const sortSelect = document.getElementById('sort-select');
const searchInput = document.getElementById('catalog-search');
const resultCount = document.getElementById('catalog-result-count');
const demoNotice = document.getElementById('catalog-demo-notice');

let allProducts = [];
let filteredProducts = [];
let favoriteUserId = null;
let favoriteIds = new Set();

function setFiltersOpen(open) {
    filtersSidebar?.classList.toggle('active', open);
    filtersBackdrop?.classList.toggle('active', open);
    document.body.classList.toggle('filters-open', open);
    filtersMobileBtn?.setAttribute('aria-expanded', String(open));
}

filtersMobileBtn?.addEventListener('click', () => setFiltersOpen(true));
filtersClose?.addEventListener('click', () => setFiltersOpen(false));
filtersBackdrop?.addEventListener('click', () => setFiltersOpen(false));
filterReset?.addEventListener('click', resetFilters);
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setFiltersOpen(false);
});

function getSelectedCategories() {
    const selected = Array.from(document.querySelectorAll('.filter-category:checked')).map(input => input.value);
    return selected.includes('all') ? [] : selected;
}

function applyFilters() {
    const selectedCategories = getSelectedCategories();
    const maxPrice = Number(priceRange?.value ?? Number.MAX_SAFE_INTEGER);
    const query = searchInput?.value.trim().toLocaleLowerCase('ru-RU') ?? '';
    const sort = sortSelect?.value ?? 'default';

    filteredProducts = allProducts.filter((product) => {
        const category = String(product.category ?? '').trim();
        const matchesCategory = selectedCategories.length === 0 || selectedCategories.includes(category);
        const matchesPrice = Number(product.price) <= maxPrice;
        const searchableText = `${product.name ?? ''} ${product.description ?? ''} ${product.category ?? ''}`
            .toLocaleLowerCase('ru-RU');
        return matchesCategory && matchesPrice && (!query || searchableText.includes(query));
    });

    if (sort === 'price-asc') filteredProducts.sort((a, b) => Number(a.price) - Number(b.price));
    if (sort === 'price-desc') filteredProducts.sort((a, b) => Number(b.price) - Number(a.price));
    renderProducts();
}

function createProductCard(product, index) {
    const card = document.createElement('article');
    card.className = product.isDemo ? 'product-card product-card--demo' : 'product-card';
    card.tabIndex = 0;
    card.setAttribute('role', 'link');
    card.setAttribute('aria-label', product.isDemo ? `Открыть пример товара: ${product.name}` : `Открыть товар: ${product.name}`);
    card.style.setProperty('--card-index', String(index));

    const media = document.createElement('div');
    media.className = 'product-card__img';
    if (product.tag || product.isDemo) {
        const tag = document.createElement('span');
        tag.className = 'product-tag';
        tag.textContent = product.isDemo ? 'ПРИМЕР' : product.tag;
        media.appendChild(tag);
    }

    const favoriteButton = document.createElement('button');
    favoriteButton.className = 'favorite-toggle';
    favoriteButton.type = 'button';
    favoriteButton.disabled = Boolean(product.isDemo);
    if (product.isDemo) favoriteButton.title = 'Примеры нельзя добавить в избранное';
    favoriteButton.setAttribute('aria-label', product.isDemo
        ? 'Избранное недоступно для примеров'
        : favoriteIds.has(String(product.id)) ? 'Убрать из избранного' : 'Добавить в избранное');
    favoriteButton.setAttribute('aria-pressed', String(favoriteIds.has(String(product.id))));
    favoriteButton.classList.toggle('is-favorite', favoriteIds.has(String(product.id)));
    favoriteButton.textContent = favoriteIds.has(String(product.id)) ? '♥' : '♡';
    favoriteButton.addEventListener('click', async (event) => {
        event.stopPropagation();
        if (!favoriteUserId) {
            window.showToast?.('Войдите в аккаунт, чтобы сохранять избранное.', 'error');
            window.location.href = `login.html?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`;
            return;
        }
        favoriteButton.disabled = true;
        try {
            const isFavorite = await toggleFavorite(favoriteUserId, product.id);
            favoriteButton.classList.toggle('is-favorite', isFavorite);
            favoriteButton.setAttribute('aria-pressed', String(isFavorite));
            favoriteButton.setAttribute('aria-label', isFavorite ? 'Убрать из избранного' : 'Добавить в избранное');
            favoriteButton.textContent = isFavorite ? '♥' : '♡';
        } catch (error) {
            console.error('Favorite toggle failed:', error);
            window.showToast?.('Не удалось изменить избранное. Проверьте подключение.', 'error');
        } finally {
            favoriteButton.disabled = false;
        }
    });
    media.appendChild(favoriteButton);

    if (product.image_url) {
        const image = document.createElement('img');
        image.src = product.image_url;
        image.alt = product.name || 'Изображение товара';
        image.loading = 'lazy';
        image.decoding = 'async';
        image.addEventListener('error', () => {
            image.className = 'product-card__placeholder';
            image.alt = '';
            image.src = 'assets/images/product-bottle-placeholder.png';
        }, { once: true });
        media.appendChild(image);
    } else {
        media.classList.add('product-card__img--empty');
        const visual = document.createElement('img');
        visual.className = 'product-card__placeholder';
        visual.src = 'assets/images/product-bottle-placeholder.png';
        visual.alt = '';
        visual.loading = 'lazy';
        media.appendChild(visual);
    }

    const info = document.createElement('div');
    info.className = 'product-card__info';

    const category = document.createElement('span');
    category.className = 'product-card__category';
    category.textContent = product.category || 'Dr. DarSun';

    const title = document.createElement('h2');
    title.textContent = product.name || 'Товар';

    const description = document.createElement('p');
    description.className = 'product-card__description';
    description.textContent = product.description || '';

    const footer = document.createElement('div');
    footer.className = 'product-card__footer';

    const price = document.createElement('strong');
    const numericPrice = Number(product.price);
    price.className = 'product-card__price';
    price.textContent = Number.isFinite(numericPrice)
        ? `${new Intl.NumberFormat('ru-RU').format(numericPrice)} ₽`
        : 'Цена уточняется';

    const addButton = document.createElement('button');
    addButton.className = 'add-to-cart-btn';
    addButton.type = 'button';
    addButton.textContent = product.isDemo ? 'Пример' : 'В корзину';
    addButton.disabled = !Number.isFinite(numericPrice) || numericPrice < 0;
    if (product.isDemo) {
        addButton.disabled = true;
        addButton.title = 'Это пример карточки, заказ недоступен';
    } else if (addButton.disabled) {
        addButton.title = 'Цена товара не указана';
    }
    addButton.addEventListener('click', async (event) => {
        event.stopPropagation();
        await addToCart({
            id: product.id,
            name: product.name,
            price: numericPrice,
            image: product.image_url
        });
    });

    footer.append(price, addButton);
    info.append(category, title);
    if (product.description) info.appendChild(description);
    info.appendChild(footer);
    card.append(media, info);

    const openProduct = () => {
        const parameter = product.isDemo ? `demo=${encodeURIComponent(product.id)}` : `id=${encodeURIComponent(product.id)}`;
        window.location.href = `product.html?${parameter}`;
    };
    card.addEventListener('click', openProduct);
    card.addEventListener('keydown', (event) => {
        if (event.target === card && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            openProduct();
        }
    });

    return card;
}

function renderProducts() {
    if (!grid) return;
    grid.replaceChildren();
    grid.setAttribute('aria-busy', 'false');

    if (resultCount) {
        resultCount.textContent = `${filteredProducts.length} ${getProductWord(filteredProducts.length)}`;
    }

    if (allProducts.length === 0) {
        grid.setAttribute('aria-busy', 'false');
        const empty = document.createElement('section');
        empty.className = 'catalog-empty';
        empty.innerHTML = `
            <span class="catalog-empty__mark" aria-hidden="true">D</span>
            <p class="eyebrow">МАГАЗИН DR. DARSUN</p>
            <h2>Каталог пополняется</h2>
            <p>Сейчас товаров нет. Когда они появятся в каталоге, здесь будет их полный ассортимент.</p>
            <a class="btn btn--primary" href="about.html">Узнать о нас</a>
        `;
        grid.appendChild(empty);
        return;
    }

    if (filteredProducts.length === 0) {
        grid.setAttribute('aria-busy', 'false');
        const empty = document.createElement('section');
        empty.className = 'catalog-no-results';
        const title = document.createElement('h2');
        title.textContent = 'Ничего не найдено';
        const message = document.createElement('p');
        message.textContent = 'Измените запрос или сбросьте фильтры, чтобы увидеть товары.';
        const reset = document.createElement('button');
        reset.className = 'btn btn--primary';
        reset.type = 'button';
        reset.textContent = 'Сбросить фильтры';
        reset.addEventListener('click', resetFilters);
        empty.append(title, message, reset);
        grid.appendChild(empty);
        return;
    }

    const cards = filteredProducts.map(createProductCard);
    grid.append(...cards);
    grid.setAttribute('aria-busy', 'false');
}

function getProductWord(count) {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11) return 'товар';
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'товара';
    return 'товаров';
}

function resetFilters() {
    if (searchInput) searchInput.value = '';
    if (sortSelect) sortSelect.value = 'default';
    document.querySelectorAll('.filter-category').forEach(input => {
        input.checked = input.value === 'all';
    });
    if (priceRange) priceRange.value = priceRange.max;
    if (priceValue) priceValue.textContent = `${new Intl.NumberFormat('ru-RU').format(Number(priceRange?.value || 0))} ₽`;
    applyFilters();
}

function renderCategories(products) {
    if (!categoryFilters) return;
    const categories = [...new Set(products.map(product => String(product.category ?? '').trim()).filter(Boolean))];
    categoryFilters.replaceChildren();

    const allLabel = document.createElement('label');
    const allInput = document.createElement('input');
    allInput.type = 'checkbox';
    allInput.className = 'filter-category';
    allInput.value = 'all';
    allInput.checked = true;
    allLabel.append(allInput, document.createTextNode('Все товары'));
    categoryFilters.appendChild(allLabel);

    categories.forEach((category) => {
        const label = document.createElement('label');
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.className = 'filter-category';
        input.value = category;
        label.append(input, document.createTextNode(category));
        categoryFilters.appendChild(label);
    });

    if (categoryFilters.dataset.listenerAttached !== 'true') {
        categoryFilters.dataset.listenerAttached = 'true';
        categoryFilters.addEventListener('change', (event) => {
            const changedInput = event.target;
            if (!(changedInput instanceof HTMLInputElement)) return;
            const allInput = categoryFilters.querySelector('[value="all"]');
            if (changedInput.value === 'all' && changedInput.checked) {
                categoryFilters.querySelectorAll('.filter-category:not([value="all"])').forEach(input => {
                    input.checked = false;
                });
            } else if (changedInput.value !== 'all' && changedInput.checked) {
                allInput.checked = false;
            } else if (!categoryFilters.querySelector('.filter-category:checked')) {
                allInput.checked = true;
            }
            applyFilters();
        });
    }
}

priceRange?.addEventListener('input', () => {
    if (priceValue) {
        priceValue.textContent = `${new Intl.NumberFormat('ru-RU').format(Number(priceRange.value))} ₽`;
    }
    applyFilters();
});
sortSelect?.addEventListener('change', applyFilters);
searchInput?.addEventListener('input', applyFilters);

async function loadProducts() {
    if (!grid) return;
    grid.setAttribute('aria-busy', 'true');
    grid.innerHTML = '<div class="catalog-loading" aria-label="Загрузка каталога"><span></span><span></span><span></span></div>';

    let data;
    let error;
    try {
        ({ data, error } = await supabase.from('products').select('*'));
    } catch (loadError) {
        error = loadError;
    }

    const realProducts = (data || []).filter(product => product && product.id != null);
    let demosRetired = realProducts.length > 0;
    try {
        const { data: catalogState, error: stateError } = await supabase
            .from('catalog_demo_state')
            .select('retired')
            .eq('id', 1)
            .maybeSingle();
        if (stateError) {
            console.warn('Demo catalog retirement state is unavailable:', stateError.message);
        } else {
            demosRetired = catalogState?.retired === true || demosRetired;
        }
    } catch (stateError) {
        console.warn('Demo catalog retirement state is unavailable:', stateError);
    }
    const usingDemoProducts = !demosRetired && (Boolean(error) || realProducts.length === 0);
    allProducts = demosRetired ? realProducts : [...realProducts, ...SAMPLE_PRODUCTS];
    if (demoNotice) {
        demoNotice.hidden = demosRetired;
        demoNotice.textContent = demosRetired
            ? ''
            : error
                ? 'Не удалось загрузить реальные товары. Ниже показаны 3 демо-примера; они не продаются.'
                : usingDemoProducts
                    ? 'Реальные товары пока не опубликованы. Ниже показаны 3 демо-примера; они не продаются.'
                    : 'Внизу каталога — 3 демо-примера. Они нужны для показа оформления и недоступны для заказа.';
    }
    if (error) console.error('Catalog load error:', error);

    favoriteUserId = null;
    favoriteIds = new Set();
    try {
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) {
            console.error('Favorite session lookup failed:', sessionError);
        } else if (!usingDemoProducts && sessionData.session) {
            favoriteUserId = sessionData.session.user.id;
            try {
                favoriteIds = await getFavoriteIds(favoriteUserId);
            } catch (error) {
                console.error('Favorite list load failed:', error);
            }
        }
    } catch (error) {
        console.error('Favorite session lookup failed:', error);
    }
    const maxPrice = Math.max(1000, ...allProducts.map(product => Number(product.price)).filter(Number.isFinite));
    if (priceRange) {
        priceRange.max = String(Math.ceil(maxPrice / 100) * 100);
        priceRange.value = priceRange.max;
    }
    if (priceValue) {
        priceValue.textContent = `${new Intl.NumberFormat('ru-RU').format(Number(priceRange?.value || 0))} ₽`;
    }
    renderCategories(allProducts);
    applyFilters();
}

// Demo products remain visible only until the first real product is published.
loadProducts();
updateCartCount();
