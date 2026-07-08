import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createProxyServer, buildProxyHeaders, buildTargetUrl } from './proxy.js';
import {
  addProvider,
  createEmptyStore,
  saveStore,
  setActiveProvider,
} from './store.js';

test('builds target URLs by appending request path to provider base path', () => {
  assert.equal(
    buildTargetUrl('https://api.example.com/v1/', '/responses?stream=true').toString(),
    'https://api.example.com/v1/responses?stream=true',
  );
  assert.equal(
    buildTargetUrl('https://api.example.com', '/responses').toString(),
    'https://api.example.com/responses',
  );
});

test('builds proxy headers with active provider authorization', () => {
  const headers = buildProxyHeaders({
    host: '127.0.0.1:17888',
    authorization: 'Bearer stale',
    'content-type': 'application/json',
    connection: 'keep-alive',
  }, { apiKey: 'new-key' }, new URL('https://api.example.com/responses'));

  assert.equal(headers.host, 'api.example.com');
  assert.equal(headers.authorization, 'Bearer new-key');
  assert.equal(headers['content-type'], 'application/json');
  assert.equal(headers.connection, undefined);
});

test('proxy forwards requests with the currently active provider', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cps-proxy-test-'));
  const requests = [];
  const upstream = http.createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      requests.push({
        url: request.url,
        authorization: request.headers.authorization,
        body,
      });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true, path: request.url }));
    });
  });
  const proxy = createProxyServer({
    env: { CODEX_PROVIDER_SWITCH_CONFIG_DIR: tempDir },
    logger: silentLogger(),
  });

  try {
    await listen(upstream, '127.0.0.1', 0);
    const upstreamUrl = addressUrl(upstream);
    const env = { CODEX_PROVIDER_SWITCH_CONFIG_DIR: tempDir };
    const store = createEmptyStore();
    const first = addProvider(store, {
      name: 'first',
      baseUrl: `${upstreamUrl}/v1`,
      apiKey: 'first-key',
    });
    const second = addProvider(store, {
      name: 'second',
      baseUrl: `${upstreamUrl}/v2`,
      apiKey: 'second-key',
    });

    setActiveProvider(store, first);
    store.proxy.enabled = true;
    await saveStore(store, env);
    await listen(proxy, '127.0.0.1', 0);

    let response = await fetch(`${addressUrl(proxy)}/responses?first=1`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer stale-key',
        'content-type': 'application/json',
      },
      body: '{"first":true}',
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).ok, true);

    setActiveProvider(store, second);
    await saveStore(store, env);

    response = await fetch(`${addressUrl(proxy)}/responses?second=1`, {
      method: 'POST',
      body: '{"second":true}',
    });
    assert.equal(response.status, 200);

    assert.equal(requests.length, 2);
    assert.deepEqual(requests.map((request) => request.url), [
      '/v1/responses?first=1',
      '/v2/responses?second=1',
    ]);
    assert.deepEqual(requests.map((request) => request.authorization), [
      'Bearer first-key',
      'Bearer second-key',
    ]);
    assert.deepEqual(requests.map((request) => request.body), [
      '{"first":true}',
      '{"second":true}',
    ]);
  } finally {
    await close(proxy);
    await close(upstream);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

function listen(server, host, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    if (!server.listening) {
      resolve();
      return;
    }

    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function addressUrl(server) {
  const address = server.address();
  assert.equal(typeof address, 'object');
  assert.ok(address);
  return `http://${address.address}:${address.port}`;
}

function silentLogger() {
  return {
    log() {},
    error() {},
  };
}
