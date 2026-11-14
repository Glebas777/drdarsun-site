import { supabase } from './supabase-client.js';
import { addToCart, updateCartCount } from './cart.js';

const urlParams = new URLSearchParams(window.location.search);
const productId = urlParams.get('id');

async function loadProduct() {
    let product;
    if (productId) {
        const { data } = await supabase.from('products').select('*').eq('id', productId).single();
        product = data;
    } else {
        const { data } = await supabase.from('products').select('*').limit(1).single();
        product = data;
    }

    if (!product) {
        window.location.href = 'catalog.html';
        return;
    }

    document.getElementById('product-name').textContent = product.name;
    document.getElementById('product-price').textContent = `${product.price} ₽`;
    document.getElementById('product-desc').textContent = product.description;
    document.getElementById('spec-volume').textContent = product.volume;
    
    // Картинки (с заглушкой для п.5)
    const mainImg = document.getElementById('main-img');
    mainImg.src = product.image_url || 'assets/images/logo.png'; // Дефолтная картинка

    // Кнопка "В корзину"
    document.getElementById('add-to-cart-btn').addEventListener('click', () => {
        addToCart({
            id: product.id,
            name: product.name,
            price: product.price,
            image: product.image_url
        });
    });

    // Загрузка отзывов (для п.4)
    loadReviews(productId);
    
    updateCartCount();
}

async function loadReviews(productId) {
    const container = document.getElementById('reviews-list');
    if (!container) return;

    const { data: reviews } = await supabase.from('reviews').select('*').eq('product_id', productId).order('created_at', { ascending: false });
    
    if (!reviews || reviews.length === 0) {
        container.innerHTML = '<p style="color: var(--text-muted);">Пока нет отзывов. Будьте первым!</p>';
    } else {
        container.innerHTML = reviews.map(r => `
            <div style="background: var(--bg-card); padding: 15px; border-radius: 12px; margin-bottom: 10px; border: 1px solid var(--border);">
                <div style="display: flex; justify-content: space-between; margin-bottom: 10px;">
                    <strong>${r.user_name}</strong>
                    <span style="color: var(--accent-gold);">${'★'.repeat(r.rating)}${'☆'.repeat(5-r.rating)}</span>
                </div>
                <p style="color: var(--text-muted);">${r.text}</p>
            </div>
        `).join('');
    }
}

loadProduct();