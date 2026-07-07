import os from 'node:os';
import path from 'node:path';

export const APP_NAME = 'codex-provider-switch';

export function expandHome(value) {
  if (!value) {
    return value;
  }

  if (value === '~') {
    return os.homedir();
  }

  if (value.startsWith('~/')) {
    return path.join(os.homedir(), value.slice(2));
  }

  return value;
}

export function resolvePath(value) {
  return path.resolve(expandHome(value));
}

export function getConfigDir(env = process.env) {
  if (env.CODEX_PROVIDER_SWITCH_CONFIG_DIR) {
    return resolvePath(env.CODEX_PROVIDER_SWITCH_CONFIG_DIR);
  }

  const base = env.XDG_CONFIG_HOME
    ? resolvePath(env.XDG_CONFIG_HOME)
    : path.join(os.homedir(), '.config');

  return path.join(base, APP_NAME);
}

export function getStorePath(env = process.env) {
  return path.join(getConfigDir(env), 'providers.json');
}

export function getCodexHome(env = process.env) {
  return resolvePath(env.CODEX_HOME || path.join(os.homedir(), '.codex'));
}

export function getDefaultCodexConfigPath(env = process.env) {
  return resolvePath(env.CPS_CODEX_CONFIG || path.join(getCodexHome(env), 'config.toml'));
}

export function getDefaultCodexAuthPath(env = process.env) {
  return resolvePath(env.CPS_CODEX_AUTH || path.join(getCodexHome(env), 'auth.json'));
}

export function getResolvedCodexPaths(store, env = process.env) {
  return {
    configPath: resolvePath(store.codex?.configPath || getDefaultCodexConfigPath(env)),
    authPath: resolvePath(store.codex?.authPath || getDefaultCodexAuthPath(env)),
    modelProvider: store.codex?.modelProvider || null,
  };
}
