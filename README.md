# codex-provider-switch

A small TUI and CLI for switching Codex provider `base_url` and `OPENAI_API_KEY`.

## Quick Start

Run the main TUI without installing anything globally:

```bash
npx -y codex-provider-switch@latest
```

Open the settings screen directly:

```bash
npx -y codex-provider-switch@latest settings
```

The package also exposes a short command after global install:

```bash
npm install -g codex-provider-switch
cps
cps setup
```

## Commands

```bash
codex-provider-switch
codex-provider-switch settings
codex-provider-switch list
codex-provider-switch add --name my-provider --base-url http://127.0.0.1:8080 --api-key sk-xxx
codex-provider-switch use my-provider
codex-provider-switch doctor
codex-provider-switch where
```

`settings` also has the alias `setup`.

## Storage

Provider records are stored at:

```text
~/.config/codex-provider-switch/providers.json
```

The file is written with `0600` permissions because it contains API keys.

## What It Changes

When switching provider, the tool:

1. Backs up `~/.codex/config.toml` and `~/.codex/auth.json` with timestamped `.bak-YYYYMMDD-HHMMSS` files.
2. Updates `base_url` in the active `[model_providers.<name>]` table from `model_provider`.
3. Updates `OPENAI_API_KEY` in `~/.codex/auth.json`.
4. Marks the selected provider as active in the provider store.

If you need non-default Codex paths, run:

```bash
codex-provider-switch settings
```

Or set:

```bash
CPS_CODEX_CONFIG=/path/to/config.toml
CPS_CODEX_AUTH=/path/to/auth.json
```

## Development

```bash
npm install
npm test
npm run pack:check
```

## Publish

Upload to GitHub:

```bash
git init
git add .
git commit -m "Initial release"
gh repo create Weihong-Liu/codex-provider-switch --private --source=. --remote=origin --push
```

Publish to npm so `npx -y codex-provider-switch@latest` works:

```bash
npm login
npm publish
```

If you want to publish under another package name, change `name` in `package.json` before publishing.
