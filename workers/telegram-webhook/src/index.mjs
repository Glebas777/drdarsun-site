const BOT_ROLES = {
    client: { token: 'CLIENT_BOT_TOKEN', webhookSecret: 'CLIENT_WEBHOOK_SECRET' },
    admin: { token: 'ADMIN_BOT_TOKEN', webhookSecret: 'ADMIN_WEBHOOK_SECRET' },
    panel: { token: 'PANEL_BOT_TOKEN', webhookSecret: 'PANEL_WEBHOOK_SECRET' },
    auth: { token: 'CODE_BOT_TOKEN', webhookSecret: 'AUTH_WEBHOOK_SECRET' },
    support: { token: 'HELP_BOT_TOKEN', webhookSecret: 'SUPPORT_WEBHOOK_SECRET' }
};

const encoder = new TextEncoder();
const MAX_UPDATE_BYTES = 256 * 1024;
const TELEGRAM_SECRET_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;

function jsonResponse(status, body) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store'
        }
    });
}

function constantTimeEqual(left, right) {
    if (typeof left !== 'string' || typeof right !== 'string') return false;
    const leftBytes = encoder.encode(left);
    const rightBytes = encoder.encode(right);
    let difference = leftBytes.length ^ rightBytes.length;
    const length = Math.max(leftBytes.length, rightBytes.length);
    for (let index = 0; index < length; index++) {
        difference |= (leftBytes[index] || 0) ^ (rightBytes[index] || 0);
    }
    return difference === 0;
}

function configuredLayeroUrl(env) {
    try {
        const url = new URL(env.LAYER0_API_BASE_URL);
        if (url.protocol !== 'https:' || url.username || url.password) return null;
        return url;
    } catch {
        return null;
    }
}

async function telegramRequest(token, method, payload, fetchImpl) {
    const response = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000)
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.ok) {
        throw new Error(`Telegram ${method} failed with status ${response.status}.`);
    }
    return result.result;
}

async function manageWebhooks(request, env, fetchImpl, action) {
    const adminSecret = env.WEBHOOK_ADMIN_SECRET || '';
    const suppliedSecret = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') || '';
    if (!adminSecret || !constantTimeEqual(suppliedSecret, adminSecret)) {
        return jsonResponse(401, { error: 'Unauthorized.' });
    }

    let publicUrl = null;
    if (action === 'register') {
        try {
            publicUrl = new URL(env.TELEGRAM_WORKER_PUBLIC_URL);
            if (publicUrl.protocol !== 'https:' || publicUrl.pathname !== '/' ||
                publicUrl.search || publicUrl.hash || publicUrl.username || publicUrl.password) {
                throw new Error('Invalid public worker URL.');
            }
        } catch {
            return jsonResponse(503, { error: 'Set TELEGRAM_WORKER_PUBLIC_URL to the deployed HTTPS Worker origin.' });
        }
    }

    const tokenRoles = new Map();
    for (const [role, config] of Object.entries(BOT_ROLES)) {
        const token = env[config.token];
        if (token) tokenRoles.set(token, [...(tokenRoles.get(token) || []), role]);
    }

    const duplicateRoles = new Map();
    for (const roles of tokenRoles.values()) {
        if (roles.length > 1) {
            for (const role of roles) duplicateRoles.set(role, true);
        }
    }

    const results = [];
    for (const [role, config] of Object.entries(BOT_ROLES)) {
        const token = env[config.token];
        if (!token) {
            results.push({ role, configured: false, success: false });
            continue;
        }
        if (duplicateRoles.has(role)) {
            results.push({ role, configured: true, success: false, error: 'Bot token is duplicated across roles.' });
            continue;
        }
        try {
            if (action === 'register') {
                const webhookSecret = env[config.webhookSecret] || '';
                if (!TELEGRAM_SECRET_PATTERN.test(webhookSecret)) {
                    throw new Error(`${config.webhookSecret} is missing or invalid.`);
                }
                await telegramRequest(token, 'setWebhook', {
                    url: new URL(`/telegram/${role}`, publicUrl).toString(),
                    secret_token: webhookSecret,
                    allowed_updates: ['message', 'callback_query'],
                    max_connections: 1,
                    drop_pending_updates: false
                }, fetchImpl);
            } else {
                await telegramRequest(token, 'deleteWebhook', { drop_pending_updates: false }, fetchImpl);
            }
            results.push({ role, configured: true, success: true });
        } catch (error) {
            console.error(`Webhook ${action} failed for ${role}:`, error.message);
            results.push({ role, configured: true, success: false });
        }
    }
    const failed = results.some(result => result.configured && !result.success);
    return jsonResponse(failed ? 502 : 200, { action, results });
}

