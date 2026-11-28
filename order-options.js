const { isYooKassaConfigured } = require('./yookassa-api');

function getOrderOptions(env = process.env) {
    const online = isYooKassaConfigured(env);
    return {
        cash: env.CASH_ORDERS_ENABLED === 'true',
        card: online,
        sbp: online
    };
}

module.exports = getOrderOptions;
