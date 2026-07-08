import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { getConfigDir, getStorePath } from './paths.js';

export const STORE_VERSION = 2;
export const DEFAULT_PROXY_HOST = '127.0.0.1';
export const DEFAULT_PROXY_PORT = 17888;
export const DEFAULT_PROXY_API_KEY = 'cps-local-proxy';

export function createEmptyStore() {
  return {
    version: STORE_VERSION,
    activeProvider: null,
    codex: {
      configPath: null,
      authPath: null,
      modelProvider: null,
    },
    proxy: {
      enabled: false,
      host: DEFAULT_PROXY_HOST,
      port: DEFAULT_PROXY_PORT,
      apiKey: DEFAULT_PROXY_API_KEY,
    },
    providers: [],
  };
}

export async function ensureStore(env = process.env) {
  const storePath = getStorePath(env);

  try {
    await fs.access(storePath);
  } catch {
    const store = createEmptyStore();
    await saveStore(store, env);
    return store;
  }

  return loadStore(env);
}

export async function loadStore(env = process.env) {
  const storePath = getStorePath(env);

  try {
    const text = await fs.readFile(storePath, 'utf8');
    return normalizeStore(JSON.parse(text));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return createEmptyStore();
    }
    throw error;
  }
}

export async function saveStore(store, env = process.env) {
  const configDir = getConfigDir(env);
  const storePath = getStorePath(env);
  const tempPath = `${storePath}.${process.pid}.tmp`;
  const normalized = normalizeStore(store);

  await fs.mkdir(configDir, { recursive: true, mode: 0o700 });
  await fs.chmod(configDir, 0o700).catch(() => {});
  await fs.writeFile(tempPath, `${JSON.stringify(normalized, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await fs.rename(tempPath, storePath);
  await fs.chmod(storePath, 0o600).catch(() => {});
}

export function normalizeStore(raw) {
  const now = new Date().toISOString();
  const store = {
    ...createEmptyStore(),
    ...(raw && typeof raw === 'object' ? raw : {}),
  };

  store.version = STORE_VERSION;
  store.codex = {
    configPath: store.codex?.configPath || null,
    authPath: store.codex?.authPath || null,
    modelProvider: store.codex?.modelProvider || null,
  };
  store.proxy = normalizeProxyConfig(store.proxy);

  store.providers = Array.isArray(store.providers)
    ? store.providers.map((provider) => normalizeProvider(provider, now))
    : [];

  if (store.activeProvider && !findProvider(store, store.activeProvider)) {
    store.activeProvider = null;
  }

  return store;
}

export function normalizeProxyConfig(proxy = {}) {
  const port = Number(proxy?.port || DEFAULT_PROXY_PORT);
  const host = String(proxy?.host || DEFAULT_PROXY_HOST).trim() || DEFAULT_PROXY_HOST;
  const apiKey = String(proxy?.apiKey || DEFAULT_PROXY_API_KEY);

  return {
    enabled: proxy?.enabled === true,
    host,
    port: Number.isInteger(port) && port > 0 && port <= 65535 ? port : DEFAULT_PROXY_PORT,
    apiKey,
  };
}

export function getProxyBaseUrl(proxy = {}) {
  const normalized = normalizeProxyConfig(proxy);
  const host = normalized.host.includes(':') && !normalized.host.startsWith('[')
    ? `[${normalized.host}]`
    : normalized.host;

  return `http://${host}:${normalized.port}`;
}

export function normalizeProvider(provider, now = new Date().toISOString()) {
  const name = String(provider?.name || '').trim();

  return {
    id: provider?.id || crypto.randomUUID(),
    name,
    baseUrl: String(provider?.baseUrl || provider?.base_url || '').trim(),
    apiKey: String(provider?.apiKey || provider?.api_key || ''),
    note: String(provider?.note || ''),
    createdAt: provider?.createdAt || now,
    updatedAt: provider?.updatedAt || now,
    lastUsedAt: provider?.lastUsedAt || null,
  };
}

export function findProvider(store, query) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) {
    return null;
  }

  return store.providers.find((provider) => {
    return provider.id.toLowerCase() === needle || provider.name.toLowerCase() === needle;
  }) || null;
}

export function hasProviderName(store, name, exceptId = null) {
  const normalized = String(name || '').trim().toLowerCase();
  return store.providers.some((provider) => {
    return provider.id !== exceptId && provider.name.toLowerCase() === normalized;
  });
}

export function addProvider(store, input) {
  const provider = normalizeProvider({
    ...input,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  store.providers.push(provider);
  return provider;
}

export function updateProvider(store, providerId, patch) {
  const index = store.providers.findIndex((provider) => provider.id === providerId);
  if (index === -1) {
    return null;
  }

  store.providers[index] = normalizeProvider({
    ...store.providers[index],
    ...patch,
    id: providerId,
    updatedAt: new Date().toISOString(),
  });

  return store.providers[index];
}

export function removeProvider(store, providerId) {
  const before = store.providers.length;
  store.providers = store.providers.filter((provider) => provider.id !== providerId);

  if (store.activeProvider === providerId) {
    store.activeProvider = null;
  }

  return store.providers.length !== before;
}

export function setActiveProvider(store, provider) {
  const target = typeof provider === 'string' ? findProvider(store, provider) : provider;
  if (!target) {
    return null;
  }

  store.activeProvider = target.id;
  updateProvider(store, target.id, { lastUsedAt: new Date().toISOString() });
  return findProvider(store, target.id);
}

export function validateProviderName(name, store, exceptId = null) {
  const value = String(name || '').trim();

  if (!value) {
    return '名称不能为空';
  }

  if (value.length > 80) {
    return '名称不能超过 80 个字符';
  }

  if (value.includes('|')) {
    return '名称不能包含 |';
  }

  if (hasProviderName(store, value, exceptId)) {
    return '名称已存在';
  }

  return undefined;
}

export function validateBaseUrl(value) {
  const text = String(value || '').trim();

  if (!text) {
    return 'base_url 不能为空';
  }

  let url;
  try {
    url = new URL(text);
  } catch {
    return '请输入合法 URL';
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    return '只支持 http 或 https';
  }

  return undefined;
}

export function validateApiKey(value) {
  if (!String(value || '').trim()) {
    return 'API Key 不能为空';
  }

  return undefined;
}

export function maskApiKey(value) {
  const key = String(value || '');

  if (!key) {
    return '(empty)';
  }

  if (key.length <= 8) {
    return `${key.slice(0, 2)}****`;
  }

  const prefix = key.startsWith('sk-') ? 'sk-' : key.slice(0, 4);
  return `${prefix}****${key.slice(-4)}`;
}

export function sortProviders(providers) {
  return [...providers].sort((a, b) => a.name.localeCompare(b.name));
}

export async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function dirname(filePath) {
  return path.dirname(filePath);
}
