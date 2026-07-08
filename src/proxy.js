import http from 'node:http';
import https from 'node:https';

import { ensureStore, findProvider } from './store.js';

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
