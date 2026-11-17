import { supabase } from './supabase-client.js';

export async function addToCart(product) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
        alert('Войдите в аккаунт, чтобы добавить товар в корзину.');
        window.location.href = 'login.html';
        return;
    }

    const price = Number(product.price);
    if (product.id == null || !Number.isFinite(price) || price < 0 || typeof product.name !== 'string') {
        alert('Не удалось добавить товар: данные товара некорректны.');
        return;
    }

    try {
        const stored = JSON.parse(localStorage.getItem('cart') || '[]');
        if (!Array.isArray(stored)) throw new Error('Invalid cart format');
        const cart = stored.filter(item =>
            item && item.id != null && typeof item.name === 'string' &&
            Number.isFinite(Number(item.price)) && Number.isInteger(Number(item.quantity)) && Number(item.quantity) > 0
        );
        const existing = cart.find(item => String(item.id) === String(product.id));
        if (existing) existing.quantity = Number(existing.quantity) + 1;
        else cart.push({
            id: String(product.id),
            name: product.name,
            price,
            image: typeof product.image === 'string' ? product.image : '',
            quantity: 1
        });
        localStorage.setItem('cart', JSON.stringify(cart));
        alert('Товар добавлен в корзину!');
        await updateCartCount();
    } catch (error) {
        console.error('Cart item could not be saved:', error);
        alert('Не удалось сохранить корзину. Проверьте свободное место в браузере.');
    }
}

export async function updateCartCount() {
    let count = 0;
    try {
        const stored = JSON.parse(localStorage.getItem('cart') || '[]');
        if (!Array.isArray(stored)) throw new Error('Invalid cart format');
        count = stored.reduce((sum, item) => {
            const quantity = Number(item?.quantity);
            return Number.isInteger(quantity) && quantity > 0 ? sum + quantity : sum;
        }, 0);
    } catch (error) {
        console.error('Cart count could not be read:', error);
    }

    const cartButton = document.getElementById('cart-btn');
    if (cartButton) cartButton.textContent = count ? `Корзина (${count})` : 'Корзина';
    document.querySelectorAll('[data-cart-count]').forEach((badge) => {
        badge.textContent = String(count);
        badge.hidden = count === 0;
    });
}