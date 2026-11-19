import { supabase } from './supabase-client.js';
import { updateCartCount } from './cart.js';

const cartItems = document.getElementById('cart-items');
const checkoutButton = document.getElementById('checkout-btn');
const checkoutForm = document.getElementById('checkout-form');
const currency = new Intl.NumberFormat('ru-RU');

function showToast(message, type = 'success') {
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    container.scrollTop = container.scrollHeight;
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 350);
    }, 3200);
}

function readCart() {
    let parsed;
    try {
        parsed = JSON.parse(localStorage.getItem('cart') || '[]');
    } catch (error) {
        console.error('Cart data is invalid:', error);
        throw new Error('Не удалось прочитать корзину. Очистите данные сайта и добавьте товары снова.');
    }
    if (!Array.isArray(parsed)) throw new Error('Формат корзины повреждён.');
    return parsed.filter(item =>
        item &&
        item.id != null &&
        typeof item.name === 'string' &&
        Number.isFinite(Number(item.price)) &&
        Number(item.price) >= 0 &&
        Number.isInteger(Number(item.quantity)) &&
        Number(item.quantity) > 0
    ).map(item => ({ ...item, id: String(item.id), price: Number(item.price), quantity: Number(item.quantity) }));
}

function writeCart(cart) {
    localStorage.setItem('cart', JSON.stringify(cart));
}

function setImageSource(image, source) {
    const placeholder = 'assets/images/product-bottle-placeholder.png';
    image.addEventListener('error', () => {
        if (image.dataset.placeholderApplied) return;
        image.dataset.placeholderApplied = 'true';
        image.src = placeholder;
    }, { once: true });
    if (typeof source !== 'string' || !source.trim()) {
        image.src = placeholder;
        return;
    }
    try {
        const url = new URL(source, window.location.href);
        if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Unsupported image URL');
        image.src = url.href;
    } catch (error) {
        console.warn('Cart item image URL ignored:', error);
        image.src = placeholder;
    }
}

function createCartItem(item) {
    const row = document.createElement('article');
    row.className = 'cart-item';

    const imageFrame = document.createElement('div');
    imageFrame.className = 'cart-item__img';
    const image = document.createElement('img');
    image.alt = item.name;
    image.loading = 'lazy';
    image.decoding = 'async';
    setImageSource(image, item.image);
    imageFrame.appendChild(image);

    const info = document.createElement('div');
    info.className = 'cart-item__info';
    const name = document.createElement('h2');
    name.textContent = item.name;
    const price = document.createElement('p');
    price.className = 'cart-item__price';
    price.textContent = `${currency.format(item.price)} ₽`;
    info.append(name, price);

    const quantity = document.createElement('div');
    quantity.className = 'cart-item__qty';
    const decrement = document.createElement('button');
    decrement.type = 'button';
    decrement.dataset.cartAction = 'decrease';
    decrement.dataset.itemId = item.id;
    decrement.setAttribute('aria-label', `Уменьшить количество: ${item.name}`);
    decrement.textContent = '−';
    const count = document.createElement('span');
    count.textContent = String(item.quantity);
    count.setAttribute('aria-label', 'Количество');
    const increment = document.createElement('button');
    increment.type = 'button';
    increment.dataset.cartAction = 'increase';
    increment.dataset.itemId = item.id;
    increment.setAttribute('aria-label', `Увеличить количество: ${item.name}`);
    increment.textContent = '+';
    increment.disabled = item.quantity >= 99;
    quantity.append(decrement, count, increment);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'cart-item__remove';
    remove.dataset.cartAction = 'remove';
    remove.dataset.itemId = item.id;
    remove.textContent = 'Убрать из корзины';
    remove.setAttribute('aria-label', `Убрать ${item.name} из корзины`);

    row.append(imageFrame, info, quantity, remove);
    return row;
}

function renderCart() {
    let cart;
    try {
        cart = readCart();
    } catch (error) {
        cartItems.replaceChildren();
        const message = document.createElement('p');
        message.className = 'cart-empty';
        message.textContent = error.message;
        cartItems.appendChild(message);
        checkoutButton.hidden = true;
        checkoutForm.hidden = true;
        return;
    }

    const empty = cart.length === 0;
    cartItems.replaceChildren();
    checkoutButton.hidden = empty;
    if (empty) {
        const state = document.createElement('section');
        state.className = 'cart-empty';
        const title = document.createElement('h2');
        title.textContent = 'Корзина пока пуста';
        const message = document.createElement('p');
        message.textContent = 'Выберите любимые продукты в каталоге — и они появятся здесь.';
        const link = document.createElement('a');
        link.className = 'btn btn--primary';
        link.href = 'catalog.html';
        link.textContent = 'Перейти в каталог';
        state.append(title, message, link);
        cartItems.appendChild(state);
        checkoutForm.hidden = true;
    } else {
        cartItems.append(...cart.map(createCartItem));
    }

    const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
    document.getElementById('sum-subtotal').textContent = `${currency.format(total)} ₽`;
    document.getElementById('sum-total').textContent = `${currency.format(total)} ₽`;
}

