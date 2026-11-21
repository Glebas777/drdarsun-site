const BOT_ROLES = {
    admin: { token: 'ADMIN_BOT_TOKEN', webhookSecret: 'ADMIN_WEBHOOK_SECRET' }
};
const BOT_ROLE_ORDER = ['admin'];

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

function activeRoles(env) {
    const configuredRoles = String(env.WORKER_ROLES || '')
        .split(',')
        .map(role => role.trim())
        .filter(Boolean);
    if (!configuredRoles.length) return BOT_ROLE_ORDER;
    return BOT_ROLE_ORDER.filter(role => configuredRoles.includes(role));
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

function expectedWebhookUrl(env, role) {
    try {
        const url = new URL(env.TELEGRAM_WORKER_PUBLIC_URL);
        if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash ||
            url.username || url.password) return null;
        return new URL(`/telegram/${role}`, url).toString();
    } catch {
        return null;
    }
}

async function telegramRequest(token, method, payload, fetchImpl) {
    const response = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000)
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.ok) {
        throw new Error(`Telegram ${method} failed with status ${response.status}.`);
    }
    return result.result;
}

export async function sendToUser(role, chatId, text, extra = {}, env, fetchImpl = fetch) {
    const config = BOT_ROLES[role];
    if (!config) throw new Error('Unknown Telegram bot role.');
    const token = env[config.token];
    if (!token) throw new Error(`The ${role} bot is not configured.`);
    return telegramRequest(token, 'sendMessage', {
        chat_id: chatId,
        text,
        ...extra
    }, fetchImpl);
}

async function forwardUpdateToLayero(role, update, env, fetchImpl) {
    const backendUrl = configuredLayeroUrl(env);
    const sharedSecret = env.TELEGRAM_WORKER_SHARED_SECRET || '';
    if (!backendUrl) throw new Error('Layero API base URL is missing or invalid.');
    if (sharedSecret.length < 32) throw new Error('Worker shared secret is missing or too short.');
    return fetchImpl(new URL(`/api/telegram/webhook/${role}`, backendUrl), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Telegram-Worker-Secret': sharedSecret
        },
        body: typeof update === 'string' ? update : JSON.stringify(update),
        signal: AbortSignal.timeout(25000)
    });
}

async function manageWebhooks(request, env, fetchImpl, action) {
    const suppliedSecret = request.headers.get('X-Admin-Secret') || '';
    const adminSecret = env.WEBHOOK_ADMIN_SECRET || '';
    if (!adminSecret || !constantTimeEqual(suppliedSecret, adminSecret)) {
        return jsonResponse(401, { error: 'Unauthorized.' });
    }

    const publicUrl = new URL(env.TELEGRAM_WORKER_PUBLIC_URL);
    if (publicUrl.protocol !== 'https:' || publicUrl.pathname !== '/' ||
        publicUrl.search || publicUrl.hash || publicUrl.username || publicUrl.password) {
        return jsonResponse(503, { error: 'Set TELEGRAM_WORKER_PUBLIC_URL to the deployed HTTPS Worker origin.' });
    }

    const roles = activeRoles(env);
    const results = [];
    for (const role of roles) {
        const config = BOT_ROLES[role];
        const token = env[config.token];
        if (!token) {
            results.push({ role, configured: false, success: false });
            continue;
        }
        const webhookSecret = env[config.webhookSecret] || '';
        if (!TELEGRAM_SECRET_PATTERN.test(webhookSecret)) {
            results.push({ role, configured: true, success: false, error: `${config.webhookSecret} is missing or invalid.` });
            continue;
        }
        try {
            if (action === 'register') {
                await telegramRequest(token, 'setWebhook', {
                    url: new URL(`/telegram/${role}`, publicUrl).toString(),
                    secret_token: webhookSecret,
                    allowed_updates: ['message', 'callback_query'],
                    max_connections: 10,
                    drop_pending_updates: false
                }, fetchImpl);
            } else {
                await telegramRequest(token, 'deleteWebhook', { drop_pending_updates: false }, fetchImpl);
            }
            results.push({ role, configured: true, success: true });
        } catch (error) {
            results.push({ role, configured: true, success: false, error: error.message });
        }
    }
    const failed = results.some(result => !result.success);
    return jsonResponse(failed ? 502 : 200, {
        action,
        success: !failed,
        results
    });
}

function workerDiagnostics(env) {
    const bots = Object.fromEntries(BOT_ROLE_ORDER.map(role => {
        if (!activeRoles(env).includes(role)) return null;
        const config = BOT_ROLES[role];
        const tokenConfigured = Boolean(env[config.token]);
        const webhookSecretValid = TELEGRAM_SECRET_PATTERN.test(env[config.webhookSecret] || '');
        return [role, { configured: tokenConfigured && webhookSecretValid, tokenConfigured, webhookSecretValid }];
    }).filter(Boolean));
    const roles = activeRoles(env);
    const backend = Boolean(configuredLayeroUrl(env)) &&
        typeof env.TELEGRAM_WORKER_SHARED_SECRET === 'string' &&
        env.TELEGRAM_WORKER_SHARED_SECRET.length >= 32;
    const publicUrl = roles.length > 0 && Boolean(expectedWebhookUrl(env, roles[0]));
    return {
        ok: backend && publicUrl && roles.every(role => bots[role]?.configured),
        backend,
        publicUrl,
        roles,
        bots
    };
}

export function createHandler(env, fetchImpl = fetch) {
    return async function handleRequest(request) {
        const url = new URL(request.url);

        if (url.pathname === '/admin/health') {
            if (request.method !== 'GET') return jsonResponse(405, { error: 'Method not allowed.' });
            const suppliedSecret = request.headers.get('X-Admin-Secret') || '';
            if (!env.WEBHOOK_ADMIN_SECRET || !constantTimeEqual(suppliedSecret, env.WEBHOOK_ADMIN_SECRET)) {
                return jsonResponse(401, { error: 'Unauthorized.' });
            }
            const diagnostics = workerDiagnostics(env);
            return jsonResponse(diagnostics.ok ? 200 : 503, diagnostics);
        }

        if (url.pathname === '/admin/register' || url.pathname === '/admin/remove') {
            if (url.pathname === '/admin/register' && request.method !== 'GET' && request.method !== 'POST') {
                return jsonResponse(405, { error: 'Method not allowed.' });
            }
            if (url.pathname === '/admin/remove' && request.method !== 'POST') {
                return jsonResponse(405, { error: 'Method not allowed.' });
            }
            const action = url.pathname.endsWith('/register') ? 'register' : 'remove';
            return manageWebhooks(request, env, fetchImpl, action);
        }

        const match = /^\/telegram\/(admin)$/.exec(url.pathname);
        if (!match) return jsonResponse(404, { error: 'Not found.' });
        if (request.method !== 'POST') return jsonResponse(405, { error: 'Method not allowed.' });

        const role = match[1];
        if (!activeRoles(env).includes(role)) {
            return jsonResponse(404, { error: 'Role not served by this Worker.' });
        }
        const config = BOT_ROLES[role];
        const webhookSecret = env[config.webhookSecret] || '';
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

        let backendResponse;
        try {
            backendResponse = await forwardUpdateToLayero(role, rawBody, env, fetchImpl);
        } catch (error) {
            console.error(`Layero forward failed for ${role}:`, error?.message || error?.name || 'RequestError');
            return jsonResponse(503, { error: 'Bot backend temporarily unavailable; Telegram should retry this update.' });
        }
        if (!backendResponse.ok) {
            console.error(`Layero returned ${backendResponse.status} for ${role}.`);
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
