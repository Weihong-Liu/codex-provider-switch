import pc from 'picocolors';

import { getProxyBaseUrl, maskApiKey, sortProviders } from './store.js';

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

export function formatProxySetupResult(result, proxy) {
  const backups = result.backups.length
    ? result.backups.map((backup) => `  - ${backup}`).join('\n')
    : '  - none';

  return [
    `${pc.green('Proxy mode enabled')}`,
    `${pc.dim('listen')} ${getProxyBaseUrl(proxy)}`,
    `${pc.dim('Codex base_url')} ${result.proxyBaseUrl}`,
    `${pc.dim('model provider')} ${result.modelProvider}`,
    `${pc.dim('next')} run ${pc.bold('cps proxy start')} or keep ${pc.bold('cps proxy')} open in a terminal`,
    `${pc.dim('restart')} restart existing Codex processes once after setup`,
    `${pc.dim('backups')}`,
    backups,
  ].join('\n');
}

export function formatProxySwitchResult(provider, proxy) {
  return [
    `${pc.green('Proxy active provider')} ${provider.name}`,
    `${pc.dim('provider base_url')} ${provider.baseUrl}`,
    `${pc.dim('Codex base_url')} ${getProxyBaseUrl(proxy)}`,
    pc.dim('Existing Codex processes will use this provider on their next request if cps proxy is running.'),
  ].join('\n');
}

export function formatProxyStatus(store, runtime = null) {
  const proxy = store.proxy || {};
  const activeProvider = store.activeProvider
    ? store.providers.find((provider) => provider.id === store.activeProvider)
    : null;
  const runtimeLine = runtime
    ? `${pc.dim('Proxy runtime')} ${runtime.running ? pc.green('running') : pc.yellow('stopped')}${runtime.pid ? ` ${pc.dim(`pid ${runtime.pid}`)}` : ''}`
    : null;
  const errorLine = runtime && !runtime.running && runtime.error
    ? `${pc.dim('Runtime error')} ${runtime.error}`
    : null;

  return [
    `${pc.dim('Proxy mode')} ${proxy.enabled ? pc.green('enabled') : pc.dim('disabled')}`,
    `${pc.dim('Proxy URL')} ${getProxyBaseUrl(proxy)}`,
    runtimeLine,
    errorLine,
    `${pc.dim('Active provider')} ${activeProvider ? `${activeProvider.name} ${pc.dim(activeProvider.baseUrl)}` : '(none)'}`,
  ].filter(Boolean).join('\n');
}
