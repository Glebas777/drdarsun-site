const DEFAULT_SITE_ORIGINS = [
    'https://drdarsun.ru',
    'https://www.drdarsun.ru',
    'https://drdarsun-site-main.layero.app'
];

function getAllowedSiteOrigins(env = process.env) {
    const configuredOrigins = String(env.CORS_ALLOWED_ORIGINS || '')
        .split(',')
        .map(value => value.trim())
        .filter(Boolean);

    return new Set([...DEFAULT_SITE_ORIGINS, ...configuredOrigins]);
}

module.exports = getAllowedSiteOrigins;
