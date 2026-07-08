import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import http from 'node:http';
import https from 'node:https';

import { getConfigDir, getProxyLogPath, getProxyPidPath } from './paths.js';
import { ensureStore, findProvider, getProxyBaseUrl, normalizeProxyConfig } from './store.js';

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

export function createProxyServer({ env = process.env, logger = console } = {}) {
  return http.createServer((request, response) => {
    handleProxyRequest(request, response, { env, logger }).catch((error) => {
      writeJsonError(response, 500, 'CPS_PROXY_ERROR', error instanceof Error ? error.message : String(error));
    });
  });
}

export async function startProxyServer({
  env = process.env,
  host,
  port,
  logger = console,
} = {}) {
  const server = createProxyServer({ env, logger });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  const listenUrl = typeof address === 'object' && address
    ? `http://${address.address}:${address.port}`
    : `http://${host}:${port}`;

  logger.log(`CPS proxy listening on ${listenUrl}`);
  logger.log('Press Ctrl+C to stop.');

  await new Promise((resolve) => {
    const shutdown = () => {
      server.close(() => resolve());
    };

    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  });
}

export async function startProxyDaemon({
  env = process.env,
  proxy,
  entryPath = process.argv[1],
  logger = console,
} = {}) {
  const normalizedProxy = normalizeProxyConfig(proxy);
  const currentHealth = await readProxyHealth(normalizedProxy);

  if (currentHealth.running) {
    return {
      started: false,
      pid: await readProxyPid(env),
      logPath: getProxyLogPath(env),
      health: currentHealth,
    };
  }

  await fs.mkdir(getConfigDir(env), { recursive: true, mode: 0o700 });
  const logPath = getProxyLogPath(env);
  const logFd = fsSync.openSync(logPath, 'a');
  const args = [
    entryPath,
    'proxy',
    '--host',
    normalizedProxy.host,
    '--port',
    String(normalizedProxy.port),
  ];
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: { ...process.env, ...env },
  });

  child.unref();
  fsSync.closeSync(logFd);
  await writeProxyPid(child.pid, env);

  let health;
  try {
    health = await waitForProxyHealth(normalizedProxy, child.pid, 5000);
  } catch (error) {
    if (processExists(child.pid)) {
      process.kill(child.pid, 'SIGTERM');
    }
    await fs.rm(getProxyPidPath(env), { force: true });
    throw error;
  }
  logger.log?.(`CPS proxy started in background on ${health.url}`);

  return {
    started: true,
    pid: child.pid,
    logPath,
    health,
  };
}

export async function stopProxyDaemon({ env = process.env, timeoutMs = 5000 } = {}) {
  const pid = await readProxyPid(env);
  const pidPath = getProxyPidPath(env);

  if (!pid) {
    return { stopped: false, reason: 'no-pid-file', pidPath };
  }

  if (!processExists(pid)) {
    await fs.rm(pidPath, { force: true });
    return { stopped: false, reason: 'stale-pid', pid, pidPath };
  }

  process.kill(pid, 'SIGTERM');
  const stopped = await waitForProcessExit(pid, timeoutMs);

  if (stopped) {
    await fs.rm(pidPath, { force: true });
  }

  return { stopped, pid, pidPath };
}

