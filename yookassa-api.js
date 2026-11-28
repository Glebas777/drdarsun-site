const crypto = require('node:crypto');

const API_URL = 'https://api.yookassa.ru/v3/payments';

function isSafeConfirmationUrl(value) {
    if (typeof value !== 'string' || !value.startsWith('https://')) return false;
    try {
        const host = new URL(value).hostname;
        return ['yookassa.ru', 'yoomoney.ru']
            .some(domain => host === domain || host.endsWith(`.${domain}`));
    } catch (error) {
        return false;
    }
}

function getCredentials(env = process.env) {
    const shopId = String(env.YU_KASSA_SHOP_ID || '').trim();
    const secret = String(env.YU_KASSA_SECRET || '').trim();
    if (!/^\d{1,20}$/.test(shopId) || !secret || /[\u0000-\u001f]/.test(secret)) return null;
    return { shopId, secret };
}

function isYooKassaConfigured(env = process.env) {
    return Boolean(getCredentials(env));
}

function getAuthorizationHeader(env) {
    const credentials = getCredentials(env);
    if (!credentials) throw new Error('YooKassa credentials are not configured.');
    return `Basic ${Buffer.from(`${credentials.shopId}:${credentials.secret}`).toString('base64')}`;
}

async function createPayment({
    env = process.env,
    fetch: fetchImpl = global.fetch,
    order,
    user,
    paymentMethod,
    requestId
}) {
    if (!order?.id || !user?.id || !['card', 'sbp'].includes(paymentMethod)) {
        throw new Error('Invalid YooKassa payment request.');
    }

    const amountCents = Math.round(Number(order.total) * 100);
    if (!Number.isSafeInteger(amountCents) || amountCents < 1) {
        throw new Error('Invalid YooKassa payment amount.');
    }

    const returnUrl = new URL('payment-pending.html', 'https://drdarsun.ru/');
    returnUrl.searchParams.set('order_id', String(order.id));
    const payload = {
        amount: { value: (amountCents / 100).toFixed(2), currency: 'RUB' },
        capture: true,
        confirmation: { type: 'redirect', return_url: returnUrl.href },
        description: `Заказ ${String(order.id).slice(0, 100)} · Dr. DarSun`,
        metadata: { order_id: String(order.id), user_id: user.id },
        payment_method_data: { type: paymentMethod === 'sbp' ? 'sbp' : 'bank_card' }
    };

    let response;
    try {
        response = await fetchImpl(API_URL, {
            method: 'POST',
            headers: {
                Authorization: getAuthorizationHeader(env),
                'Content-Type': 'application/json',
                'Idempotence-Key': requestId || crypto.randomUUID()
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(10000)
        });
    } catch (cause) {
        const error = new Error('Не удалось подтвердить создание платежа.');
        error.paymentMayExist = true;
        error.cause = cause;
        throw error;
    }
    const result = await response.json().catch(() => null);
    if (!response.ok) {
        console.error('YooKassa payment creation failed:', response.status, result?.type || 'provider_error');
        const error = new Error('Не удалось создать платёж.');
        error.paymentMayExist = response.status >= 500;
        throw error;
    }

    const paymentId = typeof result?.id === 'string' && /^[a-zA-Z0-9_-]{1,120}$/.test(result.id)
        ? result.id
        : '';
    const confirmationUrl = result?.confirmation?.confirmation_url;
    if (!paymentId || !isSafeConfirmationUrl(confirmationUrl) ||
        result?.status !== 'pending') {
        console.error('YooKassa returned an unexpected payment response.');
        const error = new Error('Платёж создан, но платёжная ссылка не получена. Обратитесь в поддержку.');
        error.paymentMayExist = true;
        if (paymentId) error.paymentId = paymentId;
        throw error;
    }

    return {
        id: paymentId,
        status: result.status,
        confirmationUrl,
        amount: payload.amount
    };
}

async function getPayment({ env = process.env, fetch: fetchImpl = global.fetch, paymentId }) {
    if (typeof paymentId !== 'string' || !/^[a-zA-Z0-9_-]{1,120}$/.test(paymentId)) {
        throw new Error('Invalid YooKassa payment ID.');
    }
    const response = await fetchImpl(`${API_URL}/${encodeURIComponent(paymentId)}`, {
        headers: { Authorization: getAuthorizationHeader(env) },
        signal: AbortSignal.timeout(10000)
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) {
        console.error('YooKassa payment verification failed:', response.status, result?.type || 'provider_error');
        throw new Error('Не удалось проверить статус платежа.');
    }
    return result;
}

module.exports = { createPayment, getPayment, isYooKassaConfigured };
