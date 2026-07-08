import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  configureCodexProxy,
  readActiveModelProvider,
  readBaseUrlFromToml,
  timestampForFileName,
  updateBaseUrlInToml,
} from './codex.js';

test('reads active model provider', () => {
  assert.equal(readActiveModelProvider('model_provider = "OpenAI"\n'), 'OpenAI');
});

test('reads base_url from active provider table', () => {
  const text = [
    'model_provider = "OpenAI"',
    '',
    '[model_providers.OpenAI]',
    'name = "OpenAI"',
    'base_url = "https://old.example.com"',
    '',
    '[features]',
    'goals = true',
  ].join('\n');

  assert.equal(readBaseUrlFromToml(text, 'OpenAI'), 'https://old.example.com');
});

test('updates base_url only in target model provider table', () => {
  const text = [
    'model_provider = "OpenAI"',
    '',
    '[model_providers.OpenAI]',
    'name = "OpenAI"',
    'base_url = "https://old.example.com"',
    '',
    '[model_providers.Other]',
    'base_url = "https://other.example.com"',
  ].join('\n');

  const updated = updateBaseUrlInToml(text, 'OpenAI', 'http://localhost:8080');

  assert.match(updated, /base_url = "http:\/\/localhost:8080"/);
  assert.match(updated, /base_url = "https:\/\/other.example.com"/);
});

test('adds base_url when target provider table exists without one', () => {
  const text = [
    'model_provider = "OpenAI"',
    '',
    '[model_providers.OpenAI]',
    'name = "OpenAI"',
    'wire_api = "responses"',
    '',
    '[features]',
    'goals = true',
  ].join('\n');

  const updated = updateBaseUrlInToml(text, 'OpenAI', 'https://api.example.com');

  assert.match(updated, /\[model_providers\.OpenAI\]\nname = "OpenAI"\nwire_api = "responses"\nbase_url = "https:\/\/api.example.com"\n\n\[features\]/);
});

test('formats deterministic backup timestamp', () => {
  assert.equal(timestampForFileName(new Date('2026-07-07T15:04:05')), '20260707-150405');
});

test('configures Codex to use the local proxy', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cps-codex-proxy-test-'));
  const configPath = path.join(tempDir, 'config.toml');
  const authPath = path.join(tempDir, 'auth.json');
  const store = {
    codex: {
      configPath,
      authPath,
      modelProvider: null,
    },
  };

  try {
    await fs.writeFile(configPath, [
      'model_provider = "OpenAI"',
      '',
      '[model_providers.OpenAI]',
      'name = "OpenAI"',
      'base_url = "https://old.example.com"',
      '',
    ].join('\n'));

    const result = await configureCodexProxy(store, {
      enabled: true,
      host: '127.0.0.1',
      port: 17888,
      apiKey: 'local-placeholder',
    });

    assert.equal(result.proxyBaseUrl, 'http://127.0.0.1:17888');
    assert.match(await fs.readFile(configPath, 'utf8'), /base_url = "http:\/\/127\.0\.0\.1:17888"/);
    assert.deepEqual(JSON.parse(await fs.readFile(authPath, 'utf8')), {
      OPENAI_API_KEY: 'local-placeholder',
    });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
