const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { once } = require('node:events');
const createReviewsApi = require('../reviews-api');

const userId = '95d4d36a-1f12-4aa4-91d2-8e51a6fd6e18';
const productId = 'd47107ec-e078-4e16-a52d-bd1f6c650591';

async function withRouter(options, run) {
    const app = express();
    app.use(express.json());
    app.use('/api/reviews', createReviewsApi(options));
    const server = app.listen(0);
    await once(server, 'listening');
    try {
        await run(`http://127.0.0.1:${server.address().port}/api/reviews`);
    } finally {
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
}

function createEnv() {
    return {
        SUPABASE_URL: 'https://supabase.example',
        SUPABASE_ANON_KEY: 'anon-key',
        SUPABASE_SERVICE_ROLE_KEY: 'service-key',
        REVIEW_MODERATOR_USER_ID: userId
    };
}

function authResponse(url) {
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: userId });
    return null;
}

test('product reviews are authenticated, validated, and queued as pending', async () => {
    const requests = [];
    await withRouter({
        env: createEnv(),
        fetch: async (url, init = {}) => {
            const parsedUrl = new URL(String(url));
            requests.push({ url: parsedUrl, init });
            const auth = authResponse(parsedUrl.href);
            if (auth) return auth;
            if (parsedUrl.pathname.endsWith('/products')) return Response.json([{ id: productId }]);
            if (parsedUrl.pathname.endsWith('/brand_reviews')) {
                if ((init.method || 'GET').toUpperCase() === 'POST') {
                    return Response.json([{
                        id: 'a03ef3dd-f7d8-4581-9c58-b2a392f98c96',
                        created_at: '2026-01-01T00:00:00Z',
                        product_id: productId
                    }]);
                }
                return Response.json([]);
            }
            throw new Error(`Unexpected request: ${parsedUrl.href}`);
        }
    }, async baseUrl => {
        const response = await fetch(`${baseUrl}/submit`, {
            method: 'POST',
            headers: { Authorization: 'Bearer user-token', 'Content-Type': 'application/json' },
            body: JSON.stringify({
                product_id: productId,
                user_name: 'Покупатель',
                rating: 5
            })
        });
        assert.equal(response.status, 201);
        assert.deepEqual(await response.json(), {
            success: true,
            review: {
                id: 'a03ef3dd-f7d8-4581-9c58-b2a392f98c96',
                created_at: '2026-01-01T00:00:00Z',
                product_id: productId
            }
        });
    });

    const insertRequest = requests.find(request =>
        request.url.pathname.endsWith('/brand_reviews') &&
        (request.init.method || 'GET').toUpperCase() === 'POST');
    assert.ok(insertRequest);
    assert.deepEqual(JSON.parse(insertRequest.init.body), {
        user_id: userId,
        user_name: 'Покупатель',
        rating: 5,
        review_text: null,
        product_id: productId,
        status: 'pending'
    });
});

test('book reviews require and store written feedback', async () => {
    let insertedReview;
    await withRouter({
        env: createEnv(),
        fetch: async (url, init = {}) => {
            const parsedUrl = new URL(String(url));
            const auth = authResponse(parsedUrl.href);
            if (auth) return auth;
            if (parsedUrl.pathname.endsWith('/brand_reviews')) {
                if ((init.method || 'GET').toUpperCase() === 'POST') {
                    insertedReview = JSON.parse(init.body);
                    return Response.json([{
                        id: 'a03ef3dd-f7d8-4581-9c58-b2a392f98c96',
                        created_at: '2026-01-01T00:00:00Z',
                        product_id: null
                    }]);
                }
                return Response.json([]);
            }
            throw new Error(`Unexpected request: ${parsedUrl.href}`);
        }
    }, async baseUrl => {
        const missingText = await fetch(`${baseUrl}/submit`, {
            method: 'POST',
            headers: { Authorization: 'Bearer user-token', 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_name: 'Покупатель', rating: 5 })
        });
        assert.equal(missingText.status, 400);

        const response = await fetch(`${baseUrl}/submit`, {
            method: 'POST',
            headers: { Authorization: 'Bearer user-token', 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user_name: 'Покупатель',
                rating: 4,
                review_text: 'Масло понравилось, буду заказывать ещё.'
            })
        });
        assert.equal(response.status, 201);
    });

    assert.deepEqual(insertedReview, {
        user_id: userId,
        user_name: 'Покупатель',
        rating: 4,
        review_text: 'Масло понравилось, буду заказывать ещё.',
        product_id: null,
        status: 'pending'
    });
});

