import { supabase } from './supabase-client.js';

const ordersElement = document.getElementById('courier-orders');
const statusElement = document.getElementById('courier-status');
const nameElement = document.getElementById('courier-name');
const refreshButton = document.getElementById('courier-refresh');
const logoutButton = document.getElementById('courier-logout');
const currency = new Intl.NumberFormat('ru-RU');
const statusLabels = {
    pending: 'Доступен',
    paid: 'Оплачен',
    accepted: 'Принят',
    in_transit: 'В пути',
    delivered: 'Доставлен',
    paid: 'Оплачен'
};

let activeSession;

function makeText(tag, className, value) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = value;
    return element;
}

function getNextAction(order) {
    if (!order.courier_id && (order.status === 'pending' || order.status === 'paid')) return ['accepted', 'Принял заказ'];
    if (order.status === 'accepted') return ['in_transit', 'В пути'];
    if (order.status === 'in_transit') return ['delivered', 'Доставлен'];
    if (order.status === 'delivered' && order.payment_method === 'cash') return ['paid', 'Оплачен (наличные)'];
    return null;
}

function renderOrder(order) {
    const card = document.createElement('article');
    card.className = 'courier-order';

    const heading = document.createElement('div');
    heading.className = 'courier-order__heading';
    heading.append(
        makeText('h2', '', `Заказ №${order.id}`),
        makeText('span', 'courier-order__badge', statusLabels[order.status] || 'Обрабатывается')
    );

    const meta = document.createElement('ul');
    meta.className = 'courier-order__meta';
    meta.append(
        makeText('li', '', `Покупатель: ${order.customer_name || '—'}`),
        makeText('li', '', `Адрес: ${order.delivery_address || '—'}`)
    );
    if (order.customer_phone) {
        const phone = document.createElement('a');
        phone.href = `tel:${String(order.customer_phone).replace(/[^\d+]/g, '')}`;
        phone.textContent = `Телефон: ${order.customer_phone}`;
        const item = document.createElement('li');
        item.appendChild(phone);
        meta.appendChild(item);
    }
    meta.appendChild(makeText('li', '', `Оплата: ${order.payment_method === 'cash' ? 'курьеру наличными' : order.payment_method === 'sbp' ? 'СБП' : 'банковская карта'}`));

    const items = document.createElement('ul');
    items.className = 'courier-order__items';
    if (Array.isArray(order.items)) {
        order.items.forEach(item => {
            items.appendChild(makeText('li', '', `${item.name || item.product_id || 'Товар'} × ${item.quantity || 1}`));
        });
    }

    const footer = document.createElement('div');
    footer.className = 'courier-order__footer';
    footer.appendChild(makeText('strong', 'courier-order__total', `${currency.format(Number(order.total) || 0)} ₽`));
    const actions = document.createElement('div');
    actions.className = 'courier-order__actions';
    const nextAction = getNextAction(order);
    if (nextAction) {
        const button = makeText('button', 'btn btn--primary', nextAction[1]);
        button.type = 'button';
        button.dataset.orderId = String(order.id);
        button.dataset.status = nextAction[0];
        actions.appendChild(button);
    }
    footer.appendChild(actions);
    card.append(heading, meta, items, footer);
    return card;
}

async function loadOrders() {
    refreshButton.disabled = true;
    statusElement.textContent = 'Загружаем заказы…';
    try {
        const response = await fetch('https://drdarsun-site-main.layero.app/api/courier/orders', {
            headers: { Authorization: `Bearer ${activeSession.access_token}` },
            cache: 'no-store',
            signal: AbortSignal.timeout(8000)
        });
        const result = await response.json().catch(() => null);
        if (response.status === 401) {
            await supabase.auth.signOut({ scope: 'local' });
            window.location.replace('courier-login.html');
            return;
        }
        if (!response.ok || !Array.isArray(result?.orders)) {
            throw new Error(result?.error || 'Не удалось загрузить заказы.');
        }
        ordersElement.replaceChildren();
        if (!result.orders.length) {
            ordersElement.appendChild(makeText('p', 'courier-empty', 'Сейчас доступных заказов нет.'));
        } else {
            ordersElement.append(...result.orders.map(renderOrder));
        }
        statusElement.textContent = `Заказов в списке: ${result.orders.length}`;
    } catch (error) {
        console.error('Courier orders could not be loaded:', error);
        statusElement.textContent = error.message || 'Не удалось загрузить заказы.';
    } finally {
        refreshButton.disabled = false;
    }
}

ordersElement.addEventListener('click', async event => {
    const button = event.target.closest('button[data-order-id]');
    if (!button) return;
    button.disabled = true;
    try {
        const response = await fetch(`https://drdarsun-site-main.layero.app/api/courier/orders/${encodeURIComponent(button.dataset.orderId)}`, {
            method: 'PATCH',
            headers: {
                Authorization: `Bearer ${activeSession.access_token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ status: button.dataset.status }),
            signal: AbortSignal.timeout(8000)
        });
        const result = await response.json().catch(() => null);
        if (!response.ok) throw new Error(result?.error || 'Не удалось обновить статус заказа.');
        await loadOrders();
    } catch (error) {
        console.error('Courier order status update failed:', error);
        statusElement.textContent = error.message || 'Не удалось обновить статус заказа.';
        button.disabled = false;
    }
});

refreshButton.addEventListener('click', loadOrders);
logoutButton.addEventListener('click', async () => {
    logoutButton.disabled = true;
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) {
        console.error('Courier sign-out failed:', error);
        statusElement.textContent = 'Не удалось завершить сессию. Попробуйте ещё раз.';
        logoutButton.disabled = false;
        return;
    }
    window.location.replace('courier-login.html');
});

const { data: { session }, error } = await supabase.auth.getSession();
if (error || !session) {
    window.location.replace('courier-login.html');
} else {
    activeSession = session;
    nameElement.textContent = session.user.user_metadata?.full_name || 'Курьер';
    await loadOrders();
}
