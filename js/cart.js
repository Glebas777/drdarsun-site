function notify(message, type = 'success') {
    if (typeof window.showToast === 'function') {
        window.showToast(message, type);
    } else {
        window.alert(message);
    }
}

export async function addToCart(product) {
    const price = Number(product.price);
    if (product.id == null || !Number.isFinite(price) || price < 0 || typeof product.name !== 'string') {
        notify('Не удалось добавить товар: данные товара некорректны.', 'error');
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
        if (existing && Number(existing.quantity) >= 99) {
            notify('В заказ можно добавить не более 99 единиц одного товара.', 'error');
            return;
        }
        if (existing) existing.quantity = Number(existing.quantity) + 1;
        else cart.push({
            id: String(product.id),
            name: product.name,
            price,
            image: typeof product.image === 'string' ? product.image : '',
            quantity: 1
        });
        localStorage.setItem('cart', JSON.stringify(cart));
        await updateCartCount();
        notify('Товар добавлен в корзину.');
    } catch (error) {
        console.error('Cart item could not be saved:', error);
        notify('Не удалось сохранить корзину. Проверьте свободное место в браузере.', 'error');
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