const hiddenKey = 'drdarsun-payment-notice-hidden';

let options;
try {
    const response = await fetch('https://drdarsun-site-main.layero.app/api/order-options', {
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000)
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result || typeof result !== 'object') {
        throw new Error(result?.error || 'Order availability is unavailable.');
    }
    options = result;
} catch (error) {
    console.error('Payment notice could not load order options:', error);
    options = null;
}

if (!options?.card && !options?.sbp) {
    const style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = new URL('../css/temporary-payment-notice.css', import.meta.url).href;
    document.head.appendChild(style);

    let isHidden = false;
    try {
        isHidden = localStorage.getItem(hiddenKey) === 'true';
    } catch (error) {
        console.warn('Payment notice preference could not be loaded:', error);
    }

    const notice = document.createElement('aside');
    notice.className = 'payment-notice';
    notice.setAttribute('aria-label', 'Информация о доступности оплаты');

    const message = document.createElement('div');
    message.className = 'payment-notice__message';
    const title = document.createElement('strong');
    title.textContent = !options
        ? 'Не удалось проверить доступность заказов'
        : options.cash ? 'Оплата курьеру при получении' : 'Оформление заказов настраивается';
    const description = document.createElement('p');
    description.textContent = !options
        ? 'Обновите страницу или проверьте доступность оплаты позже.'
        : options.cash
            ? 'Сейчас доступна оплата наличными при получении. Онлайн-оплата временно недоступна.'
            : 'Оформление заказов временно недоступно. Доступные способы появятся в корзине.';
    message.append(title, description);

    const hideButton = document.createElement('button');
    hideButton.className = 'payment-notice__hide';
    hideButton.type = 'button';
    hideButton.setAttribute('aria-label', 'Свернуть уведомление');
    hideButton.textContent = '×';

    const reopenButton = document.createElement('button');
    reopenButton.className = 'payment-notice__reopen';
    reopenButton.type = 'button';
    reopenButton.setAttribute('aria-label', 'Развернуть уведомление о доступной оплате');
    reopenButton.textContent = options?.cash ? 'Наличные' : 'Заказы';
    reopenButton.hidden = !isHidden;
    notice.hidden = isHidden;
    notice.append(message, hideButton);
    document.body.append(notice, reopenButton);

    function setHidden(hidden) {
        notice.hidden = hidden;
        reopenButton.hidden = !hidden;
        try {
            localStorage.setItem(hiddenKey, String(hidden));
        } catch (error) {
            console.warn('Payment notice preference could not be saved:', error);
        }
    }

    hideButton.addEventListener('click', () => setHidden(true));
    reopenButton.addEventListener('click', () => setHidden(false));
}
