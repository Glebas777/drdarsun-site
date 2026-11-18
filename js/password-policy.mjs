export const PASSWORD_MIN_LENGTH = 12;

export function getPasswordCriteria(password = '') {
    return {
        length: [...password].length >= PASSWORD_MIN_LENGTH,
        uppercase: /\p{Lu}/u.test(password),
        lowercase: /\p{Ll}/u.test(password),
        digit: /\p{Nd}/u.test(password),
        symbol: /[^\p{L}\p{N}\s]/u.test(password)
    };
}

export async function checkPasswordBreach(password) {
    if (!password || !globalThis.crypto?.subtle) {
        throw new Error('Проверка пароля на утечки недоступна. Попробуйте позже.');
    }

    try {
        const digest = await globalThis.crypto.subtle.digest('SHA-1', new TextEncoder().encode(password));
        const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
        const response = await fetch(`https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`, {
            headers: { 'Add-Padding': 'true' },
            cache: 'no-store',
            signal: AbortSignal.timeout(7000)
        });
        if (!response.ok) throw new Error('Password breach lookup failed.');

        const suffix = hash.slice(5);
        return (await response.text()).split(/\r?\n/).some(line => {
            const [candidate, count] = line.trim().split(':');
            return candidate?.toUpperCase() === suffix && Number(count) > 0;
        });
    } catch {
        throw new Error('Не удалось проверить пароль на утечки. Попробуйте позже.');
    }
}

export async function validateNewPassword(password) {
    const criteria = getPasswordCriteria(password);
    if (!criteria.length) throw new Error(`Пароль должен содержать не менее ${PASSWORD_MIN_LENGTH} символов.`);
    if (!criteria.uppercase || !criteria.lowercase || !criteria.digit || !criteria.symbol) {
        throw new Error('Добавьте заглавную и строчную буквы, цифру и специальный символ.');
    }
    if (await checkPasswordBreach(password)) throw new Error('Этот пароль найден в утечках. Выберите другой.');
}