export async function readProxyHealth(proxy, { timeoutMs = 1200 } = {}) {
  const normalizedProxy = normalizeProxyConfig(proxy);
  const url = `${getProxyBaseUrl(normalizedProxy)}/__cps/health`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    let payload = null;

    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = { raw: text };
    }

    return {
      running: response.ok,
      statusCode: response.status,
      url,
      payload,
    };
  } catch (error) {
    return {
      running: false,
      url,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function readProxyPid(env = process.env) {
  try {
    const pid = Number((await fs.readFile(getProxyPidPath(env), 'utf8')).trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }

    throw error;
  }
}

export async function handleProxyRequest(request, response, { env = process.env, logger = console } = {}) {
  if (request.url === '/__cps/health') {
    await writeHealthResponse(response, env);
    return;
  }

  const store = await ensureStore(env);
  const provider = store.activeProvider ? findProvider(store, store.activeProvider) : null;

  if (!provider) {
    drainRequest(request);
    writeJsonError(response, 503, 'NO_ACTIVE_PROVIDER', 'No active provider. Run cps use <provider> first.');
    return;
  }

  if (!provider.baseUrl || !provider.apiKey) {
    drainRequest(request);
    writeJsonError(response, 503, 'INVALID_ACTIVE_PROVIDER', 'Active provider is missing base_url or API key.');
    return;
  }

  const targetUrl = buildTargetUrl(provider.baseUrl, request.url || '/');
  const headers = buildProxyHeaders(request.headers, provider, targetUrl);
  const transport = targetUrl.protocol === 'https:' ? https : http;

  const upstreamRequest = transport.request({
    protocol: targetUrl.protocol,
    hostname: targetUrl.hostname,
    port: targetUrl.port || undefined,
    method: request.method,
    path: `${targetUrl.pathname}${targetUrl.search}`,
    headers,
  }, (upstreamResponse) => {
    response.writeHead(upstreamResponse.statusCode || 502, stripHopByHopHeaders(upstreamResponse.headers));
    upstreamResponse.pipe(response);
  });

  upstreamRequest.on('error', (error) => {
    logger.error?.(`CPS proxy upstream error: ${error.message}`);
    writeJsonError(response, 502, 'UPSTREAM_ERROR', error.message);
  });

  request.on('aborted', () => {
    upstreamRequest.destroy();
  });

  logger.log?.(`${request.method} ${request.url} -> ${provider.name} ${targetUrl.origin}${targetUrl.pathname}${targetUrl.search}`);
  request.pipe(upstreamRequest);
}

export function buildTargetUrl(baseUrl, requestUrl = '/') {
  const base = new URL(baseUrl);
  const request = new URL(requestUrl, 'http://cps.local');
  const basePath = base.pathname.replace(/\/+$/, '');
  const requestPath = request.pathname.startsWith('/') ? request.pathname : `/${request.pathname}`;
  const joinedPath = `${basePath}${requestPath}` || '/';

  base.pathname = joinedPath.replace(/\/{2,}/g, '/');
  base.search = request.search;
  base.hash = '';

  return base;
}

export function buildProxyHeaders(incomingHeaders, provider, targetUrl) {
  const headers = {};

  for (const [name, value] of Object.entries(incomingHeaders || {})) {
    const lowerName = name.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lowerName) || lowerName === 'host' || lowerName === 'authorization') {
      continue;
    }

    headers[name] = value;
  }

  headers.host = targetUrl.host;
  headers.authorization = `Bearer ${provider.apiKey}`;
  return headers;
}

function stripHopByHopHeaders(headers) {
  const nextHeaders = {};

  for (const [name, value] of Object.entries(headers || {})) {
    if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase())) {
      nextHeaders[name] = value;
    }
  }

  return nextHeaders;
}

async function writeHealthResponse(response, env) {
  const store = await ensureStore(env);
  const provider = store.activeProvider ? findProvider(store, store.activeProvider) : null;

  writeJson(response, 200, {
    ok: true,
    proxyEnabled: store.proxy?.enabled === true,
    activeProvider: provider ? {
      id: provider.id,
      name: provider.name,
      baseUrl: provider.baseUrl,
    } : null,
  });
}

function writeJsonError(response, statusCode, code, message) {
  writeJson(response, statusCode, { error: { code, message } });
}

function writeJson(response, statusCode, payload) {
  if (response.headersSent) {
    response.destroy();
    return;
  }

  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  response.end(`${JSON.stringify(payload)}\n`);
}

function drainRequest(request) {
  request.resume();
}

async function writeProxyPid(pid, env) {
  await fs.writeFile(getProxyPidPath(env), `${pid}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
}

async function waitForProxyHealth(proxy, pid, timeoutMs) {
  const start = Date.now();
  let lastHealth = null;

  while (Date.now() - start < timeoutMs) {
    lastHealth = await readProxyHealth(proxy, { timeoutMs: 500 });
    if (lastHealth.running) {
      return lastHealth;
    }

    if (!processExists(pid)) {
      throw new Error(`proxy process exited before becoming healthy: ${lastHealth.error || 'unknown error'}`);
    }

    await delay(150);
  }

  throw new Error(`proxy did not become healthy at ${lastHealth?.url || getProxyBaseUrl(proxy)} within ${timeoutMs}ms`);
}

async function waitForProcessExit(pid, timeoutMs) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    if (!processExists(pid)) {
      return true;
    }

    await delay(100);
  }

  return !processExists(pid);
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
