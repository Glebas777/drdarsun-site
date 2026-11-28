import { supabase } from './supabase-client.js';

const orderNumber = document.querySelector('[data-order-number]');
const paymentMessage = document.querySelector('[data-payment-message]');
const requestedOrderId = new URLSearchParams(window.location.search).get('order_id') || '';

function clearCheckoutState({ clearCart = false } = {}) {
    if (clearCart) {
        try {
            localStorage.removeItem('cart');
        } catch (error) {
            console.error('Paid cart could not be cleared:', error);
        }
    }
    try {
        sessionStorage.removeItem('darsun_pending_checkout_request');
    } catch (error) {
        console.warn('Checkout idempotency key could not be cleared:', error);
    }
}

if (orderNumber && /^[A-Za-z0-9_-]{1,120}$/.test(requestedOrderId)) {
    orderNumber.textContent = `Номер заказа: ${requestedOrderId}`;
    orderNumber.hidden = false;
}

if (paymentMessage && /^[A-Za-z0-9_-]{1,120}$/.test(requestedOrderId)) {
    const statusLabels = {
        succeeded: 'Оплата подтверждена. Заказ передан в обработку.',
        canceled: 'Платёж отменён. Если списание всё же появится в банке, обратитесь в поддержку.'
    };

    async function checkPaymentStatus() {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (!session) return null;
        const response = await fetch(
            `https://drdarsun-site-main.layero.app/api/payments/status/${encodeURIComponent(requestedOrderId)}`,
            {
                headers: { Authorization: `Bearer ${session.access_token}` },
                cache: 'no-store',
                signal: AbortSignal.timeout(6000)
            }
        );
        if (response.status === 401 || response.status === 404) return null;
        const result = await response.json().catch(() => null);
        if (!response.ok) throw new Error(result?.error || 'Не удалось проверить статус платежа.');
        return result?.status || null;
    }

    (async () => {
        for (let attempt = 0; attempt < 6; attempt += 1) {
            try {
                const status = await checkPaymentStatus();
                if (status === 'succeeded') {
                    clearCheckoutState({ clearCart: true });
                    window.location.replace(`payment-success.html?order_id=${encodeURIComponent(requestedOrderId)}`);
                    return;
                }
                if (status === 'canceled' || status === 'failed') {
                    clearCheckoutState();
                    window.location.replace(`payment-fail.html?order_id=${encodeURIComponent(requestedOrderId)}`);
                    return;
                }
                if (status && statusLabels[status]) {
                    paymentMessage.textContent = statusLabels[status];
                    return;
                }
            } catch (error) {
                console.error('Payment status polling failed:', error);
                paymentMessage.textContent = 'Платёж ещё обрабатывается. Обновите страницу позднее или проверьте заказ в профиле.';
                return;
            }
            if (attempt < 5) await new Promise(resolve => setTimeout(resolve, 3000));
        }
        paymentMessage.textContent = 'Платёж ещё обрабатывается. Проверьте статус заказа в личном кабинете позднее.';
    })();
}
