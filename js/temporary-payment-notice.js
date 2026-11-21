const hiddenKey = 'drdarsun-payment-notice-hidden';
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
notice.setAttribute('aria-label', 'Информация о временной приостановке заказов');

const message = document.createElement('div');
message.className = 'payment-notice__message';
const title = document.createElement('strong');
title.textContent = 'Заказы пока на паузе';
const description = document.createElement('p');
description.textContent = 'Способы оплаты ещё не подключены. Пожалуйста, не оформляйте и не оплачивайте покупки — приём заказов временно остановлен.';
message.append(title, description);

const hideButton = document.createElement('button');
hideButton.className = 'payment-notice__hide';
hideButton.type = 'button';
hideButton.setAttribute('aria-label', 'Свернуть уведомление');
hideButton.textContent = '×';

const reopenButton = document.createElement('button');
reopenButton.className = 'payment-notice__reopen';
reopenButton.type = 'button';
reopenButton.setAttribute('aria-label', 'Развернуть уведомление: заказы приостановлены, способы оплаты пока недоступны');
reopenButton.hidden = !isHidden;
notice.hidden = isHidden;
notice.append(message, hideButton);
document.body.appendChild(notice);
document.body.appendChild(reopenButton);

const paymentMethods = [
    { name: 'СБП', icon: '<img src="assets/images/sbp-logo.svg" alt="Система быстрых платежей">' },
    { name: 'Банковская карта', icon: '<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="5" y="10" width="38" height="28" rx="5"/><path d="M5 19h38M11 30h12"/></svg>' },
    { name: 'Сбербанк', icon: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="m5 18 19-11 19 11M8 21h32M11 21v16m9-16v16m8-16v16m9-16v16M7 40h34"/></svg>' }
];
const reduceMotionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
let paymentIconIndex = 0;
let paymentIconTimer;

function showPaymentIcon(index) {
    const method = paymentMethods[index];
    reopenButton.innerHTML = `${method.icon}<span>${method.name}</span>`;
    reopenButton.title = `${method.name} — планируемый способ оплаты`;
}

function stopPaymentIconRotation() {
    if (paymentIconTimer) window.clearInterval(paymentIconTimer);
    paymentIconTimer = undefined;
}

function startPaymentIconRotation() {
    stopPaymentIconRotation();
    showPaymentIcon(paymentIconIndex);
    if (reduceMotionPreference.matches) return;
    paymentIconTimer = window.setInterval(() => {
        paymentIconIndex = (paymentIconIndex + 1) % paymentMethods.length;
        showPaymentIcon(paymentIconIndex);
    }, 2600);
}

document.documentElement.dataset.orderIntake = 'paused';
document.querySelectorAll('#checkout-btn, #checkout-form button[type="submit"]').forEach(button => {
    button.disabled = true;
    button.setAttribute('aria-describedby', 'payment-notice-description');
});
description.id = 'payment-notice-description';

function setHidden(hidden) {
    notice.hidden = hidden;
    reopenButton.hidden = !hidden;
    if (hidden) startPaymentIconRotation();
    else stopPaymentIconRotation();
    try {
        localStorage.setItem(hiddenKey, String(hidden));
    } catch (error) {
        console.warn('Payment notice preference could not be saved:', error);
    }
}

hideButton.addEventListener('click', () => setHidden(true));
reopenButton.addEventListener('click', () => setHidden(false));
if (isHidden) startPaymentIconRotation();
reduceMotionPreference.addEventListener('change', event => {
    if (reopenButton.hidden) return;
    if (event.matches) stopPaymentIconRotation();
    else startPaymentIconRotation();
});
