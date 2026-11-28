const express = require('express');

const READ_CACHE_TTL_MS = 15_000;

function createVisitorCounterRouter(options = {}) {
    const router = express.Router();
    const env = options.env || process.env;
    const request = options.fetch || fetch;
    const supabaseUrl = env.SUPABASE_URL?.replace(/\/$/, '');
    const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
    let cachedCount = null;
    let cacheExpiresAt = 0;
    let readInFlight = null;
    let updateVersion = 0;

    async function databaseRequest(rpc, body = {}) {
        if (!supabaseUrl || !serviceRoleKey) {
            throw new Error('Visitor counter database configuration is missing.');
        }
        const response = await request(`${supabaseUrl}/rest/v1/rpc/${rpc}`, {
            method: 'POST',
            headers: {
                apikey: serviceRoleKey,
                Authorization: `Bearer ${serviceRoleKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(5000)
        });
        const result = await response.json().catch(() => null);
        const count = typeof result === 'number' || typeof result === 'string' ? Number(result) : NaN;
        if (!response.ok || !Number.isSafeInteger(count) || count < 0) {
            console.error('Visitor counter database request failed:', response.status);
            throw new Error('Visitor counter database request failed.');
        }
        return count;
    }

    async function getCount() {
        if (cachedCount !== null && cacheExpiresAt > Date.now()) return cachedCount;
        if (readInFlight) return readInFlight;
        const requestVersion = updateVersion;
        readInFlight = databaseRequest('get_site_visitors_today').then(count => {
            if (requestVersion !== updateVersion && cachedCount !== null) return cachedCount;
            cachedCount = count;
            cacheExpiresAt = Date.now() + READ_CACHE_TTL_MS;
            return count;
        }).finally(() => {
            readInFlight = null;
        });
        return readInFlight;
    }

    async function refreshCount() {
        const requestVersion = ++updateVersion;
        const count = await databaseRequest('get_site_visitors_today');
        if (requestVersion !== updateVersion && cachedCount !== null) return cachedCount;
        cachedCount = count;
        cacheExpiresAt = Date.now() + READ_CACHE_TTL_MS;
        return count;
    }

    router.get('/', async (req, res) => {
        try {
            const forceRefresh = req.query.refresh === '1';
            const count = forceRefresh ? await refreshCount() : await getCount();
            if (forceRefresh) {
                res.setHeader('Cache-Control', 'no-store');
                return res.json({ count, period: 'today' });
            }
            res.setHeader('Cache-Control', 'public, max-age=3, s-maxage=10');
            res.json({ count, period: 'today' });
        } catch (error) {
            console.error('Visitor count lookup failed:', error.message);
            res.status(503).json({ error: 'Счётчик посетителей временно недоступен.' });
        }
    });

    router.post('/', async (_req, res) => {
        try {
            const count = await databaseRequest('record_site_visitor', {
                p_visit_date: new Date().toISOString().slice(0, 10)
            });
            updateVersion++;
            cachedCount = count;
            cacheExpiresAt = Date.now() + READ_CACHE_TTL_MS;
            res.setHeader('Cache-Control', 'no-store');
            res.json({ count, period: 'today' });
        } catch (error) {
            console.error('Visitor count update failed:', error.message);
            res.status(503).json({ error: 'Не удалось обновить счётчик посетителей.' });
        }
    });

    return router;
}

module.exports = createVisitorCounterRouter;
