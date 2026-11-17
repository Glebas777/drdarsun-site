import { supabase } from './supabase-client.js';

const API_URL = 'https://drdarsun-site-main.layero.app/api/qr-login';
const QR_PREFIX = 'drdarsun-qr-login:';

async function readResponse(response) {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(body.error || 'Не удалось выполнить действие с QR-кодом.');
    }
    return body;
}

export async function createQrLoginRequest() {
    const response = await fetch(API_URL, { method: 'POST' });
    const request = await readResponse(response);
    return { ...request, qrText: `${QR_PREFIX}${request.id}` };
}

export async function cancelQrLoginRequest(request) {
    if (!request?.id || !request?.pollSecret) return;
    await fetch(`${API_URL}/${encodeURIComponent(request.id)}`, {
        method: 'DELETE',
        headers: { 'X-QR-Poll-Token': request.pollSecret }
    });
}

export async function waitForQrLoginApproval(request, signal) {
    while (!signal.aborted) {
        const response = await fetch(`${API_URL}/${encodeURIComponent(request.id)}`, {
            headers: { 'X-QR-Poll-Token': request.pollSecret },
            signal
        });
        const result = await readResponse(response);

        if (result.status === 'approved') return result;
        if (result.status === 'expired') throw new Error('Время действия QR-кода истекло. Создайте новый.');

        await new Promise((resolve, reject) => {
            const timeout = setTimeout(resolve, 5000);
            signal.addEventListener('abort', () => {
                clearTimeout(timeout);
                reject(new DOMException('Отменено', 'AbortError'));
            }, { once: true });
        });
    }
    return null;
}

export async function completeQrLogin(approval) {
    const { error } = await supabase.auth.verifyOtp({
        email: approval.email,
        token: approval.emailOtp,
        type: 'magiclink'
    });
    if (error) throw error;
}

export async function approveQrLogin(id) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Сначала войдите в аккаунт на этом телефоне.');

    const response = await fetch(`${API_URL}/${encodeURIComponent(id)}/approve`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({})
    });
    return readResponse(response);
}

export function getQrLoginId(value) {
    if (typeof value !== 'string' || !value.startsWith(QR_PREFIX)) {
        throw new Error('Это не QR-код для входа Dr. DarSun.');
    }
    const id = value.slice(QR_PREFIX.length);
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('QR-код повреждён или недействителен.');
    return id;
}

export async function startQrScanner(elementId, onScan, onError) {
    if (!window.Html5Qrcode) throw new Error('Сканер QR-кодов не загрузился. Обновите страницу.');
    const scanner = new Html5Qrcode(elementId);
    let handled = false;
    let cleared = false;

    const stop = async () => {
        if (scanner.isScanning) await scanner.stop();
        if (!cleared) {
            scanner.clear();
            cleared = true;
        }
    };

    await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: 250 },
        async (decodedText) => {
            if (handled) return;
            handled = true;
            try {
                await stop();
                await onScan(decodedText);
            } catch (error) {
                onError(error);
            }
        },
        () => {}
    );

    return stop;
}
