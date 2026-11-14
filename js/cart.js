// Универсальная корзина (работает везде)
export function addToCart(product) {
    let cart = JSON.parse(localStorage.getItem('cart') || '[]');
    const existing = cart.find(item => item.id === product.id);
    
    if (existing) {
        existing.quantity += 1;
    } else {
        cart.push({ ...product, quantity: 1 });
    }
    
    localStorage.setItem('cart', JSON.stringify(cart));
    updateCartCount();
    alert(`✅ ${product.name} добавлен в корзину!`);
}

export function updateCartCount() {
    const cart = JSON.parse(localStorage.getItem('cart') || '[]');
    const count = cart.reduce((sum, item) => sum + item.quantity, 0);
    
    // Ищем кнопку корзины в хедере
    const cartBtn = document.querySelector('a[href="cart.html"]');
    if (cartBtn) {
        // Убираем старый бейдж, если был
        const oldBadge = cartBtn.querySelector('.cart-badge');
        if (oldBadge) oldBadge.remove();
        
        if (count > 0) {
            cartBtn.innerHTML += `<span class="cart-badge" style="background: red; color: white; border-radius: 50%; padding: 2px 6px; font-size: 12px; position: absolute; top: -5px; right: -10px;">${count}</span>`;
            cartBtn.style.position = 'relative';
        }
    }
}