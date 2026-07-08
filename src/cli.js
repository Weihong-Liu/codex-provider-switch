import { Command } from 'commander';
import pc from 'picocolors';

import { configureCodexProxy, inspectCodex, switchCodexProvider } from './codex.js';
import {
  formatCodexStatus,
  formatProviderList,
  formatProxySetupResult,
  formatProxyStatus,
  formatProxySwitchResult,
  formatSwitchResult,
} from './format.js';
import { getStorePath } from './paths.js';
import {
  readProxyHealth,
  readProxyPid,
  startProxyDaemon,
  startProxyServer,
  stopProxyDaemon,
} from './proxy.js';
import {
  addProvider,
  ensureStore,
  findProvider,
  normalizeProxyConfig,
  removeProvider,
  saveStore,
  setActiveProvider,
  updateProvider,
  validateApiKey,
  validateBaseUrl,
  validateProviderName,
} from './store.js';
import { runSettingsTui, runTui } from './ui.js';

export async function runCli(argv = process.argv, env = process.env) {
  const program = new Command();

  program
    .name('codex-provider-switch')
    .alias('cps')
    .description('Switch Codex base_url and API keys from a small TUI.')
    .version('0.1.0')
    .action(async () => {
      await runTui(env);
    });

  program.command('list')
    .description('List saved providers')
    .action(async () => {
      const store = await ensureStore(env);
      console.log(formatProviderList(store));
    });

  program.command('use')
    .argument('<name>', 'provider name or id')
    .description('Switch Codex to a provider')
    .action(async (name) => {
      const store = await ensureStore(env);
      const provider = findProvider(store, name);

      if (!provider) {
        throw new Error(`找不到 provider: ${name}`);
      }

      if (store.proxy?.enabled) {
        const activeProvider = setActiveProvider(store, provider);
        await saveStore(store, env);
        console.log(formatProxySwitchResult(activeProvider || provider, store.proxy));
        return;
      }

      const result = await switchCodexProvider(store, provider, env);
      const activeProvider = setActiveProvider(store, provider);
      await saveStore(store, env);
      console.log(formatSwitchResult(activeProvider || provider, result));
    });

  program.command('add')
    .description('Add a provider without opening the TUI')
    .requiredOption('-n, --name <name>', 'provider name')
    .requiredOption('-u, --base-url <url>', 'provider base_url')
    .requiredOption('-k, --api-key <key>', 'provider API key')
    .option('--note <text>', 'provider note', '')
    .action(async (options) => {
      const store = await ensureStore(env);
      const nameError = validateProviderName(options.name, store);
      const urlError = validateBaseUrl(options.baseUrl);
      const keyError = validateApiKey(options.apiKey);

      if (nameError || urlError || keyError) {
        throw new Error(nameError || urlError || keyError);
      }

      const provider = addProvider(store, {
        name: options.name,
        baseUrl: options.baseUrl,
        apiKey: options.apiKey,
        note: options.note,
      });
      await saveStore(store, env);
      console.log(`${pc.green('Added')} ${provider.name}`);
    });

  program.command('edit')
    .argument('<name>', 'provider name or id')
    .description('Edit provider fields without opening the TUI')
    .option('-n, --name <name>', 'new provider name')
    .option('-u, --base-url <url>', 'new base_url')
    .option('-k, --api-key <key>', 'new API key')
    .option('--note <text>', 'new note')
    .action(async (name, options) => {
      const store = await ensureStore(env);
      const provider = findProvider(store, name);

      if (!provider) {
        throw new Error(`找不到 provider: ${name}`);
      }

      if (options.name) {
        const error = validateProviderName(options.name, store, provider.id);
        if (error) throw new Error(error);
      }

      if (options.baseUrl) {
        const error = validateBaseUrl(options.baseUrl);
        if (error) throw new Error(error);
      }

      if (options.apiKey) {
        const error = validateApiKey(options.apiKey);
        if (error) throw new Error(error);
      }

      const updated = updateProvider(store, provider.id, {
        name: options.name ?? provider.name,
        baseUrl: options.baseUrl ?? provider.baseUrl,
        apiKey: options.apiKey ?? provider.apiKey,
        note: options.note ?? provider.note,
      });

      await saveStore(store, env);
      console.log(`${pc.green('Updated')} ${updated.name}`);
    });

  program.command('remove')
    .alias('rm')
    .argument('<name>', 'provider name or id')
    .option('-y, --yes', 'skip confirmation')
    .description('Remove a provider')
    .action(async (name, options) => {
      const store = await ensureStore(env);
      const provider = findProvider(store, name);

      if (!provider) {
        throw new Error(`找不到 provider: ${name}`);
      }

      if (!options.yes) {
        throw new Error('删除操作需要 --yes 确认，或在 TUI 中删除');
      }

      removeProvider(store, provider.id);
      await saveStore(store, env);
      console.log(`${pc.green('Removed')} ${provider.name}`);
    });

  program.command('doctor')
    .description('Inspect config paths and current Codex values')
    .action(async () => {
      const store = await ensureStore(env);
      const status = await inspectCodex(store, env);
      console.log(formatCodexStatus(status));

      if (!status.configExists || status.configError || status.authError) {
        process.exitCode = 1;
      }
    });

  program.command('settings')
    .alias('setup')
    .description('Open the Codex path settings screen')
    .action(async () => {
      await runSettingsTui(env);
    });

  const proxyCommand = program.command('proxy')
    .description('Start the local provider proxy server')
    .option('--host <host>', 'listen host')
    .option('-p, --port <port>', 'listen port')
    .action(async (options) => {
      const store = await ensureStore(env);
      const proxy = proxyConfigFromOptions(store, options);
      await startProxyServer({ env, host: proxy.host, port: proxy.port });
    });

  proxyCommand.command('setup')
    .description('Configure Codex to use the local proxy')
    .option('--host <host>', 'proxy host written to Codex config')
    .option('-p, --port <port>', 'proxy port written to Codex config')
    .option('--api-key <key>', 'local placeholder key written to Codex auth.json')
    .option('--start', 'start the proxy in the background after setup')
    .action(async (options) => {
      const store = await ensureStore(env);
      const proxy = proxyConfigFromOptions(store, { ...options, enabled: true }, proxyCommand.opts());
      const result = await configureCodexProxy(store, proxy, env);

      store.proxy = proxy;
      await saveStore(store, env);
      console.log(formatProxySetupResult(result, proxy));

      if (options.start) {
        const started = await startProxyDaemon({ env, proxy, entryPath: process.argv[1], logger: silentLogger() });
        console.log(formatProxyStartResult(started));
      }
    });

  proxyCommand.command('start')
    .description('Start the local proxy in the background')
    .option('--host <host>', 'listen host')
    .option('-p, --port <port>', 'listen port')
    .action(async (options) => {
      const store = await ensureStore(env);
      const proxy = proxyConfigFromOptions(store, options, proxyCommand.opts());
      store.proxy = normalizeProxyConfig({ ...proxy, enabled: true });
      await saveStore(store, env);

      const result = await startProxyDaemon({ env, proxy: store.proxy, entryPath: process.argv[1], logger: silentLogger() });
      console.log(formatProxyStartResult(result));
    });

  proxyCommand.command('status')
    .description('Show local proxy mode status')
    .action(async () => {
      const store = await ensureStore(env);
      const proxy = normalizeProxyConfig(store.proxy);
      const [health, pid] = await Promise.all([
        readProxyHealth(proxy),
        readProxyPid(env),
      ]);

      console.log(formatProxyStatus(store, { ...health, pid }));
      if (!health.running && store.proxy?.enabled) {
        process.exitCode = 1;
      }
    });

  proxyCommand.command('stop')
    .description('Stop the background local proxy')
    .action(async () => {
      const result = await stopProxyDaemon({ env });

      if (result.stopped) {
        console.log(`${pc.green('CPS proxy stopped')} ${pc.dim(`pid ${result.pid}`)}`);
        return;
      }

      if (result.reason === 'no-pid-file') {
        console.log(`${pc.yellow('CPS proxy was not started by cps proxy start')}\n${pc.dim(`pid file missing: ${result.pidPath}`)}`);
        process.exitCode = 1;
        return;
      }

      if (result.reason === 'stale-pid') {
        console.log(`${pc.yellow('Removed stale proxy pid file')} ${pc.dim(`pid ${result.pid}`)}`);
        return;
      }

      console.log(`${pc.red('Failed to stop CPS proxy')} ${pc.dim(`pid ${result.pid}`)}`);
      process.exitCode = 1;
    });

  proxyCommand.command('restart')
    .description('Restart the local proxy in the background')
    .option('--host <host>', 'listen host')
    .option('-p, --port <port>', 'listen port')
    .action(async (options) => {
      await stopProxyDaemon({ env });
      const store = await ensureStore(env);
      const proxy = proxyConfigFromOptions(store, options, proxyCommand.opts());
      store.proxy = normalizeProxyConfig({ ...proxy, enabled: true });
      await saveStore(store, env);

      const result = await startProxyDaemon({ env, proxy: store.proxy, entryPath: process.argv[1], logger: silentLogger() });
      console.log(formatProxyStartResult(result));
    });

  proxyCommand.command('disable')
    .description('Disable proxy mode and write the active provider directly to Codex')
    .action(async () => {
      const store = await ensureStore(env);
      const provider = store.activeProvider ? findProvider(store, store.activeProvider) : null;
      store.proxy = normalizeProxyConfig({ ...(store.proxy || {}), enabled: false });

      if (!provider) {
        await saveStore(store, env);
        console.log(`${pc.green('Proxy mode disabled')}\n${pc.dim('No active provider was written to Codex.')}`);
        return;
      }

      const result = await switchCodexProvider(store, provider, env);
      const activeProvider = setActiveProvider(store, provider);
      await saveStore(store, env);
      console.log(`${pc.green('Proxy mode disabled')}\n\n${formatSwitchResult(activeProvider || provider, result)}`);
    });

  program.command('where')
    .description('Print the provider store path')
    .action(() => {
      console.log(getStorePath(env));
    });

  await program.parseAsync(argv);
}

function proxyConfigFromOptions(store, options = {}, parentOptions = {}) {
  const port = options.port ?? parentOptions.port;

  return normalizeProxyConfig({
    ...(store.proxy || {}),
    enabled: options.enabled ?? store.proxy?.enabled,
    host: options.host ?? parentOptions.host ?? store.proxy?.host,
    port: port === undefined ? store.proxy?.port : parsePortOption(port),
    apiKey: options.apiKey ?? store.proxy?.apiKey,
  });
}

function parsePortOption(value) {
  const port = Number(value);

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error('proxy port must be an integer between 1 and 65535');
  }

  return port;
}

function formatProxyStartResult(result) {
  const lines = [
    result.started ? pc.green('CPS proxy started') : pc.green('CPS proxy already running'),
    `${pc.dim('url')} ${result.health.url}`,
  ];

  if (result.pid) {
    lines.push(`${pc.dim('pid')} ${result.pid}`);
  }

  if (result.logPath) {
    lines.push(`${pc.dim('log')} ${result.logPath}`);
  }

  return lines.join('\n');
}

function silentLogger() {
  return {
    log() {},
    error() {},
  };
}
