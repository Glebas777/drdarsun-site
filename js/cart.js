document.addEventListener('DOMContentLoaded', () => {
    const cart = JSON.parse(localStorage.getItem('cart') || '[]');
    const cartItems = document.getElementById('cart-items');
    const cartTotal = document.getElementById('cart-total');
    
    if (cart.length === 0) {
        cartItems.innerHTML = '<p style="color: var(--text-muted);">Корзина пуста.</p>';
        return;
    }

    let total = 0;
    cartItems.innerHTML = cart.map((item, index) => {
        total += item.price;
        return `
            <div class="card" style="display: flex; justify-content: space-between; align-items: center; padding: 20px;">
                <div>
                    <h4 style="color: var(--primary);">${item.name}</h4>
                    <p style="color: var(--text-muted); font-size: 14px;">${item.desc}</p>
                </div>
                <div style="display: flex; align-items: center; gap: 20px;">
                    <span style="font-weight: bold; color: var(--accent);">${item.price} ₽</span>
                    <button class="btn btn--outline" style="padding: 5px 10px;" onclick="removeItem(${index})">×</button>
                </div>
            </div>
        `;
    }).join('');
    cartTotal.textContent = total + ' ₽';

    window.removeItem = (index) => {
        cart.splice(index, 1);
        localStorage.setItem('cart', JSON.stringify(cart));
        window.location.reload();
    };
});