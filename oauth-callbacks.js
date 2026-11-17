const express = require('express');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const AUTH_RETURN_URL = 'https://drdarsun.ru/auth/confirm.html';
const LOGIN_ERROR_URL = 'https://drdarsun.ru/login.html';
const OAUTH_STATE_PATTERN = /^[a-f0-9]{64}$/i;

function createOAuthCallbacksRouter(options = {}) {
    const router = express.Router();
    const env = options.env || process.env;
    const request = options.fetch || fetch;
    const supabaseUrl = env.SUPABASE_URL?.replace(/\/$/, '');
    const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

    async function requestJson(url, init) {
        const response = await request(url, {
            ...init,
            signal: init?.signal || AbortSignal.timeout(15000)
        });
        const data = await response.json().catch(() => null);
        return { response, data };
    }

    async function adminRequest(path, body) {
        if (!supabaseUrl || !serviceRoleKey) throw new Error('Supabase admin auth is not configured.');
        return requestJson(`${supabaseUrl}/auth/v1/admin/${path}`, {
            method: 'POST',
            headers: {
                apikey: serviceRoleKey,
                Authorization: `Bearer ${serviceRoleKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });
    }

    async function createLoginRedirect(email, name, provider, state) {
        let { response, data } = await adminRequest('generate_link', {
            type: 'magiclink',
            email,
            options: { redirect_to: AUTH_RETURN_URL }
        });

        if (!response.ok || !data?.hashed_token) {
            const errorCode = data?.code || data?.error_code || '';
            const errorMessage = data?.msg || data?.message || data?.error_description || '';
            const userNotFound = errorCode === 'user_not_found' ||
                (response.status === 404 && /not found/i.test(errorMessage));
            if (!userNotFound) {
                console.error('OAuth magic-link generation failed:', response.status, errorCode || errorMessage || 'Missing token hash');
                throw new Error('Не удалось создать ссылку входа.');
            }

            const created = await adminRequest('users', {
                email,
                email_confirm: true,
                user_metadata: { full_name: name }
            });
            const createCode = created.data?.code || created.data?.error_code || '';
            const createMessage = created.data?.msg || created.data?.message || created.data?.error_description || '';
            const existing = createCode === 'email_exists' || createCode === 'user_already_exists' ||
                /already (?:been )?(?:registered|exists)/i.test(createMessage);
            if (!created.response.ok && !existing) {
                console.error('OAuth user creation failed:', created.response.status, createCode || createMessage || 'Unknown error');
                throw new Error('Не удалось подготовить аккаунт для входа.');
            }

            ({ response, data } = await adminRequest('generate_link', {
                type: 'magiclink',
                email,
                options: { redirect_to: AUTH_RETURN_URL }
            }));
        }

        if (!response.ok || typeof data?.hashed_token !== 'string' || !data.hashed_token) {
            console.error('OAuth magic-link retry failed:', response.status, data?.code || data?.message || 'Missing token hash');
            throw new Error('Не удалось завершить вход. Запросите вход ещё раз.');
        }

        const query = new URLSearchParams({
            token_hash: data.hashed_token,
            type: 'magiclink',
            provider,
            state
        });
        return `${AUTH_RETURN_URL}?${query}`;
    }

    function getOAuthState(req, res) {
        const state = req.query.state;
        if (typeof state !== 'string' || !OAUTH_STATE_PATTERN.test(state)) {
            const query = new URLSearchParams({ error: 'oauth_state_invalid' });
            res.redirect(`${LOGIN_ERROR_URL}?${query}`);
            return null;
        }
        return state;
    }

    function redirectToLogin(res, provider) {
        const query = new URLSearchParams({ error: `${provider}_auth_failed` });
        res.redirect(`${LOGIN_ERROR_URL}?${query}`);
    }

    router.get('/callback/yandex', async (req, res) => {
        if (typeof req.query.code !== 'string' || !req.query.code) {
            return res.redirect(`${LOGIN_ERROR_URL}?error=no_code`);
        }
        const state = getOAuthState(req, res);
        if (!state) return;
        if (!env.YANDEX_CLIENT_ID || !env.YANDEX_SECRET_ID) {
            console.error('Yandex OAuth is not configured.');
            return redirectToLogin(res, 'yandex');
        }

        try {
            const token = await requestJson('https://oauth.yandex.ru/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    grant_type: 'authorization_code',
                    code: req.query.code,
                    client_id: env.YANDEX_CLIENT_ID,
                    client_secret: env.YANDEX_SECRET_ID
                })
            });
            if (!token.response.ok || typeof token.data?.access_token !== 'string') {
                throw new Error('Yandex token exchange failed.');
            }

            const profile = await requestJson('https://login.yandex.ru/info?format=json', {
                headers: { Authorization: `OAuth ${token.data.access_token}` }
            });
            const email = profile.data?.default_email?.trim().toLowerCase();
            if (!profile.response.ok || !email) throw new Error('Yandex account did not return a default email.');

            res.redirect(await createLoginRedirect(
                email,
                profile.data.real_name || profile.data.display_name || email.split('@')[0],
                'yandex',
                state
            ));
        } catch (error) {
            console.error('Yandex OAuth callback failed:', error);
            redirectToLogin(res, 'yandex');
        }
    });

    router.get('/callback/google', async (req, res) => {
        if (typeof req.query.code !== 'string' || !req.query.code) {
            return res.redirect(`${LOGIN_ERROR_URL}?error=no_code`);
        }
        const state = getOAuthState(req, res);
        if (!state) return;
        if (!env.GOOGLE_CLIENT_SECRET) {
            console.error('Google OAuth is not configured.');
            return redirectToLogin(res, 'google');
        }

        try {
            const token = await requestJson('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    grant_type: 'authorization_code',
                    code: req.query.code,
                    client_id: '1059795226527-fgrb9i2ccikq0e6pkolpjj36t2a6i2i3.apps.googleusercontent.com',
                    client_secret: env.GOOGLE_CLIENT_SECRET,
                    redirect_uri: 'https://drdarsun-site-main.layero.app/auth/v1/callback/google'
                })
            });
            if (!token.response.ok || typeof token.data?.access_token !== 'string') {
                throw new Error('Google token exchange failed.');
            }

            const profile = await requestJson('https://www.googleapis.com/oauth2/v2/userinfo', {
                headers: { Authorization: `Bearer ${token.data.access_token}` }
            });
            const email = profile.data?.email?.trim().toLowerCase();
            if (!profile.response.ok || !email || profile.data?.verified_email !== true) {
                throw new Error('Google account did not return a verified email.');
            }

            res.redirect(await createLoginRedirect(email, profile.data.name || email.split('@')[0], 'google', state));
        } catch (error) {
            console.error('Google OAuth callback failed:', error);
            redirectToLogin(res, 'google');
        }
    });

    return router;
}

module.exports = createOAuthCallbacksRouter;
