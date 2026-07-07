import {
  cancel,
  confirm,
  intro,
  isCancel,
  log,
  note,
  outro,
  select,
} from '@clack/prompts';
import pc from 'picocolors';

import { inspectCodex, switchCodexProvider } from './codex.js';
import { formatCodexStatus, formatProviderList, formatSwitchResult } from './format.js';
import { APP_NAME, getResolvedCodexPaths } from './paths.js';
import { FIELD_BACK, FIELD_CANCEL, fieldInput } from './prompts.js';
import {
  addProvider,
  ensureStore,
  findProvider,
  maskApiKey,
  removeProvider,
  saveStore,
  setActiveProvider,
  sortProviders,
  updateProvider,
  validateApiKey,
  validateBaseUrl,
  validateProviderName,
} from './store.js';

const BACK = Symbol('back');

export async function runTui(env = process.env) {
  let store = await ensureStore(env);
  intro(`${pc.bold('Codex Provider Switch')} ${pc.dim('base_url / API key manager')}`);

  while (true) {
    store = await ensureStore(env);
    const status = await inspectCodex(store, env);
    note(`${formatCodexStatus(status)}\n\n${formatProviderList(store)}`, 'Status');

    const action = await promptValue(select({
      message: '选择操作',
      options: [
        { value: 'switch', label: '切换 provider', hint: '写入 Codex config/auth' },
        { value: 'add', label: '新增 provider', hint: 'base_url + API key' },
        { value: 'edit', label: '编辑 provider' },
        { value: 'delete', label: '删除 provider' },
        { value: 'settings', label: '设置 Codex 路径' },
        { value: 'doctor', label: '诊断配置' },
        { value: 'quit', label: '退出' },
      ],
    }));

    if (action === 'quit') {
      outro('bye');
      return;
    }

    try {
      if (action === 'switch') {
        await switchProviderFlow(store, env);
      } else if (action === 'add') {
        await addProviderFlow(store, env);
      } else if (action === 'edit') {
        await editProviderFlow(store, env);
      } else if (action === 'delete') {
        await deleteProviderFlow(store, env);
      } else if (action === 'settings') {
        await settingsFlow(store, env);
      } else if (action === 'doctor') {
        await doctorFlow(store, env);
      }
    } catch (error) {
      if (error === BACK) {
        continue;
      }
      log.error(error instanceof Error ? error.message : String(error));
    }
  }
}

export async function runSettingsTui(env = process.env) {
  const store = await ensureStore(env);
  intro(`${pc.bold('Codex Provider Switch')} ${pc.dim('settings')}`);

  try {
    await settingsFlow(store, env);
    outro(`saved to ${APP_NAME}`);
  } catch (error) {
    if (error === BACK) {
      outro('bye');
      return;
    }

    throw error;
  }
}

async function switchProviderFlow(store, env) {
  const provider = await chooseProvider(store, '选择要切换的 provider');
  const shouldSwitch = await promptBack(confirm({
    message: `确认切换到 ${provider.name}？`,
    initialValue: true,
  }));

  if (!shouldSwitch) {
    return;
  }

  const result = await switchCodexProvider(store, provider, env);
  const activeProvider = setActiveProvider(store, provider);
  await saveStore(store, env);
  note(formatSwitchResult(activeProvider || provider, result), 'Switched');
}

async function addProviderFlow(store, env) {
  const draft = await runFieldWizard({
    steps: [
      {
        label: 'Provider 名称',
        input: (values) => ({
          message: 'Provider 名称',
          placeholder: 'Name',
          initialValue: values.name,
          validate: (value) => validateProviderName(value, store),
        }),
        assign: (values, value) => {
          values.name = String(value).trim();
        },
      },
      {
        label: 'base_url',
        input: (values) => ({
          message: 'base_url',
          placeholder: 'https://api.example.com',
          initialValue: values.baseUrl,
          validate: validateBaseUrl,
        }),
        assign: (values, value) => {
          values.baseUrl = String(value).trim();
        },
      },
      {
        label: 'API Key',
        input: () => ({
          message: 'API Key',
          mask: '*',
          validate: validateApiKey,
        }),
        assign: (values, value) => {
          values.apiKey = value;
        },
      },
      {
        label: '备注',
        input: (values) => ({
          message: '备注（可选）',
          placeholder: 'Note',
          initialValue: values.note,
          allowEmpty: true,
        }),
        assign: (values, value) => {
          values.note = String(value || '').trim();
        },
      },
    ],
  });

  const provider = addProvider(store, {
    name: draft.name,
    baseUrl: draft.baseUrl,
    apiKey: draft.apiKey,
    note: draft.note,
  });

  await saveStore(store, env);
  note(`${provider.name}\n${provider.baseUrl}\n${maskApiKey(provider.apiKey)}`, '已新增');
}

