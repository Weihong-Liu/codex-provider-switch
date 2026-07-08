# codex-provider-switch

一个用来切换 Codex provider 的小工具。

它可以管理多个 provider 的 `base_url` 和 `API Key`，并支持本地 proxy 模式。开启 proxy 模式后，多个已经打开的 Codex 进程也可以在下一次请求时使用新的 provider，不需要每次切换都重启 Codex。

## 安装

现在可以直接从 GitHub 安装：

```bash
npm install -g github:Weihong-Liu/codex-provider-switch
```

安装后会有两个命令：

```bash
cps
codex-provider-switch
```

两个命令是一样的，`cps` 更短。

更新到最新版：

```bash
npm install -g github:Weihong-Liu/codex-provider-switch
```

不想全局安装，也可以临时运行：

```bash
npx -y github:Weihong-Liu/codex-provider-switch
```

## 推荐用法

推荐使用 proxy 模式。

第一次配置：

```bash
cps proxy setup --start
```

这条命令会做两件事：

1. 把 Codex 的 `base_url` 改成本地代理地址：`http://127.0.0.1:17888`
2. 在后台启动 `cps` 本地代理

第一次开启 proxy 模式后，请把已经打开的 Codex 进程重启一次。以后再切 provider 就不需要重启了。

查看代理是否正在运行：

```bash
cps proxy status
curl http://127.0.0.1:17888/__cps/health
```

如果显示 `Proxy runtime running`，说明代理正在运行。

## 添加 Provider

用命令添加：

```bash
cps add --name inferlab --base-url https://crsapi.inferlab.tech --api-key sk-xxx
```

也可以直接打开界面添加：

```bash
cps
```

## 切换 Provider

```bash
cps use inferlab
```

如果已经启用 proxy 模式，这条命令不会再改 Codex 的 `auth.json`，只会修改当前 active provider。

只要 `cps proxy start` 正在运行，Codex 下一次请求就会走新的 provider。

## Proxy 常用命令

后台启动 proxy：

```bash
cps proxy start
```

前台启动 proxy，终端需要一直开着：

```bash
cps proxy
```

查看状态：

```bash
cps proxy status
```

重启 proxy：

```bash
cps proxy restart
```

停止后台 proxy：

```bash
cps proxy stop
```

关闭 proxy 模式，恢复成直接写入 Codex 配置：

```bash
cps proxy disable
```

## 常见问题

### Codex 报 `error sending request for url (http://127.0.0.1:17888/responses)`

通常是 proxy 没有运行。

运行：

```bash
cps proxy start
cps proxy status
```

再检查：

```bash
curl http://127.0.0.1:17888/__cps/health
```

### `cps proxy setup` 后还是不生效

`cps proxy setup` 只负责改 Codex 配置。如果没有加 `--start`，还需要再运行：

```bash
cps proxy start
```

第一次 setup 后，已经打开的 Codex 进程还记着旧配置，所以需要重启一次 Codex。

### 切换 provider 后正在输出的请求会变吗

不会。

已经开始 streaming 的请求会继续使用它开始时的 provider。下一次新请求才会使用新的 active provider。

### 默认端口是多少

默认监听：

```text
127.0.0.1:17888
```

不要把 proxy 绑定到公网地址，除非你明确知道自己在做什么。

## 配置和数据存放位置

provider 数据保存在：

```text
~/.config/codex-provider-switch/providers.json
```

这个文件里有 API Key，工具会用 `0600` 权限写入。

proxy 日志和 pid 文件也在同一个目录：

```text
~/.config/codex-provider-switch/proxy.log
~/.config/codex-provider-switch/proxy.pid
```

Codex 默认配置文件：

```text
~/.codex/config.toml
~/.codex/auth.json
```

如果你的 Codex 配置不在默认位置，可以运行：

```bash
cps setup
```

或者设置环境变量：

```bash
CPS_CODEX_CONFIG=/path/to/config.toml
CPS_CODEX_AUTH=/path/to/auth.json
```

## 常用命令速查

```bash
cps
cps setup
cps list
cps add --name inferlab --base-url https://crsapi.inferlab.tech --api-key sk-xxx
cps use inferlab
cps proxy setup --start
cps proxy status
cps proxy restart
cps proxy stop
cps doctor
cps where
```

## 开发

```bash
npm install
npm test
npm run pack:check
```
