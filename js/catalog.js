const products = [
    { id: '1', name: 'Масло сыродавленное', price: 600, desc: 'Классическое. 500 мл.' },
    { id: '2', name: 'Масло с чесноком', price: 650, desc: 'Пикантное. 500 мл.' }
];

document.addEventListener('DOMContentLoaded', () => {
    const grid = document.getElementById('catalog-grid');
    if (!grid) return;

    grid.innerHTML = products.map(p => `
        <div class="card" style="padding: 0; overflow: hidden; cursor: pointer;" onclick="window.location.href='product.html'">
            <div style="height: 250px; background: var(--bg-card); display: flex; align-items: center; justify-content: center; color: var(--text-muted);">[Фото]</div>
            <div style="padding: 25px;">
                <h3 style="color: var(--primary); margin-bottom: 10px; font-family: var(--font-heading);">${p.name}</h3>
                <p style="color: var(--text-muted); margin-bottom: 15px;">${p.desc}</p>
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-size: 20px; font-weight: bold; color: var(--accent);">${p.price} ₽</span>
                    <button class="btn btn--outline add-btn" data-id="${p.id}">Купить</button>
                </div>
            </div>
        </div>
    `).join('');

    document.querySelectorAll('.add-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const product = products.find(p => p.id === btn.dataset.id);
            let cart = JSON.parse(localStorage.getItem('cart') || '[]');
            cart.push(product);
            localStorage.setItem('cart', JSON.stringify(cart));
            window.showToast('Добавлено в корзину!');
        });
    });
});