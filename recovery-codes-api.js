const express = require('express');
const crypto = require('crypto');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

function createRecoveryCodesRouter(options = {}) {
    const router = express.Router();
    const env = options.env || process.env;
    const request = options.fetch || fetch;
    const sendEmail = options.sendEmail;
    const supabaseUrl = env.SUPABASE_URL?.replace(/\/$/, '');
    const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
    const anonKey = env.SUPABASE_ANON_KEY;

    router.use((req, res, next) => {
        res.setHeader('Cache-Control', 'no-store');
        next();
    });

    function encryptionKey() {
        if (!env.RECOVERY_CODES_ENCRYPTION_KEY) throw new Error('Recovery code encryption is not configured.');
        return crypto.createHash('sha256').update(env.RECOVERY_CODES_ENCRYPTION_KEY).digest();
    }

    function encrypt(value) {
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
        const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
        return {
            ciphertext: ciphertext.toString('base64'),
            iv: iv.toString('base64'),
            auth_tag: cipher.getAuthTag().toString('base64')
        };
    }

    function decrypt(row) {
        const decipher = crypto.createDecipheriv(
            'aes-256-gcm',
            encryptionKey(),
            Buffer.from(row.iv, 'base64')
        );
        decipher.setAuthTag(Buffer.from(row.auth_tag, 'base64'));
        const plaintext = Buffer.concat([
            decipher.update(Buffer.from(row.ciphertext, 'base64')),
            decipher.final()
        ]).toString('utf8');
        const value = JSON.parse(plaintext);
        if (!Array.isArray(value.codes) || !Array.isArray(value.used)) {
            throw new Error('Recovery code vault data is invalid.');
        }
        return value;
    }

    function codeHash(userId, code) {
        return crypto.createHmac('sha256', encryptionKey())
            .update(`${userId}:${code}`)
            .digest('hex');
    }

    function safeEqualHex(left, right) {
        if (!/^[a-f0-9]{64}$/i.test(left || '') || !/^[a-f0-9]{64}$/i.test(right || '')) return false;
        return crypto.timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
    }

    async function databaseRequest(path, init = {}) {
        if (!supabaseUrl || !serviceRoleKey) {
            throw new Error('Recovery code database configuration is missing.');
        }
        const response = await request(`${supabaseUrl}/rest/v1/${path}`, {
            ...init,
            headers: {
                apikey: serviceRoleKey,
                Authorization: `Bearer ${serviceRoleKey}`,
                'Content-Type': 'application/json',
                ...(init.headers || {})
            }
        });
        const result = await response.json().catch(() => null);
        if (!response.ok) {
            const error = new Error('Recovery code database request failed.');
            error.status = response.status;
            throw error;
        }
        return result;
    }

    async function authenticate(req, res, next) {
        const authorization = req.get('Authorization') || '';
        const match = /^Bearer ([^\s]+)$/.exec(authorization);
        if (!match || !supabaseUrl || !anonKey) {
            return res.status(401).json({ error: 'Войдите в аккаунт и повторите попытку.' });
        }
        try {
            const response = await request(`${supabaseUrl}/auth/v1/user`, {
                headers: { apikey: anonKey, Authorization: authorization }
            });
            const user = await response.json().catch(() => null);
            if (!response.ok || !user?.id || !user.email) {
                return res.status(401).json({ error: 'Сессия сайта истекла. Войдите снова.' });
            }
            const payload = JSON.parse(Buffer.from(match[1].split('.')[1] || '', 'base64url').toString('utf8'));
            req.recoveryUser = { id: user.id, email: user.email, aal: payload.aal };
            req.recoveryAccessToken = match[1];
            next();
        } catch (error) {
            console.error('Recovery code authentication failed.');
            res.status(503).json({ error: 'Не удалось проверить сессию.' });
        }
    }

    function requireAal2(req, res, next) {
        if (req.recoveryUser?.aal !== 'aal2') {
            return res.status(403).json({ error: 'Подтвердите 2FA перед работой с резервными кодами.' });
        }
        next();
    }

    function withErrors(label, handler) {
        return async (req, res) => {
            try {
                await handler(req, res);
            } catch (error) {
                console.error(`${label}:`, error.status || 'service error');
                if (!res.headersSent) res.status(error.status === 409 ? 409 : 503)
                    .json({ error: 'Сервис резервных кодов временно недоступен.' });
            }
        };
    }

    async function getVault(userId) {
        const [row] = await databaseRequest(
            `mfa_recovery_vault?select=user_id,ciphertext,iv,auth_tag,email_code_hash,email_code_expires_at,email_code_sent_at,email_code_attempts,created_at&user_id=eq.${encodeURIComponent(userId)}&limit=1`
        );
        return row || null;
    }

    async function saveEncryptedCodes(userId, codes) {
        const encrypted = encrypt({ codes, used: [] });
        await databaseRequest('mfa_recovery_vault', {
            method: 'POST',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({ user_id: userId, ...encrypted })
        });
    }

    async function saveVaultPatch(userId, patch) {
        await databaseRequest(`mfa_recovery_vault?user_id=eq.${encodeURIComponent(userId)}`, {
            method: 'PATCH',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() })
        });
    }

    router.get('/status', authenticate, withErrors('Recovery code status lookup failed', async (req, res) => {
        const vault = await getVault(req.recoveryUser.id);
        if (!vault) return res.json({ hasCodes: false, codes: [], createdAt: null });
        const value = decrypt(vault);
        res.setHeader('Cache-Control', 'no-store');
        res.json({
            hasCodes: true,
            createdAt: vault.created_at,
            codes: value.codes.map(code => ({
                masked: `${code.slice(0, 2)}${'•'.repeat(Math.max(4, code.length - 2))}`,
                used: value.used.includes(code)
            })),
            remaining: value.codes.filter(code => !value.used.includes(code)).length
        });
    }));

    router.post('/register', authenticate, requireAal2, withErrors('Recovery code registration failed', async (req, res) => {
        const codes = req.body?.codes;
        if (!Array.isArray(codes) || codes.length < 1 || codes.length > 20 ||
            codes.some(code => typeof code !== 'string' || !/^[a-z0-9]{16}$/i.test(code)) ||
            new Set(codes).size !== codes.length) {
            return res.status(400).json({ error: 'Набор резервных кодов имеет неверный формат.' });
        }
        await saveEncryptedCodes(req.recoveryUser.id, codes.map(code => code.toLowerCase()));
        res.status(201).json({ success: true, total: codes.length });
    }));

    router.post('/request', authenticate, requireAal2, withErrors('Recovery email request failed', async (req, res) => {
        const vault = await getVault(req.recoveryUser.id);
        if (!vault) return res.status(404).json({ error: 'Резервные коды ещё не созданы.' });
        if (vault.email_code_sent_at && Date.now() - Date.parse(vault.email_code_sent_at) < 60000) {
            return res.status(429).json({ error: 'Подождите минуту перед повторной отправкой.' });
        }
        if (!sendEmail) throw new Error('Recovery email sender is not configured.');
        const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
        await saveVaultPatch(req.recoveryUser.id, {
            email_code_hash: codeHash(req.recoveryUser.id, code),
            email_code_expires_at: expiresAt,
            email_code_sent_at: new Date().toISOString(),
            email_code_attempts: 0
        });
        try {
            const result = await sendEmail(
                req.recoveryUser.email,
                'Код доступа к резервным кодам Dr. DarSun',
                `<p>Код подтверждения: <strong>${code}</strong></p><p>Он действует 10 минут. Если вы не запрашивали доступ, проигнорируйте письмо.</p>`
            );
            if (result?.error) throw new Error('Recovery email delivery failed.');
        } catch {
            await saveVaultPatch(req.recoveryUser.id, {
                email_code_hash: null,
                email_code_expires_at: null
            }).catch(() => {});
            console.error('Recovery email delivery failed.');
            return res.status(502).json({ error: 'Не удалось отправить письмо. Попробуйте позже.' });
        }
        res.json({ success: true, expiresAt });
    }));

    router.post('/reveal', authenticate, requireAal2, withErrors('Recovery code reveal failed', async (req, res) => {
        const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
        if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Введите шестизначный код из письма.' });
        const vault = await getVault(req.recoveryUser.id);
        if (!vault) return res.status(404).json({ error: 'Резервные коды не найдены.' });
        const expectedHash = vault.email_code_hash || '';
        const valid = vault.email_code_expires_at &&
            Date.parse(vault.email_code_expires_at) > Date.now() &&
            (vault.email_code_attempts || 0) < 5 &&
            safeEqualHex(expectedHash, codeHash(req.recoveryUser.id, code));
        if (!valid) {
            const attempts = Math.min(5, (vault.email_code_attempts || 0) + 1);
            await saveVaultPatch(req.recoveryUser.id, {
                email_code_attempts: attempts,
                ...(attempts >= 5 ? { email_code_hash: null, email_code_expires_at: null } : {})
            });
            return res.status(400).json({ error: 'Код неверный или истёк. Запросите новый код.' });
        }
        const value = decrypt(vault);
        await saveVaultPatch(req.recoveryUser.id, {
            email_code_hash: null,
            email_code_expires_at: null,
            email_code_attempts: 0
        });
        res.setHeader('Cache-Control', 'no-store');
        res.json({
            codes: value.codes.map(codeValue => ({ code: codeValue, used: value.used.includes(codeValue) }))
        });
    }));

    router.post('/consume', authenticate, requireAal2, withErrors('Recovery code use tracking failed', async (req, res) => {
        const code = typeof req.body?.code === 'string'
            ? req.body.code.replace(/[\s-]/g, '').toLowerCase()
            : '';
        const vault = await getVault(req.recoveryUser.id);
        if (!vault) return res.status(404).json({ error: 'Резервный код учтён сервисом входа.' });
        const value = decrypt(vault);
        const matchedCode = value.codes.find(candidate =>
            safeEqualHex(codeHash(req.recoveryUser.id, candidate), codeHash(req.recoveryUser.id, code))
        );
        if (!matchedCode) return res.status(404).json({ error: 'Резервный код не найден в личном архиве.' });
        if (!value.used.includes(matchedCode)) value.used.push(matchedCode);
        const encrypted = encrypt(value);
        await saveVaultPatch(req.recoveryUser.id, encrypted);
        res.json({ success: true });
    }));

    router.delete('/', authenticate, withErrors('Recovery code vault deletion failed', async (req, res) => {
        await databaseRequest(`mfa_recovery_vault?user_id=eq.${encodeURIComponent(req.recoveryUser.id)}`, {
            method: 'DELETE',
            headers: { Prefer: 'return=minimal' }
        });
        res.json({ success: true });
    }));

    return router;
}

module.exports = createRecoveryCodesRouter;
