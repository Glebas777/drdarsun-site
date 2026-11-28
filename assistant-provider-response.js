const TIMEOUT_REPLY_PATTERN = /^(?:(?:the )?operation|request) timed out[.!]?$/i;

module.exports = function isAssistantProviderTimeoutReply(value) {
    return typeof value === 'string' && TIMEOUT_REPLY_PATTERN.test(value.trim());
};