test('book review fills an existing pending rating that had no text', async () => {
    let updatedReview;
    const existingId = 'a03ef3dd-f7d8-4581-9c58-b2a392f98c96';
    await withRouter({
        env: createEnv(),
        fetch: async (url, init = {}) => {
            const parsedUrl = new URL(String(url));
            const auth = authResponse(parsedUrl.href);
            if (auth) return auth;
            if (parsedUrl.pathname.endsWith('/brand_reviews')) {
                if ((init.method || 'GET').toUpperCase() === 'PATCH') {
                    updatedReview = JSON.parse(init.body);
                    return Response.json([{ id: existingId, ...updatedReview }]);
                }
                return Response.json([{ id: existingId, status: 'pending', review_text: null }]);
            }
            throw new Error(`Unexpected request: ${parsedUrl.href}`);
        }
    }, async baseUrl => {
        const response = await fetch(`${baseUrl}/submit`, {
            method: 'POST',
            headers: { Authorization: 'Bearer user-token', 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user_name: 'Покупатель',
                rating: 4,
                review_text: 'Масло понравилось, буду заказывать ещё.'
            })
        });
        assert.equal(response.status, 201);
    });

    assert.equal(updatedReview.review_text, 'Масло понравилось, буду заказывать ещё.');
});

test('product reviews reject invalid IDs and nonexistent products without inserting', async () => {
    let insertCount = 0;
    await withRouter({
        env: createEnv(),
        fetch: async url => {
            const auth = authResponse(String(url));
            if (auth) return auth;
            if (String(url).includes('/products?')) return Response.json([]);
            if (String(url).includes('/brand_reviews')) insertCount++;
            throw new Error(`Unexpected request: ${url}`);
        }
    }, async baseUrl => {
        const invalid = await fetch(`${baseUrl}/submit`, {
            method: 'POST',
            headers: { Authorization: 'Bearer user-token', 'Content-Type': 'application/json' },
            body: JSON.stringify({ product_id: 123, user_name: 'Покупатель', rating: 5, review_text: 'Достаточно длинный текст отзыва для теста.' })
        });
        assert.equal(invalid.status, 400);

        const missing = await fetch(`${baseUrl}/submit`, {
            method: 'POST',
            headers: { Authorization: 'Bearer user-token', 'Content-Type': 'application/json' },
            body: JSON.stringify({ product_id: productId, user_name: 'Покупатель', rating: 5, review_text: 'Достаточно длинный текст отзыва для теста.' })
        });
        assert.equal(missing.status, 404);
    });
    assert.equal(insertCount, 0);
});

test('moderation queue identifies product reviews and their product names', async () => {
    await withRouter({
        env: createEnv(),
        fetch: async (url) => {
            const parsedUrl = new URL(String(url));
            const auth = authResponse(parsedUrl.href);
            if (auth) return auth;
            if (parsedUrl.pathname.endsWith('/brand_reviews')) {
                return Response.json([
                    { id: 'f3221871-8970-4b6f-8845-00f15f35135f', product_id: productId, review_text: 'Отличный продукт.' },
                    { id: 'bf314ee6-d1f8-45a6-82cf-7532c0878705', product_id: null }
                ]);
            }
            if (parsedUrl.pathname.endsWith('/products')) {
                return Response.json([{ id: productId, name: 'Масло миндальное' }]);
            }
            throw new Error(`Unexpected request: ${parsedUrl.href}`);
        }
    }, async baseUrl => {
        const response = await fetch(`${baseUrl}/moderation`, {
            headers: { Authorization: 'Bearer moderator-token' }
        });
        assert.equal(response.status, 200);
        const result = await response.json();
        assert.equal(result.reviews[0].product_name, 'Масло миндальное');
        assert.equal(result.reviews[0].review_text, 'Отличный продукт.');
        assert.equal(result.reviews[1].product_name, null);
    });
});
