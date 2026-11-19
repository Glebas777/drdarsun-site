const express = require('express');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

function createReviewsApi(options = {}) {
    const router = express.Router();
    const env = options.env || process.env;
    const request = options.fetch || fetch;
    const supabaseUrl = env.SUPABASE_URL?.replace(/\/$/, '');
    const anonKey = env.SUPABASE_ANON_KEY;
    const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

    async function requireModerator(req, res, next) {
        const authorization = req.get('Authorization') || '';
        if (!authorization.startsWith('Bearer ') || !supabaseUrl || !anonKey) {
            return res.status(401).json({ error: 'Войдите в аккаунт для проверки прав модератора.' });
        }
        if (!env.REVIEW_MODERATOR_USER_ID) {
            return res.status(503).json({ error: 'Модератор отзывов ещё не настроен.' });
        }

        try {
            const response = await request(`${supabaseUrl}/auth/v1/user`, {
                headers: { apikey: anonKey, Authorization: authorization }
            });
            const user = await response.json().catch(() => null);
            if (!response.ok || !user?.id) return res.status(401).json({ error: 'Сессия истекла. Войдите снова.' });
            if (user.id !== env.REVIEW_MODERATOR_USER_ID) {
                return res.status(403).json({ error: 'Нет прав модератора отзывов.' });
            }
            req.reviewModerator = user;
            next();
        } catch (error) {
            console.error('Review moderator validation failed:', error);
            res.status(503).json({ error: 'Не удалось проверить права модератора.' });
        }
    }

    async function databaseRequest(path, init = {}) {
        if (!supabaseUrl || !serviceRoleKey) throw new Error('Review database configuration is missing.');
        const response = await request(`${supabaseUrl}/rest/v1/${path}`, {
            ...init,
            headers: {
                apikey: serviceRoleKey,
                Authorization: `Bearer ${serviceRoleKey}`,
                'Content-Type': 'application/json',
                ...(init.headers || {})
            }
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) {
            console.error('Review database request failed:', response.status, data?.message || data?.code || 'Unknown error');
            throw new Error('Review database request failed.');
        }
        return data;
    }

    async function getAuthenticatedUser(authorization) {
        if (!authorization.startsWith('Bearer ') || !supabaseUrl || !anonKey) return null;
        const response = await request(`${supabaseUrl}/auth/v1/user`, {
            headers: { apikey: anonKey, Authorization: authorization },
            signal: AbortSignal.timeout(8000)
        });
        const user = await response.json().catch(() => null);
        return response.ok && user?.id ? user : null;
    }

    router.post('/submit', async (req, res) => {
        const authorization = req.get('Authorization') || '';
        if (!supabaseUrl || !anonKey || !serviceRoleKey) {
            return res.status(503).json({ error: 'Отправка отзывов временно недоступна.' });
        }
        const rating = Number(req.body?.rating);
        const reviewText = typeof req.body?.review_text === 'string' ? req.body.review_text.trim() : '';
        const userName = typeof req.body?.user_name === 'string' ? req.body.user_name.trim() : '';
        if (!Number.isInteger(rating) || rating < 1 || rating > 5 ||
            reviewText.length < 20 || reviewText.length > 2000 ||
            !userName || userName.length > 60 ||
            /[\u0000-\u001f\u007f]/.test(userName) ||
            /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(reviewText)) {
            return res.status(400).json({ error: 'Укажите имя до 60 символов, оценку от 1 до 5 и отзыв от 20 до 2000 символов.' });
        }

        try {
            const user = await getAuthenticatedUser(authorization);
            if (!user) return res.status(401).json({ error: 'Войдите в аккаунт, чтобы оставить отзыв.' });
            const [review] = await databaseRequest('brand_reviews?select=id,created_at', {
                method: 'POST',
                headers: { Prefer: 'return=representation' },
                body: JSON.stringify({
                    user_id: user.id,
                    user_name: userName,
                    rating,
                    review_text: reviewText,
                    status: 'pending'
                })
            });
            if (!review?.id) throw new Error('Review submission was not saved.');
            res.status(201).json({ success: true, review });
        } catch (error) {
            console.error('Review submission failed:', error);
            res.status(503).json({ error: 'Не удалось отправить отзыв. Попробуйте позже.' });
        }
    });

    router.get('/moderation', requireModerator, async (req, res) => {
        try {
            const reviews = await databaseRequest(
                'brand_reviews?select=id,user_id,user_name,rating,review_text,created_at&status=eq.pending&order=created_at.asc&limit=100'
            );
            res.setHeader('Cache-Control', 'no-store');
            res.json({ reviews });
        } catch (error) {
            console.error('Pending reviews lookup failed:', error);
            res.status(503).json({ error: 'Не удалось загрузить отзывы на модерацию.' });
        }
    });

    router.patch('/moderation/:id', requireModerator, async (req, res) => {
        if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(req.params.id || '')) {
            return res.status(400).json({ error: 'Некорректный номер отзыва.' });
        }
        const status = req.body?.status;
        if (!['approved', 'rejected'].includes(status)) {
            return res.status(400).json({ error: 'Выберите «одобрить» или «отклонить».' });
        }

        try {
            const updated = await databaseRequest(`brand_reviews?id=eq.${req.params.id}&status=eq.pending`, {
                method: 'PATCH',
                headers: { Prefer: 'return=representation' },
                body: JSON.stringify({ status, updated_at: new Date().toISOString() })
            });
            if (!updated?.length) return res.status(409).json({ error: 'Отзыв уже обработан или удалён.' });
            res.json({ success: true });
        } catch (error) {
            console.error('Review moderation update failed:', error);
            res.status(503).json({ error: 'Не удалось сохранить решение модерации.' });
        }
    });

    return router;
}

module.exports = createReviewsApi;
