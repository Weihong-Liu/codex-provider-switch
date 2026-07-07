import test from 'node:test';
import assert from 'node:assert/strict';

import {
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
