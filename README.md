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

Run directly from GitHub before publishing to npm:

```bash
npx -y github:Weihong-Liu/codex-provider-switch
npx -y github:Weihong-Liu/codex-provider-switch settings
```

The package also exposes a short command after global install:

```bash
npm install -g codex-provider-switch
cps
cps setup
```

Install globally from GitHub before publishing to npm:

```bash
npm install -g github:Weihong-Liu/codex-provider-switch
cps
cps setup
```

If the GitHub repo is private, authenticate first:

```bash
gh auth login
gh auth setup-git
```

You can pin a specific branch, tag, or commit:

```bash
npx -y github:Weihong-Liu/codex-provider-switch#main
npm install -g github:Weihong-Liu/codex-provider-switch#main
```

## Commands

```bash
codex-provider-switch
codex-provider-switch settings
codex-provider-switch list
codex-provider-switch add --name my-provider --base-url http://127.0.0.1:8080 --api-key sk-xxx
codex-provider-switch use my-provider
codex-provider-switch proxy setup
codex-provider-switch proxy
codex-provider-switch proxy status
codex-provider-switch proxy disable
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

## Proxy Mode

Proxy mode is the best option when you keep multiple Codex processes open.
Codex is configured once to call a local proxy, and `cps use <provider>` only changes the active provider used by that proxy.

Set up Codex to use the local proxy:

```bash
cps proxy setup
```

After the first setup, restart already running Codex processes once so they pick up the local proxy URL. Future provider switches do not need a restart.

Start the proxy in a terminal and keep it running:

```bash
cps proxy
```

Switch providers without restarting existing Codex processes:

```bash
cps use my-provider
```

Existing Codex processes continue to call the same local URL. The proxy reads the active provider on every request and injects that provider's API key before forwarding the request upstream.

Check proxy status:

```bash
cps proxy status
curl http://127.0.0.1:17888/__cps/health
```

Return to direct Codex config/auth writes:

```bash
cps proxy disable
```

Notes:

1. `cps proxy` must be running for proxy mode requests to work.
2. A request already streaming will keep using the provider it started with; the next request uses the newly active provider.
3. The proxy listens on `127.0.0.1:17888` by default. Avoid binding it to a public interface unless you know exactly what you are doing.

## What It Changes

When switching provider, the tool:

1. Backs up `~/.codex/config.toml` and `~/.codex/auth.json` with timestamped `.bak-YYYYMMDD-HHMMSS` files.
2. Updates `base_url` in the active `[model_providers.<name>]` table from `model_provider`.
3. Updates `OPENAI_API_KEY` in `~/.codex/auth.json`.
4. Marks the selected provider as active in the provider store.

In proxy mode, switching provider only updates the active provider in the store. Codex keeps using the local proxy URL, and the proxy forwards each new request to the current active provider.

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
