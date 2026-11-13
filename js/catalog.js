document.addEventListener('DOMContentLoaded', () => {
    const grid = document.getElementById('catalog-grid');
    if (!grid) return;

    const products = [
        { id: '1', name: 'Масло классическое', price: 600, desc: '500 мл. Сыродавленное.' }
    ];

    grid.innerHTML = products.map(p => `
        <div class="card" style="padding:0;overflow:hidden;">
            <div style="height:200px;background:var(--bg-card);display:flex;align-items:center;justify-content:center;color:var(--text-muted);">[Фото]</div>
            <div style="padding:20px;">
                <h3>${p.name}</h3>
                <p style="color:var(--text-muted);margin-bottom:15px;">${p.desc}</p>
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <span style="font-size:20px;font-weight:bold;color:var(--accent);">${p.price} ₽</span>
                    <button class="btn btn--outline" onclick="addToCart('${p.id}', '${p.name}', ${p.price})">Купить</button>
                </div>
            </div>
        </div>
    `).join('');
});

window.addToCart = (id, name, price) => {
    let cart = JSON.parse(localStorage.getItem('cart') || '[]');
    cart.push({ id, name, price });
    localStorage.setItem('cart', JSON.stringify(cart));
    showToast('Добавлено в корзину!');
};