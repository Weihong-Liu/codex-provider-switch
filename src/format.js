import pc from 'picocolors';

import { maskApiKey, sortProviders } from './store.js';

export function formatProviderLine(provider, activeProviderId = null) {
  const marker = provider.id === activeProviderId ? pc.green('*') : ' ';
  const name = provider.id === activeProviderId ? pc.green(provider.name) : pc.cyan(provider.name);
  return `${marker} ${name}  ${pc.dim(provider.baseUrl)}  ${pc.dim(maskApiKey(provider.apiKey))}`;
}

export function formatProviderList(store) {
  if (!store.providers.length) {
    return pc.dim('暂无 provider，请先新增。');
  }

  return sortProviders(store.providers)
    .map((provider) => formatProviderLine(provider, store.activeProvider))
    .join('\n');
}

export function formatCodexStatus(status) {
  const rows = [
    ['Codex config', status.configExists ? status.configPath : `${status.configPath} (missing)`],
    ['Codex auth', status.authExists ? status.authPath : `${status.authPath} (will be created if needed)`],
    ['Model provider', status.modelProvider || '(unknown)'],
    ['Current base_url', status.baseUrl || '(not found)'],
    ['Auth key', status.authHasKey ? status.authKeyMasked : '(missing)'],
  ];

  return rows.map(([label, value]) => `${pc.dim(label.padEnd(18))}${value}`).join('\n');
}

export function formatSwitchResult(provider, result) {
  const backups = result.backups.length
    ? result.backups.map((backup) => `  - ${backup}`).join('\n')
    : '  - none';

  return [
    `${pc.green('Switched')} ${provider.name}`,
    `${pc.dim('base_url')} ${provider.baseUrl}`,
    `${pc.dim('model provider')} ${result.modelProvider}`,
    `${pc.dim('backups')}`,
    backups,
  ].join('\n');
}
