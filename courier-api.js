const express = require('express');
const createTelegramNotificationSender = require('./telegram-notifications');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function createCourierApi({ env = process.env, fetch: fetchImpl = global.fetch } = {}) {
    const router = express.Router();
    const sendTelegramNotification = createTelegramNotificationSender({ env, fetch: fetchImpl });

    async function notifyTelegramUser(userId, orderId, status) {
        if (!env.CLIENT_BOT_TOKEN) return;
        try {
            await sendTelegramNotification(userId, `Обновлён статус заказа №${orderId}: ${status}.`);
        } catch (error) {
            console.warn('Courier order Telegram notification was not delivered:', error.message);
        }
    }

    async function getActiveCourier(req, res) {
        const accessToken = (req.get('Authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1];
        if (!accessToken || accessToken.length > 4096) {
            res.status(401).json({ error: 'Войдите под аккаунтом курьера.' });
            return null;
        }

        const supabaseUrl = env.SUPABASE_URL?.replace(/\/$/, '');
        const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
        const apiKey = env.SUPABASE_ANON_KEY || serviceRoleKey;
        if (!supabaseUrl || !serviceRoleKey || !apiKey) {
            console.error('Courier API is unavailable: Supabase configuration is incomplete.');
            res.status(503).json({ error: 'Панель курьера временно недоступна.' });
            return null;
        }

        try {
            const userResponse = await fetchImpl(`${supabaseUrl}/auth/v1/user`, {
                headers: { apikey: apiKey, Authorization: `Bearer ${accessToken}` },
                signal: AbortSignal.timeout(8000)
            });
            if (userResponse.status === 401 || userResponse.status === 403) {
                res.status(401).json({ error: 'Сессия истекла. Войдите заново.' });
                return null;
            }
            if (!userResponse.ok) {
                console.error('Courier user verification failed:', userResponse.status);
                res.status(502).json({ error: 'Не удалось проверить вход. Попробуйте позже.' });
                return null;
            }
            const user = await userResponse.json();
            if (!UUID_PATTERN.test(user?.id || '')) {
                res.status(401).json({ error: 'Не удалось подтвердить аккаунт.' });
                return null;
            }

            const courierQuery = new URLSearchParams({
                select: 'user_id,name,phone,status',
                user_id: `eq.${user.id}`,
                status: 'eq.active',
                limit: '1'
            });
            const courierResponse = await fetchImpl(`${supabaseUrl}/rest/v1/couriers?${courierQuery}`, {
                headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
                signal: AbortSignal.timeout(8000)
            });
            const couriers = await courierResponse.json().catch(() => null);
            if (!courierResponse.ok || !Array.isArray(couriers)) {
                console.error('Courier role lookup failed:', courierResponse.status);
                res.status(502).json({ error: 'Не удалось проверить доступ курьера.' });
                return null;
            }
            if (!couriers[0]) {
                res.status(403).json({ error: 'Для аккаунта не включён доступ курьера.' });
                return null;
            }
            return { courier: couriers[0], supabaseUrl, serviceRoleKey };
        } catch (error) {
            console.error('Courier authentication failed:', error?.message || 'Unknown error');
            res.status(502).json({ error: 'Не удалось проверить сессию курьера.' });
            return null;
        }
    }

    async function readOrder(orderId, courierContext) {
        const { supabaseUrl, serviceRoleKey, courier } = courierContext;
        const query = new URLSearchParams({
            select: 'id,status,payment_method,courier_id',
            id: `eq.${orderId}`,
            or: `(courier_id.eq.${courier.user_id},and(courier_id.is.null,status.eq.pending,payment_method.eq.cash),and(courier_id.is.null,status.eq.paid,payment_method.in.(card,sbp)))`,
            limit: '1'
        });
        const response = await fetchImpl(`${supabaseUrl}/rest/v1/orders?${query}`, {
            headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
            signal: AbortSignal.timeout(8000)
        });
        const rows = await response.json().catch(() => null);
        if (!response.ok || !Array.isArray(rows)) {
            throw new Error(`Courier order lookup failed: ${response.status}`);
        }
        return rows[0] || null;
    }

    router.get('/orders', async (req, res) => {
        const context = await getActiveCourier(req, res);
        if (!context) return;

        const query = new URLSearchParams({
            select: 'id,customer_name,customer_phone,delivery_address,items,total,status,payment_method,created_at,courier_id',
            or: `(and(courier_id.eq.${context.courier.user_id},status.in.(accepted,in_transit,delivered)),and(courier_id.is.null,status.eq.pending,payment_method.eq.cash),and(courier_id.is.null,status.eq.paid,payment_method.in.(card,sbp)))`,
            order: 'created_at.asc',
            limit: '100'
        });
        try {
            const response = await fetchImpl(`${context.supabaseUrl}/rest/v1/orders?${query}`, {
                headers: { apikey: context.serviceRoleKey, Authorization: `Bearer ${context.serviceRoleKey}` },
                signal: AbortSignal.timeout(8000)
            });
            const orders = await response.json().catch(() => null);
            if (!response.ok || !Array.isArray(orders)) {
                console.error('Courier order list failed:', response.status);
                return res.status(502).json({ error: 'Не удалось загрузить заказы.' });
            }
            res.setHeader('Cache-Control', 'no-store');
            res.json({ orders });
        } catch (error) {
            console.error('Courier order list request failed:', error?.message || 'Unknown error');
            res.status(502).json({ error: 'Не удалось загрузить заказы.' });
        }
    });

    router.patch('/orders/:id', async (req, res) => {
        const context = await getActiveCourier(req, res);
        if (!context) return;

        const orderId = String(req.params.id || '');
        const nextStatus = req.body?.status;
        if (!/^[A-Za-z0-9_-]{1,120}$/.test(orderId) ||
            !['accepted', 'in_transit', 'delivered', 'paid'].includes(nextStatus)) {
            return res.status(400).json({ error: 'Некорректный заказ или статус.' });
        }

        try {
            const order = await readOrder(orderId, context);
            if (!order) return res.status(404).json({ error: 'Заказ недоступен этому курьеру.' });

            const isAvailable = !order.courier_id && (
                (order.status === 'pending' && order.payment_method === 'cash') ||
                (order.status === 'paid' && ['card', 'sbp'].includes(order.payment_method))
            );
            const transitions = {
                accepted: order.status === 'accepted' && order.courier_id === context.courier.user_id && nextStatus === 'in_transit',
                in_transit: order.status === 'in_transit' && order.courier_id === context.courier.user_id && nextStatus === 'delivered',
                delivered: order.status === 'delivered' && order.courier_id === context.courier.user_id &&
                    order.payment_method === 'cash' && nextStatus === 'paid'
            };
            if (!(isAvailable && nextStatus === 'accepted') && !transitions[order.status]) {
                return res.status(409).json({ error: 'Этот переход статуса сейчас недоступен.' });
            }

            const filters = new URLSearchParams({
                id: `eq.${orderId}`,
                status: `eq.${order.status}`,
                ...(isAvailable ? { courier_id: 'is.null' } : { courier_id: `eq.${context.courier.user_id}` })
            });
            const update = {
                status: nextStatus,
                ...(isAvailable ? { courier_id: context.courier.user_id } : {})
            };
            const response = await fetchImpl(`${context.supabaseUrl}/rest/v1/orders?${filters}&select=id,user_id,status,payment_method,courier_id`, {
                method: 'PATCH',
                headers: {
                    apikey: context.serviceRoleKey,
                    Authorization: `Bearer ${context.serviceRoleKey}`,
                    'Content-Type': 'application/json',
                    Prefer: 'return=representation'
                },
                body: JSON.stringify(update),
                signal: AbortSignal.timeout(8000)
            });
            const updated = await response.json().catch(() => null);
            if (!response.ok || !Array.isArray(updated)) {
                console.error('Courier order update failed:', response.status);
                return res.status(502).json({ error: 'Не удалось обновить заказ.' });
            }
            if (!updated[0]) return res.status(409).json({ error: 'Заказ уже изменён. Обновите список.' });
            await notifyTelegramUser(updated[0].user_id, updated[0].id, updated[0].status);
            res.setHeader('Cache-Control', 'no-store');
            res.json({ order: updated[0] });
        } catch (error) {
            console.error('Courier order update request failed:', error?.message || 'Unknown error');
            res.status(502).json({ error: 'Не удалось обновить заказ.' });
        }
    });

    return router;
}

module.exports = createCourierApi;
