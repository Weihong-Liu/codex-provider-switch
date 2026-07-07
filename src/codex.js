import fs from 'node:fs/promises';
import path from 'node:path';

import { getResolvedCodexPaths } from './paths.js';
import { maskApiKey, pathExists } from './store.js';

export async function switchCodexProvider(store, provider, env = process.env) {
  const { configPath, authPath, modelProvider: configuredModelProvider } = getResolvedCodexPaths(store, env);
  const configText = await fs.readFile(configPath, 'utf8');
  const modelProvider = configuredModelProvider || readActiveModelProvider(configText) || 'OpenAI';
  const updatedConfig = updateBaseUrlInToml(configText, modelProvider, provider.baseUrl);
  const configBackup = await backupFile(configPath);
  const authBackup = await backupFile(authPath);

  await fs.writeFile(configPath, updatedConfig, 'utf8');
  await fs.chmod(configPath, 0o600).catch(() => {});
  await writeAuthApiKey(authPath, provider.apiKey);

  return {
    configPath,
    authPath,
    modelProvider,
    backups: [configBackup, authBackup].filter(Boolean),
  };
}

export async function inspectCodex(store, env = process.env) {
  const { configPath, authPath, modelProvider: configuredModelProvider } = getResolvedCodexPaths(store, env);
  const configExists = await pathExists(configPath);
  const authExists = await pathExists(authPath);
  let modelProvider = configuredModelProvider;
  let baseUrl = null;
  let authHasKey = false;
  let authKeyMasked = null;
  let configError = null;
  let authError = null;

  if (configExists) {
    try {
      const configText = await fs.readFile(configPath, 'utf8');
      modelProvider = modelProvider || readActiveModelProvider(configText) || 'OpenAI';
      baseUrl = readBaseUrlFromToml(configText, modelProvider);
    } catch (error) {
      configError = error instanceof Error ? error.message : String(error);
    }
  }

  if (authExists) {
    try {
      const auth = JSON.parse(await fs.readFile(authPath, 'utf8'));
      authHasKey = typeof auth.OPENAI_API_KEY === 'string' && auth.OPENAI_API_KEY.length > 0;
      authKeyMasked = authHasKey ? maskApiKey(auth.OPENAI_API_KEY) : null;
    } catch (error) {
      authError = error instanceof Error ? error.message : String(error);
    }
  }

  return {
    configPath,
    authPath,
    configExists,
    authExists,
    modelProvider,
    baseUrl,
    authHasKey,
    authKeyMasked,
    configError,
    authError,
  };
}

export function readActiveModelProvider(configText) {
  const match = configText.match(/^\s*model_provider\s*=\s*"([^"]+)"\s*$/m);
  return match?.[1] || null;
}

export function readBaseUrlFromToml(configText, modelProvider) {
  const lines = configText.split(/\r?\n/);
  const targetHeader = `model_providers.${modelProvider}`;
  let inTarget = false;

  for (const line of lines) {
    const table = parseTableHeader(line);
    if (table) {
      inTarget = normalizeTomlHeader(table) === targetHeader;
      continue;
    }

    if (inTarget) {
      const match = line.match(/^\s*base_url\s*=\s*"([^"]*)"\s*$/);
      if (match) {
        return match[1];
      }
    }
  }

  return null;
}

export function updateBaseUrlInToml(configText, modelProvider, baseUrl) {
  const newline = configText.includes('\r\n') ? '\r\n' : '\n';
  const lines = configText.split(/\r?\n/);
  const targetHeader = `model_providers.${modelProvider}`;
  const nextLines = [];
  let inTarget = false;
  let foundTarget = false;
  let updatedBaseUrl = false;
  const renderedBaseUrl = `base_url = ${tomlString(baseUrl)}`;

  for (const line of lines) {
    const table = parseTableHeader(line);

    if (table && inTarget && !updatedBaseUrl) {
      insertBeforeTrailingBlankLines(nextLines, renderedBaseUrl);
      updatedBaseUrl = true;
    }

    if (table) {
      inTarget = normalizeTomlHeader(table) === targetHeader;
      foundTarget = foundTarget || inTarget;
    }

    if (inTarget && /^\s*base_url\s*=/.test(line)) {
      const indent = line.match(/^(\s*)/)?.[1] || '';
      nextLines.push(`${indent}${renderedBaseUrl}`);
      updatedBaseUrl = true;
      continue;
    }

    nextLines.push(line);
  }

  if (inTarget && !updatedBaseUrl) {
    insertBeforeTrailingBlankLines(nextLines, renderedBaseUrl);
    updatedBaseUrl = true;
  }

  if (!foundTarget) {
    throw new Error(`找不到 [${targetHeader}]，请先在 Codex config.toml 中配置该 model provider`);
  }

  return nextLines.join(newline);
}

export function insertBeforeTrailingBlankLines(lines, lineToInsert) {
  let insertAt = lines.length;

  while (insertAt > 0 && lines[insertAt - 1] === '') {
    insertAt -= 1;
  }

  lines.splice(insertAt, 0, lineToInsert);
}

export async function writeAuthApiKey(authPath, apiKey) {
  let auth = {};

  try {
    auth = JSON.parse(await fs.readFile(authPath, 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
    await fs.mkdir(path.dirname(authPath), { recursive: true, mode: 0o700 });
  }

  auth.OPENAI_API_KEY = apiKey;
  await fs.writeFile(authPath, `${JSON.stringify(auth, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await fs.chmod(authPath, 0o600).catch(() => {});
}

export async function backupFile(filePath) {
  if (!(await pathExists(filePath))) {
    return null;
  }

  const timestamp = timestampForFileName(new Date());
  const backupPath = `${filePath}.bak-${timestamp}`;
  await fs.copyFile(filePath, backupPath);
  await fs.chmod(backupPath, 0o600).catch(() => {});
  return backupPath;
}

export function parseTableHeader(line) {
  const match = line.match(/^\s*\[([^\]]+)\]\s*$/);
  return match?.[1] || null;
}

export function normalizeTomlHeader(header) {
  return header
    .trim()
    .split('.')
    .map((part) => part.trim().replace(/^"|"$/g, ''))
    .join('.');
}

export function tomlString(value) {
  return JSON.stringify(String(value));
}

export function timestampForFileName(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
}
