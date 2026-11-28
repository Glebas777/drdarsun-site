const express = require('express');
const crypto = require('crypto');

const BOT_ROLES = new Set(['admin', 'support', 'client']);

function createTelegramWebhookApi(options = {}) {
    const router = express.Router();
    const env = options.env || process.env;
    const request = options.fetch || fetch;
    const processUpdate = options.processTelegramUpdate;
    const getBotState = options.getBotState;
    const setBotState = options.setBotState;

    async function databaseRequest(path, init = {}) {
        const supabaseUrl = env.SUPABASE_URL?.replace(/\/$/, '');
        const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
        if (!supabaseUrl || !serviceRoleKey) throw new Error('Telegram webhook database configuration is missing.');
        const response = await request(`${supabaseUrl}/rest/v1/${path}`, {
            ...init,
            headers: {
                apikey: serviceRoleKey,
                Authorization: `Bearer ${serviceRoleKey}`,
                'Content-Type': 'application/json',
                ...(init.headers || {})
            },
            signal: AbortSignal.timeout(10000)
        });
        const result = await response.json().catch(() => null);
        if (!response.ok) {
            const databaseError = {
                resource: path.split('?')[0],
                status: response.status,
                code: typeof result?.code === 'string' ? result.code.slice(0, 40) : undefined,
                message: typeof result?.message === 'string' ? result.message.slice(0, 240) : undefined
            };
            console.error('Telegram webhook database request failed:', databaseError);
            throw new Error(`Telegram webhook database request failed (${response.status}${databaseError.code ? ` ${databaseError.code}` : ''}).`);
        }
        return result;
    }

    function secretMatches(suppliedSecret) {
        const sharedSecret = env.TELEGRAM_WORKER_SHARED_SECRET || '';
        if (!sharedSecret) return false;
        return crypto.timingSafeEqual(
            crypto.createHash('sha256').update(suppliedSecret).digest(),
            crypto.createHash('sha256').update(sharedSecret).digest()
        );
    }

    function configuredOwnerChatId(role) {
        if (role !== 'admin') return '';
        return String(env.MY_CHAT_ID || env.PANEL_CHAT_ID || env.M_CHAT_ID || '').trim();
    }

    router.post('/:role', async (req, res) => {
        const role = req.params.role;
        const update = req.body;
        const updateId = Number(update?.update_id);
        if (!secretMatches(req.get('X-Telegram-Worker-Secret') || '')) {
            return res.status(401).json({ error: 'Unauthorized webhook sender.' });
        }
        if (!BOT_ROLES.has(role) || !Number.isSafeInteger(updateId) || updateId < 0) {
            return res.status(400).json({ error: 'Invalid Telegram update.' });
        }
        if (typeof processUpdate !== 'function' ||
            (role !== 'client' && (typeof getBotState !== 'function' ||
                typeof setBotState !== 'function'))) {
            console.error('Telegram webhook API is missing its update processor.');
            return res.status(503).json({ error: 'Telegram update processor is unavailable.' });
        }

        const message = update.message || update.callback_query?.message;
        const chatId = message?.chat?.id === undefined ? '' : String(message.chat.id);
        if (message?.chat?.type !== 'private') {
            return res.status(200).json({ ok: true, ignored: true });
        }
        if (role === 'admin' && chatId !== configuredOwnerChatId(role)) {
            return res.status(200).json({ ok: true, ignored: true });
        }

        if (role === 'client') {
            try {
                await processUpdate(role, update, { env, fetch: request, retryOnFailure: true });
                return res.status(200).json({ ok: true });
            } catch (error) {
                console.error('Client Telegram webhook update failed:', {
                    updateId,
                    errorType: error instanceof Error ? error.name : 'UnknownError'
                });
                return res.status(503).json({ error: 'Telegram update processing failed.' });
            }
        }

        let stage = 'claim-update';
        let updateClaimed = false;
        try {
            const claimed = await databaseRequest('rpc/claim_telegram_webhook_update', {
                method: 'POST',
                body: JSON.stringify({ p_bot_role: role, p_update_id: updateId })
            });
            if (claimed === 'completed') return res.status(200).json({ ok: true, duplicate: true });
            if (claimed !== 'claimed') return res.status(200).json({ ok: true, duplicate: true, processing: true });
            updateClaimed = true;

            const needsConversationState = role !== 'client' && chatId && message?.chat?.type === 'private';
            if (needsConversationState) {
                stage = 'load-conversation-state';
                const stateKey = `bot_role=eq.${encodeURIComponent(role)}&telegram_chat_id=eq.${encodeURIComponent(chatId)}&select=state&limit=1`;
                const [storedState] = await databaseRequest(`telegram_bot_states?${stateKey}`);
                setBotState(role, chatId, storedState?.state || {});
            }

            stage = 'process-bot-update';
            await processUpdate(role, update, { env, fetch: request, retryOnFailure: true });

            if (needsConversationState) {
                stage = 'save-conversation-state';
                await databaseRequest('telegram_bot_states?on_conflict=bot_role,telegram_chat_id', {
                    method: 'POST',
                    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
                    body: JSON.stringify({
                        bot_role: role,
                        telegram_chat_id: chatId,
                        state: getBotState(role, chatId),
                        updated_at: new Date().toISOString()
                    })
                });
            }
            stage = 'complete-update';
            const completed = await databaseRequest('rpc/complete_telegram_webhook_update', {
                method: 'POST',
                body: JSON.stringify({ p_bot_role: role, p_update_id: updateId })
            });
            if (completed !== true) throw new Error('Telegram webhook update was not marked complete.');
            return res.status(200).json({ ok: true });
        } catch (error) {
            console.error('Telegram webhook update failed:', {
                role,
                updateId,
                stage,
                error: error?.message || 'Unknown error'
            });
            res.setHeader('Retry-After', '5');
            if (updateClaimed) {
                await databaseRequest('rpc/retry_telegram_webhook_update', {
                    method: 'POST',
                    body: JSON.stringify({ p_bot_role: role, p_update_id: updateId })
                }).catch(retryError => console.error('Telegram webhook retry state update failed:', retryError));
            }
            return res.status(503).json({ error: 'Telegram update could not be processed.' });
        }
    });

    return router;
}

module.exports = createTelegramWebhookApi;
