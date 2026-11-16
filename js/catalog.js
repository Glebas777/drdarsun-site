import { supabase } from './supabase-client.js';
import { addToCart } from './cart.js';

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
    cb.addEventListener('change', (e) => {
        if (e.target.value === 'all' && e.target.checked) {
            document.querySelectorAll('.filter-category').forEach(other => {
                if (other.value !== 'all') other.checked = false;
            });
        } else if (e.target.value !== 'all' && e.target.checked) {
            document.querySelector('input[value="all"]').checked = false;
        }
        applyFilters();
    });
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

// 6. Рендер товаров (исправленный)
function renderProducts() {
    if (!grid) return;

    if (filteredProducts.length === 0) {
        grid.innerHTML = '<div class="empty-state" style="grid-column: 1/-1;">Ничего не найдено.</div>';
        return;
    }

    grid.innerHTML = filteredProducts.map(p => `
        <div class="product-card" data-id="${p.id}">
            <div class="product-card__img">
                ${p.tag ? `<span class="product-tag">${p.tag}</span>` : ''}
                <img src="${p.image_url || 'assets/images/logo.png'}" alt="${p.name}" style="max-height: 100%; max-width: 100%; object-fit: contain;">
                <button class="add-to-cart-btn" data-id="${p.id}" data-name="${p.name}" data-price="${p.price}">В корзину</button>
            </div>
            <div class="product-card__info">
                <h3>${p.name}</h3>
                <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 10px;">${p.description || ''}</p>
                <div style="display: flex; justify-content: space-between; align-items: center; margin-top: auto;">
                    <span class="product-card__price">${p.price} ₽</span>
                    <span style="font-size: 13px; color: var(--text-muted);">${p.weight || ''}</span>
                </div>
            </div>
        </div>
    `).join('');

    // Обработчики для кнопок и карточек
    document.querySelectorAll('.add-to-cart-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            addToCart({
                id: btn.dataset.id,
                name: btn.dataset.name,
                price: parseInt(btn.dataset.price)
            });
        });
    });

    document.querySelectorAll('.product-card').forEach(card => {
        card.addEventListener('click', (e) => {
            if (e.target.closest('.add-to-cart-btn')) return;
            window.location.href = `product.html?id=${card.dataset.id}`;
        });
    });
}

// --- ИИ В КАТАЛОГЕ (Исправленная логика) ---
const catBotToggle = document.getElementById('catalog-bot-toggle');
const catBotModal = document.getElementById('catalog-bot-modal');
const catBotClose = document.getElementById('catalog-bot-close');
const catChatMessages = document.getElementById('catalog-chat-messages');
const catChatInput = document.getElementById('catalog-chat-input');
const catChatSend = document.getElementById('catalog-chat-send');

if (catBotToggle && catBotModal) {
    catBotToggle.addEventListener('click', () => {
        catBotModal.classList.toggle('active');
    });
    catBotClose.addEventListener('click', () => catBotModal.classList.remove('active'));

    catChatSend.addEventListener('click', async () => {
        const text = catChatInput.value.trim();
        if (!text) return;

        // Сообщение пользователя (классы как на главной)
        catChatMessages.innerHTML += `<div class="msg-wrapper user"><div class="msg">${text}</div></div>`;
        catChatInput.value = '';
        catChatMessages.scrollTop = catChatMessages.scrollHeight;

        // Индикатор загрузки
        const typingId = 'typing-' + Date.now();
        catChatMessages.innerHTML += `<div class="msg-wrapper bot" id="${typingId}"><div class="msg"><i>Доктор печатает...</i></div></div>`;
        catChatMessages.scrollTop = catChatMessages.scrollHeight;

        try {
            const res = await fetch('https://darsun-catalog-bot.turgleb7.workers.dev/api/catalog-chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: text, history: [] })
            });
            const data = await res.json();
            
            document.getElementById(typingId)?.remove();
            
            // Ответ бота (классы как на главной)
            catChatMessages.innerHTML += `<div class="msg-wrapper bot"><div class="msg">${data.reply || 'Ошибка'}</div></div>`;
            catChatMessages.scrollTop = catChatMessages.scrollHeight;
        } catch (e) {
            document.getElementById(typingId)?.remove();
            catChatMessages.innerHTML += `<div class="msg-wrapper bot"><div class="msg">Ошибка связи.</div></div>`;
            catChatMessages.scrollTop = catChatMessages.scrollHeight;
        }
    });

    catChatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') catChatSend.click();
    });
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

// --- ЧАТ В КАТАЛОГЕ ---
document.addEventListener('DOMContentLoaded', () => {
    const botToggle = document.getElementById('catalog-bot-toggle');
    const botModal = document.getElementById('catalog-bot-modal');
    const botClose = document.getElementById('catalog-bot-close');
    const chatInput = document.getElementById('catalog-chat-input');
    const chatSend = document.getElementById('catalog-chat-send');
    const chatMessages = document.getElementById('catalog-chat-messages');

    if (!botToggle || !botModal) return;

    // Открытие/закрытие
    botToggle.addEventListener('click', () => {
        botModal.style.display = botModal.style.display === 'flex' ? 'none' : 'flex';
    });
    botClose.addEventListener('click', () => {
        botModal.style.display = 'none';
    });

    // Отправка сообщения
    async function sendMessage() {
        const text = chatInput.value.trim();
        if (!text) return;

        // Добавляем сообщение пользователя
        chatMessages.innerHTML += `<div class="msg-wrapper user"><div class="msg">${text}</div></div>`;
        chatInput.value = '';
        chatMessages.scrollTop = chatMessages.scrollHeight;

        // Индикатор
        const typingId = 'typing-' + Date.now();
        chatMessages.innerHTML += `<div class="msg-wrapper bot" id="${typingId}"><div class="msg"><i>Доктор печатает...</i></div></div>`;
        chatMessages.scrollTop = chatMessages.scrollHeight;

        try {
            const res = await fetch('https://darsun-catalog-bot.turgleb7.workers.dev/api/catalog-chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: text, history: [] })
            });
            const data = await res.json();

            document.getElementById(typingId)?.remove();
            chatMessages.innerHTML += `<div class="msg-wrapper bot"><div class="msg">${data.reply || 'Ошибка'}</div></div>`;
        } catch (e) {
            document.getElementById(typingId)?.remove();
            chatMessages.innerHTML += `<div class="msg-wrapper bot"><div class="msg">Ошибка связи.</div></div>`;
        }
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    chatSend.addEventListener('click', sendMessage);
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });
});