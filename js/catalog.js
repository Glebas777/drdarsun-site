import { supabase } from './supabase-client.js';

const grid = document.getElementById('product-grid');
const filtersSidebar = document.getElementById('filters-sidebar');
const filtersMobileBtn = document.getElementById('filters-mobile-btn');
const filtersClose = document.getElementById('filters-close');
const priceRange = document.getElementById('price-range');
const priceValue = document.getElementById('price-value');
const sortSelect = document.getElementById('sort-select');

let allProducts = [];
let filteredProducts = [];

// 1. Открытие/закрытие фильтров на мобилке
if (filtersMobileBtn && filtersSidebar) {
    filtersMobileBtn.addEventListener('click', () => filtersSidebar.classList.add('active'));
    filtersClose?.addEventListener('click', () => filtersSidebar.classList.remove('active'));
}

// 2. Ползунок цены
if (priceRange) {
    priceRange.addEventListener('input', () => {
        priceValue.textContent = `${priceRange.value} ₽`;
        applyFilters();
    });
}

// 3. Сортировка
if (sortSelect) {
    sortSelect.addEventListener('change', applyFilters);
}

// 4. Чекбоксы категорий
document.querySelectorAll('.filter-category').forEach(cb => {
    cb.addEventListener('change', applyFilters);
});

// 5. Применение фильтров
function applyFilters() {
    const selectedCategories = Array.from(document.querySelectorAll('.filter-category:checked')).map(cb => cb.value);
    const maxPrice = parseInt(priceRange?.value || 5000);
    const sort = sortSelect?.value || 'default';

    filteredProducts = allProducts.filter(p => {
        const matchesCategory = selectedCategories.includes('all') || selectedCategories.includes(p.category);
        const matchesPrice = p.price <= maxPrice;
        return matchesCategory && matchesPrice;
    });

    if (sort === 'price-asc') filteredProducts.sort((a, b) => a.price - b.price);
    else if (sort === 'price-desc') filteredProducts.sort((a, b) => b.price - a.price);

    renderProducts();
}

// 6. Рендер товаров
function renderProducts() {
    if (!grid) return;

    if (filteredProducts.length === 0) {
        grid.innerHTML = '<div class="empty-state" style="grid-column: 1/-1;">Ничего не найдено.</div>';
        return;
    }

    grid.innerHTML = filteredProducts.map(p => `
        <div class="product-card">
            <div class="product-img" style="background-image: url('${p.image_url || 'assets/images/placeholder.png'}'); background-size: cover; background-position: center; height: 250px; position: relative;">
                ${p.tag ? `<span class="product-tag">${p.tag}</span>` : ''}
                <button class="add-to-cart-btn" data-id="${p.id}" data-name="${p.name}" data-price="${p.price}">В корзину</button>
            </div>
            <div class="product-info">
                <h3>${p.name}</h3>
                <p class="product-desc">${p.description || ''}</p>
                <div class="product-bottom">
                    <span class="product-price">${p.price} ₽</span>
                    <span class="product-weight">${p.weight || ''}</span>
                </div>
            </div>
        </div>
    `).join('');
}

// 7. Загрузка товаров из БД (или заглушка)
async function loadProducts() {
    // Если таблицы products еще нет, используем заглушку
    const products = [
        { id: '1', name: 'Сыродавленное масло', category: 'oil', price: 600, weight: '250 мл', description: 'Классическое. Пахнет семечкой.', tag: 'Хит', image_url: 'assets/images/oil1.jpg' },
        { id: '2', name: 'Масло с чесноком', category: 'oil', price: 650, weight: '250 мл', description: 'Идеально к борщу.', tag: 'New', image_url: 'assets/images/oil2.jpg' },
        { id: '3', name: 'Подарочный набор', category: 'gift', price: 1500, weight: '1 л', description: '3 вида масла + брецель.', tag: 'Сет', image_url: 'assets/images/gift1.jpg' },
    ];

    allProducts = products;
    filteredProducts = [...allProducts];
    renderProducts();
}

loadProducts();