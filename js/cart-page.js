import { supabase } from './supabase-client.js';

function showToast(msg, type = 'success') {
    const div = document.createElement('div');
    div.className = `toast ${type}`;
    div.textContent = msg;
    document.body.appendChild(div);
    setTimeout(() => div.classList.add('show'), 10);
    setTimeout(() => div.classList.remove('show'), 3000);
    setTimeout(() => div.remove(), 3500);
}

function renderCart() {
    const cart = JSON.parse(localStorage.getItem('cart') || '[]');
    const c = document.getElementById('cart-items');
    let total = 0;
    if (cart.length === 0) { c.innerHTML = 'Пусто'; return; }
    c.innerHTML = cart.map(i => {
        total += i.price * i.quantity;
        return `<div class="cart-item"><div class="cart-item__img"><img src="${i.image}"></div><div class="cart-item__info"><h4>${i.name}</h4><p>${i.price} ₽</p></div><div class="cart-item__qty"><button onclick="changeQty('${i.id}', -1)">-</button><span>${i.quantity}</span><button onclick="changeQty('${i.id}', 1)">+</button></div></div>`;
    }).join('');
    document.getElementById('sum-subtotal').textContent = `${total} ₽`;
    document.getElementById('sum-total').textContent = `${total} ₽`;
}

window.changeQty = (id, d) => {
    let cart = JSON.parse(localStorage.getItem('cart') || '[]');
    const item = cart.find(i => i.id === id);
    if (!item) return;
    item.quantity += d;
    if (item.quantity < 1) cart = cart.filter(i => i.id !== id);
    localStorage.setItem('cart', JSON.stringify(cart));
    renderCart();
};

document.getElementById('checkout-btn')?.addEventListener('click', async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return showToast('Войдите в аккаунт!', 'error');
    document.getElementById('checkout-form').style.display = 'flex';
    document.getElementById('checkout-btn').style.display = 'none';
});

document.getElementById('checkout-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // ЖЕСТКАЯ ЗАГЛУШКА ОПЛАТЫ
    showToast('Оплата временно недоступна. Скоро мы все запустим!', 'error');
    return;
    
    // (Дальнейший код закомментирован, пока нет оплаты)
    /*
    const cart = JSON.parse(localStorage.getItem('cart') || '[]');
    const total = cart.reduce((s, i) => s + i.price * i.quantity, 0);
    const { data: { session } } = await supabase.auth.getSession();
    
    showToast(`Оплата на ${total} ₽ (Имитация). Заказ оформлен!`, 'success');
    await supabase.from('orders').insert([{ user_id: session.user.id, items: cart, total, status: 'Оплачен' }]);
    localStorage.removeItem('cart');
    setTimeout(() => window.location.href = 'profile.html', 2000);
    */
});

renderCart();