async function editProviderFlow(store, env) {
  const provider = await chooseProvider(store, '选择要编辑的 provider');
  const draft = await runFieldWizard({
    initialValues: {
      name: provider.name,
      baseUrl: provider.baseUrl,
      apiKey: '',
      note: provider.note,
    },
    steps: [
      {
        label: 'Provider 名称',
        input: (values) => ({
          message: 'Provider 名称',
          initialValue: values.name,
          validate: (value) => validateProviderName(value, store, provider.id),
        }),
        assign: (values, value) => {
          values.name = String(value).trim();
        },
      },
      {
        label: 'base_url',
        input: (values) => ({
          message: 'base_url',
          initialValue: values.baseUrl,
          validate: validateBaseUrl,
        }),
        assign: (values, value) => {
          values.baseUrl = String(value).trim();
        },
      },
      {
        label: 'API Key',
        input: (values) => ({
          message: values.apiKey
            ? `API Key（已输入新值，当前保存值 ${maskApiKey(provider.apiKey)}）`
            : `API Key（留空表示不修改，当前 ${maskApiKey(provider.apiKey)}）`,
          mask: '*',
          allowEmpty: true,
          validate: (value) => value ? validateApiKey(value) : undefined,
        }),
        assign: (values, value) => {
          if (value) {
            values.apiKey = value;
          }
        },
      },
      {
        label: '备注',
        input: (values) => ({
          message: '备注（可选）',
          placeholder: 'Note',
          initialValue: values.note,
          allowEmpty: true,
        }),
        assign: (values, value) => {
          values.note = String(value || '').trim();
        },
      },
    ],
  });

  const updated = updateProvider(store, provider.id, {
    name: draft.name,
    baseUrl: draft.baseUrl,
    apiKey: draft.apiKey || provider.apiKey,
    note: draft.note,
  });

  await saveStore(store, env);
  note(`${updated.name}\n${updated.baseUrl}\n${maskApiKey(updated.apiKey)}`, '已更新');
}

async function deleteProviderFlow(store, env) {
  const provider = await chooseProvider(store, '选择要删除的 provider');
  const shouldDelete = await promptBack(confirm({
    message: `确认删除 ${provider.name}？这不会修改当前 Codex 配置。`,
    initialValue: false,
  }));

  if (!shouldDelete) {
    return;
  }

  removeProvider(store, provider.id);
  await saveStore(store, env);
  note(provider.name, '已删除');
}

async function settingsFlow(store, env) {
  const current = getResolvedCodexPaths(store, env);
  const draft = await runFieldWizard({
    initialValues: {
      configPath: current.configPath,
      authPath: current.authPath,
      modelProvider: store.codex.modelProvider || '',
    },
    steps: [
      {
        label: 'Codex config.toml 路径',
        input: (values) => ({
          message: 'Codex config.toml 路径',
          initialValue: values.configPath,
        }),
        assign: (values, value) => {
          values.configPath = String(value || '').trim();
        },
      },
      {
        label: 'Codex auth.json 路径',
        input: (values) => ({
          message: 'Codex auth.json 路径',
          initialValue: values.authPath,
        }),
        assign: (values, value) => {
          values.authPath = String(value || '').trim();
        },
      },
      {
        label: 'Codex model provider 表名',
        input: (values) => ({
          message: 'Codex model provider 表名（留空则读取 model_provider）',
          initialValue: values.modelProvider,
          allowEmpty: true,
        }),
        assign: (values, value) => {
          values.modelProvider = String(value || '').trim();
        },
      },
    ],
  });

  store.codex = {
    configPath: draft.configPath || null,
    authPath: draft.authPath || null,
    modelProvider: draft.modelProvider || null,
  };

  await saveStore(store, env);
  note('设置已保存。', 'Settings');
}

async function doctorFlow(store, env) {
  const status = await inspectCodex(store, env);
  note(formatCodexStatus(status), 'Doctor');

  if (status.configError) {
    log.error(`config: ${status.configError}`);
  }
  if (status.authError) {
    log.error(`auth: ${status.authError}`);
  }

  await promptBack(select({
    message: '诊断完成',
    options: [
      { value: 'back', label: '返回上一层' },
    ],
  }));
}

async function chooseProvider(store, message) {
  if (!store.providers.length) {
    throw new Error('暂无 provider，请先新增。');
  }

  const id = await promptBack(select({
    message,
    options: [
      ...sortProviders(store.providers).map((provider) => ({
        value: provider.id,
        label: provider.name,
        hint: `${provider.baseUrl} ${maskApiKey(provider.apiKey)}`,
      })),
      { value: '__back__', label: '返回上一层' },
    ],
  }));

  if (id === '__back__') {
    throw BACK;
  }

  return findProvider(store, id);
}

async function runFieldWizard({ steps, initialValues = {} }) {
  const values = { ...initialValues };
  let index = 0;

  while (index < steps.length) {
    const step = steps[index];
    const value = await fieldInput({
      ...step.input(values),
      isFirst: index === 0,
      isLast: index === steps.length - 1,
    });

    if (value === FIELD_CANCEL) {
      throw BACK;
    }

    if (value === FIELD_BACK) {
      if (index === 0) {
        throw BACK;
      }
      index = Math.max(index - 1, 0);
      continue;
    }

    step.assign(values, value);
    index += 1;
  }

  return values;
}

async function promptBack(prompt) {
  return promptValue(prompt, { cancelAction: 'back' });
}

async function promptValue(prompt, options = {}) {
  const value = await prompt;
  if (isCancel(value)) {
    if (options.cancelAction === 'back') {
      throw BACK;
    }
    cancel('cancelled');
    process.exit(0);
  }
  return value;
}
