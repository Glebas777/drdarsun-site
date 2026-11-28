const test = require('node:test');
const assert = require('node:assert/strict');
const isAssistantProviderTimeoutReply = require('../assistant-provider-response');

test('assistant provider timeout text is not treated as a successful reply', () => {
    assert.equal(isAssistantProviderTimeoutReply('The operation timed out'), true);
    assert.equal(isAssistantProviderTimeoutReply(' REQUEST TIMED OUT. '), true);
    assert.equal(isAssistantProviderTimeoutReply('Your order operation timed out yesterday'), false);
    assert.equal(isAssistantProviderTimeoutReply('Спасибо за обращение!'), false);
    assert.equal(isAssistantProviderTimeoutReply(null), false);
});
