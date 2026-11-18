import { supabase } from './supabase-client.js';
import { addToCart } from './cart.js';

const grid = document.getElementById('product-grid');
const filtersSidebar = document.getElementById('filters-sidebar');
const filtersMobileBtn = document.getElementById('filters-mobile-btn');
const filtersClose = document.getElementById('filters-close');
const filtersBackdrop = document.getElementById('filters-backdrop');
const categoryFilters = document.getElementById('category-filters');
const priceRange = document.getElementById('price-range');
const priceValue = document.getElementById('price-value');
const sortSelect = document.getElementById('sort-select');
const searchInput = document.getElementById('catalog-search');
const resultCount = document.getElementById('catalog-result-count');

let allProducts = [];
let filteredProducts = [];

function setFiltersOpen(open) {
    filtersSidebar?.classList.toggle('active', open);
    filtersBackdrop?.classList.toggle('active', open);
    document.body.classList.toggle('filters-open', open);
    filtersMobileBtn?.setAttribute('aria-expanded', String(open));
}

filtersMobileBtn?.addEventListener('click', () => setFiltersOpen(true));
filtersClose?.addEventListener('click', () => setFiltersOpen(false));
filtersBackdrop?.addEventListener('click', () => setFiltersOpen(false));
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setFiltersOpen(false);
});

function getSelectedCategories() {
    return Array.from(document.querySelectorAll('.filter-category:checked')).map(input => input.value);
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
    card.className = 'product-card';
    card.tabIndex = 0;
    card.setAttribute('aria-label', `Открыть товар: ${product.name}`);
    card.style.setProperty('--card-index', String(index));

    const media = document.createElement('div');
    media.className = 'product-card__img';
    if (product.tag) {
        const tag = document.createElement('span');
        tag.className = 'product-tag';
        tag.textContent = product.tag;
        media.appendChild(tag);
    }

    if (product.image_url) {
        const image = document.createElement('img');
        image.src = product.image_url;
        image.alt = product.name || 'Изображение товара';
        image.loading = 'lazy';
        image.decoding = 'async';
        image.addEventListener('error', () => image.remove(), { once: true });
        media.appendChild(image);
    } else {
        media.classList.add('product-card__img--empty');
        const visual = document.createElement('span');
        visual.className = 'product-card__visual';
        visual.setAttribute('aria-hidden', 'true');
        visual.textContent = 'D';
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
    addButton.textContent = 'В корзину';
    addButton.disabled = !Number.isFinite(numericPrice) || numericPrice < 0;
    if (addButton.disabled) addButton.title = 'Цена товара не указана';
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
        window.location.href = `product.html?id=${encodeURIComponent(product.id)}`;
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

    const { data, error } = await supabase.from('products').select('*');
    if (error) {
        grid.setAttribute('aria-busy', 'false');
        if (resultCount) resultCount.textContent = 'Каталог недоступен';
        grid.replaceChildren();
        const errorState = document.createElement('section');
        errorState.className = 'catalog-no-results';
        const title = document.createElement('h2');
        title.textContent = 'Не удалось загрузить каталог';
        const message = document.createElement('p');
        message.textContent = 'Проверьте соединение и попробуйте ещё раз.';
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'btn btn--primary';
        retry.textContent = 'Попробовать снова';
        retry.addEventListener('click', loadProducts);
        errorState.append(title, message, retry);
        grid.appendChild(errorState);
        console.error('Catalog load error:', error);
        return;
    }

    allProducts = (data || []).filter(product => product && product.id != null);
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

// Каталог подгружается только из базы данных; демо-товары не подставляются.
loadProducts();

// Чат каталога использует тот же серверный endpoint, что и чат на главной.
const botToggle = document.getElementById('catalog-bot-toggle');
const botModal = document.getElementById('catalog-bot-modal');
const botClose = document.getElementById('catalog-bot-close');
const chatMessages = document.getElementById('catalog-chat-messages');
const chatInput = document.getElementById('catalog-chat-input');
const chatSend = document.getElementById('catalog-chat-send');
const chatHistory = [];
let chatBusy = false;

function appendChatMessage(text, sender) {
    const wrapper = document.createElement('div');
    wrapper.className = `msg-wrapper ${sender}`;
    const message = document.createElement('div');
    message.className = 'msg';
    message.textContent = text;
    wrapper.appendChild(message);
    chatMessages.appendChild(wrapper);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return wrapper;
}

function setChatOpen(open) {
    botModal?.classList.toggle('active', open);
    botToggle?.setAttribute('aria-expanded', String(open));
    if (open) chatInput?.focus();
}

botToggle?.addEventListener('click', () => setChatOpen(!botModal.classList.contains('active')));
botClose?.addEventListener('click', () => setChatOpen(false));

async function sendCatalogMessage() {
    const text = chatInput?.value.trim();
    if (!text || chatBusy || !chatMessages || !chatSend) return;

    chatBusy = true;
    chatSend.disabled = true;
    chatInput.value = '';
    appendChatMessage(text, 'user');
    const typing = appendChatMessage('Доктор ДарСан печатает…', 'bot');

    try {
        const response = await fetch('https://drdarsun-site-main.layero.app/api/gigachat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: text, history: chatHistory.slice(-6), context: 'catalog' })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Сервис временно недоступен.');
        if (typeof data.reply !== 'string' || !data.reply.trim()) throw new Error('Не удалось получить ответ.');

        typing.remove();
        appendChatMessage(data.reply.trim(), 'bot');
        chatHistory.push({ role: 'user', content: text }, { role: 'assistant', content: data.reply.trim() });
        if (chatHistory.length > 12) chatHistory.splice(0, chatHistory.length - 12);
    } catch (error) {
        typing.remove();
        appendChatMessage(error.message || 'Не удалось связаться с помощником. Попробуйте позже.', 'bot');
    } finally {
        chatBusy = false;
        chatSend.disabled = false;
        chatInput?.focus();
    }
}

chatSend?.addEventListener('click', sendCatalogMessage);
chatInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendCatalogMessage();
    }
});
