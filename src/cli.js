import { Command } from 'commander';
import pc from 'picocolors';

import { inspectCodex, switchCodexProvider } from './codex.js';
import { formatCodexStatus, formatProviderList, formatSwitchResult } from './format.js';
import { getStorePath } from './paths.js';
import {
  addProvider,
  ensureStore,
  findProvider,
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

  program.command('where')
    .description('Print the provider store path')
    .action(() => {
      console.log(getStorePath(env));
    });

  await program.parseAsync(argv);
}