export function createHandler(env, fetchImpl = fetch) {
    return async function handleRequest(request) {
        const url = new URL(request.url);
        if (url.pathname === '/admin/register-webhooks' || url.pathname === '/admin/remove-webhooks') {
            if (request.method !== 'POST') return jsonResponse(405, { error: 'Method not allowed.' });
            const action = url.pathname.endsWith('/register-webhooks') ? 'register' : 'remove';
            return manageWebhooks(request, env, fetchImpl, action);
        }

        const match = /^\/telegram\/(client|admin|panel|auth|support)$/.exec(url.pathname);
        if (!match) return jsonResponse(404, { error: 'Not found.' });
        if (request.method !== 'POST') return jsonResponse(405, { error: 'Method not allowed.' });

        const role = match[1];
        const token = env[BOT_ROLES[role].token];
        if (!token) return jsonResponse(503, { error: `The ${role} bot is not configured.` });

        const webhookSecret = env[BOT_ROLES[role].webhookSecret] || '';
        const suppliedSecret = request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '';
        if (!webhookSecret || !constantTimeEqual(suppliedSecret, webhookSecret)) {
            return jsonResponse(401, { error: 'Unauthorized webhook.' });
        }

        const contentLength = Number(request.headers.get('Content-Length') || 0);
        if (contentLength > MAX_UPDATE_BYTES) return jsonResponse(413, { error: 'Update too large.' });
        const rawBody = await request.text();
        if (encoder.encode(rawBody).byteLength > MAX_UPDATE_BYTES) {
            return jsonResponse(413, { error: 'Update too large.' });
        }

        let update;
        try {
            update = JSON.parse(rawBody);
        } catch {
            return jsonResponse(400, { error: 'Invalid JSON update.' });
        }
        if (!Number.isSafeInteger(update?.update_id) || update.update_id < 0) {
            return jsonResponse(400, { error: 'Invalid Telegram update ID.' });
        }

        const backendUrl = configuredLayeroUrl(env);
        const sharedSecret = env.TELEGRAM_WORKER_SHARED_SECRET || '';
        if (!backendUrl || sharedSecret.length < 32) {
            return jsonResponse(503, { error: 'Webhook backend is not configured.' });
        }

        let backendResponse;
        try {
            backendResponse = await fetchImpl(new URL(`/api/telegram/webhook/${role}`, backendUrl), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Telegram-Worker-Secret': sharedSecret
                },
                body: rawBody,
                signal: AbortSignal.timeout(25000)
            });
        } catch (error) {
            console.error(`Layero webhook handler unavailable for ${role}:`, error.name || 'RequestError');
            return jsonResponse(503, { error: 'Bot backend temporarily unavailable; Telegram should retry this update.' });
        }

        if (!backendResponse.ok) {
            console.error(`Layero webhook handler returned ${backendResponse.status} for ${role}.`);
            return jsonResponse(503, { error: 'Bot backend did not confirm the update; Telegram should retry it.' });
        }
        return jsonResponse(200, { ok: true });
    };
}

export default {
    fetch(request, env) {
        return createHandler(env)(request).catch(error => {
            console.error('Telegram webhook worker request failed:', error?.name || 'UnknownError');
            return jsonResponse(503, { error: 'Webhook temporarily unavailable; Telegram should retry.' });
        });
    }
};
