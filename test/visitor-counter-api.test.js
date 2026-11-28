const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { once } = require('node:events');
const createVisitorCounterRouter = require('../visitor-counter-api');

async function startServer(router) {
    const app = express();
    app.use(express.json());
    app.use('/counter', router);
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    return {
        server,
        url: `http://127.0.0.1:${address.port}/counter`
    };
}

function databaseResponse(value) {
    return Response.json(value);
}

test('visitor counter coalesces concurrent reads and caches the incremented count', async t => {
    const requests = [];
    const fakeFetch = async (url, init) => {
        requests.push({ url, init });
        await new Promise(resolve => setTimeout(resolve, 10));
        return databaseResponse(String(url).endsWith('/record_site_visitor') ? 8 : 7);
    };
    const { server, url } = await startServer(createVisitorCounterRouter({
        env: {
            SUPABASE_URL: 'https://database.example',
            SUPABASE_SERVICE_ROLE_KEY: 'test-key'
        },
        fetch: fakeFetch
    }));
    t.after(() => new Promise(resolve => server.close(resolve)));

    const [firstRead, simultaneousRead] = await Promise.all([
        fetch(url),
        fetch(url)
    ]);
    assert.deepEqual(await firstRead.json(), { count: 7, period: 'today' });
    assert.deepEqual(await simultaneousRead.json(), { count: 7, period: 'today' });
    assert.equal(requests.length, 1);
    assert.match(firstRead.headers.get('cache-control'), /s-maxage=10/);

    const increment = await fetch(url, { method: 'POST' });
    assert.deepEqual(await increment.json(), { count: 8, period: 'today' });
    assert.equal(requests.length, 2);
    assert.deepEqual(JSON.parse(requests[1].init.body), {
        p_visit_date: new Date().toISOString().slice(0, 10)
    });

    const cachedAfterIncrement = await fetch(url);
    assert.deepEqual(await cachedAfterIncrement.json(), { count: 8, period: 'today' });
    assert.equal(requests.length, 2);
});

test('visitor counter reports database misconfiguration instead of a fake count', async t => {
    const { server, url } = await startServer(createVisitorCounterRouter({
        env: {},
        fetch: async () => {
            throw new Error('Database should not be called without configuration.');
        }
    }));
    t.after(() => new Promise(resolve => server.close(resolve)));

    const originalConsoleError = console.error;
    console.error = () => {};
    t.after(() => { console.error = originalConsoleError; });
    const response = await fetch(url);

    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
        error: 'Счётчик посетителей временно недоступен.'
    });
});

test('manual refresh bypasses the cached count without recording another visit', async t => {
    const requests = [];
    const fakeFetch = async url => {
        requests.push(String(url));
        return databaseResponse(String(url).endsWith('/get_site_visitors_today') ? 9 : 8);
    };
    const { server, url } = await startServer(createVisitorCounterRouter({
        env: {
            SUPABASE_URL: 'https://database.example',
            SUPABASE_SERVICE_ROLE_KEY: 'test-key'
        },
        fetch: fakeFetch
    }));
    t.after(() => new Promise(resolve => server.close(resolve)));

    const firstRead = await fetch(url);
    assert.deepEqual(await firstRead.json(), { count: 9, period: 'today' });

    const refreshedRead = await fetch(`${url}?refresh=1`, { headers: { 'Cache-Control': 'no-cache' } });
    assert.deepEqual(await refreshedRead.json(), { count: 9, period: 'today' });
    assert.equal(refreshedRead.headers.get('cache-control'), 'no-store');
    assert.equal(requests.length, 2);
    assert.ok(requests.every(request => request.endsWith('/get_site_visitors_today')));
});

test('a stale in-flight read cannot overwrite a manual refresh', async t => {
    let resolveStaleRead;
    let announceReadStarted;
    let readCount = 0;
    const readStarted = new Promise(resolve => { announceReadStarted = resolve; });
    const staleResponse = new Promise(resolve => { resolveStaleRead = resolve; });
    const fakeFetch = url => {
        readCount++;
        if (readCount === 1) {
            announceReadStarted();
            return staleResponse;
        }
        return Promise.resolve(databaseResponse(9));
    };
    const { server, url } = await startServer(createVisitorCounterRouter({
        env: {
            SUPABASE_URL: 'https://database.example',
            SUPABASE_SERVICE_ROLE_KEY: 'test-key'
        },
        fetch: fakeFetch
    }));
    t.after(() => new Promise(resolve => server.close(resolve)));

    const staleRead = fetch(url);
    await readStarted;
    const refreshedRead = await fetch(`${url}?refresh=1`);
    assert.deepEqual(await refreshedRead.json(), { count: 9, period: 'today' });
    resolveStaleRead(databaseResponse(7));

    assert.deepEqual(await (await staleRead).json(), { count: 9, period: 'today' });
    assert.equal(readCount, 2);
});

test('a concurrent stale read cannot overwrite a completed visitor increment', async t => {
    let resolveRead;
    let announceReadStarted;
    const readStarted = new Promise(resolve => { announceReadStarted = resolve; });
    const staleResponse = new Promise(resolve => { resolveRead = resolve; });
    const fakeFetch = async (url) => {
        if (String(url).endsWith('/get_site_visitors_today')) {
            announceReadStarted();
            return staleResponse;
        }
        return databaseResponse(8);
    };
    const { server, url } = await startServer(createVisitorCounterRouter({
        env: {
            SUPABASE_URL: 'https://database.example',
            SUPABASE_SERVICE_ROLE_KEY: 'test-key'
        },
        fetch: fakeFetch
    }));
    t.after(() => new Promise(resolve => server.close(resolve)));

    const concurrentRead = fetch(url);
    await readStarted;
    const increment = await fetch(url, { method: 'POST' });
    assert.deepEqual(await increment.json(), { count: 8, period: 'today' });
    resolveRead(databaseResponse(7));

    const readAfterIncrement = await concurrentRead;
    assert.deepEqual(await readAfterIncrement.json(), { count: 8, period: 'today' });
});