cartItems?.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-cart-action]');
    if (!button) return;
    const { cartAction, itemId } = button.dataset;
    let cart;
    try {
        cart = readCart();
    } catch (error) {
        showToast(error.message, 'error');
        return;
    }
    const item = cart.find(entry => entry.id === itemId);
    if (!item) return;

    if (cartAction === 'increase') item.quantity += 1;
    else if (cartAction === 'decrease') item.quantity -= 1;
    if (cartAction === 'remove' || item.quantity <= 0) cart = cart.filter(entry => entry.id !== itemId);
    try {
        writeCart(cart);
        renderCart();
    } catch (error) {
        console.error('Cart update failed:', error);
        showToast('Не удалось сохранить корзину.', 'error');
    }
});

checkoutButton?.addEventListener('click', async () => {
    let cart;
    try {
        cart = readCart();
    } catch (error) {
        return showToast(error.message, 'error');
    }
    if (!cart.length) return showToast('Сначала добавьте товары в корзину.', 'error');

    let session;
    let error;
    try {
        ({ data: { session }, error } = await supabase.auth.getSession());
    } catch (sessionError) {
        console.error('Checkout session lookup failed:', sessionError);
        return showToast('Не удалось проверить вход. Обновите страницу и попробуйте снова.', 'error');
    }
    if (error) return showToast('Не удалось проверить вход: ' + error.message, 'error');
    if (!session) {
        window.location.href = `login.html?redirect=${encodeURIComponent('cart.html')}`;
        return;
    }

    const emailInput = document.getElementById('order-email');
    emailInput.value = session.user.email || '';
    emailInput.title = session.user.email || '';
    if (!emailInput.value) return showToast('В аккаунте не указан адрес почты.', 'error');
    const nameInput = document.getElementById('order-name');
    if (!nameInput.value && session.user.user_metadata.full_name) {
        nameInput.value = session.user.user_metadata.full_name;
    }
    checkoutForm.hidden = false;
    checkoutButton.hidden = true;
    document.getElementById('order-name').focus();
});

checkoutForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!checkoutForm.reportValidity()) return;

    const submitButton = checkoutForm.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.textContent = 'Отправляем…';
    try {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw new Error('Не удалось проверить вход. Обновите страницу и попробуйте снова.');
        if (!session) {
            window.location.href = `login.html?redirect=${encodeURIComponent('cart.html')}`;
            return;
        }

        const orderResponse = await fetch('https://drdarsun-site-main.layero.app/api/orders', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${session.access_token}`
            },
            body: JSON.stringify({
                customer_name: document.getElementById('order-name').value.trim(),
                delivery_address: document.getElementById('order-address').value.trim(),
                items: readCart().map(item => ({ id: item.id, quantity: item.quantity }))
            })
        });
        const result = await orderResponse.json().catch(() => null);
        if (!orderResponse.ok) throw new Error(result?.error || 'Не удалось отправить заказ. Попробуйте позже.');
        if (!result?.order?.id) throw new Error('Заказ не подтверждён сервером. Проверьте раздел заказов профиля.');

        localStorage.removeItem('cart');
        renderCart();
        await updateCartCount();
        const confirmation = document.createElement('section');
        confirmation.className = 'order-confirmation';
        confirmation.setAttribute('role', 'status');
        const title = document.createElement('h2');
        title.textContent = 'Заявка на заказ отправлена';
        const message = document.createElement('p');
        message.textContent = `Заказ №${result.order.id} сохранён в профиле. Наличие, доставку и способ оплаты можно уточнить через поддержку.`;
        const link = document.createElement('a');
        link.className = 'btn btn--primary';
        link.href = 'profile.html';
        link.textContent = 'Перейти в профиль';
        confirmation.append(title, message, link);
        cartItems.replaceChildren(confirmation);
        checkoutButton.hidden = true;
        checkoutForm.hidden = true;
    } catch (error) {
        console.error('Order submission failed:', error);
        showToast(error.message || 'Не удалось отправить заказ. Попробуйте позже.', 'error');
    } finally {
        submitButton.disabled = false;
        submitButton.textContent = 'Отправить заказ';
    }
});

renderCart();

supabase.auth.getSession().then(({ data, error }) => {
    if (error) {
        showToast('Не удалось загрузить почту аккаунта: ' + error.message, 'error');
        return;
    }
    const emailInput = document.getElementById('order-email');
    if (emailInput && data.session?.user.email) {
        emailInput.value = data.session.user.email;
        emailInput.title = data.session.user.email;
    }
}).catch(error => {
    console.error('Checkout email lookup failed:', error);
    showToast('Не удалось загрузить почту аккаунта.', 'error');
});
