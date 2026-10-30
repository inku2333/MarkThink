# 开发与构建说明

## 环境要求

| 组件 | 版本要求 |
| --- | --- |
| Node.js | 18+ |
| npm | 9+ |
| Rust | stable（MSVC 工具链） |
| MSVC 生成工具 | VS2022（Windows） |
| WebView2 Runtime | 任意新版（Win10/11 通常已预装） |

Linux 需要 `webkit2gtk-4.1` 与 `libappindicator3`；macOS 需要 Xcode 命令行工具。

## 首次安装

```bash
npm install
```

Rust 工具链若未安装：

```bash
rustup toolchain install stable-x86_64-pc-windows-msvc
```

国内网络可配置镜像加速：

```bash
export RUSTUP_DIST_SERVER=https://rsproxy.cn
export RUSTUP_UPDATE_ROOT=https://rsproxy.cn/rustup
```

## 常用命令

```bash
npm run dev          # 仅前端，浏览器预览（无文件与 AI 能力）
npm run tauri:dev    # 桌面开发模式，热更新
npm run tauri:build  # 生产构建 + 安装包
```

## 测试

```bash
npm test                       # 前端：大纲锚点对齐、标题计数
cd src-tauri && cargo test     # 后端：流解析、提示词、模型目录

# 需要本机运行 Ollama 的集成测试
OLLAMA_TEST_MODEL=qwen3.5:4b cargo test -- --ignored --nocapture
```

## 代码签名

主配置 `src-tauri/tauri.conf.json` 中不含证书指纹，任何人克隆后都能直接构建。
如需为自己的构建签名，创建 `src-tauri/tauri.local.conf.json`（已被 `.gitignore` 忽略）：

```json
{
  "bundle": {
    "windows": {
      "certificateThumbprint": "<你的证书指纹>"
    }
  }
}
```

构建时合并：

```bash
npx tauri build --config src-tauri/tauri.local.conf.json
```

> 不要把 `.pfx` / `.p12` 私钥文件提交到仓库。

## 目录说明

```
src/
  components/   界面组件
  lib/          渲染与 AI 管线
  state/        应用状态
  styles/       主题与样式
src-tauri/
  src/          Rust 后端
  tests/        集成测试
samples/        测试文档
```

## 添加新的模型提供方

1. 在 `src-tauri/src/ai_provider.rs` 的 `providers()` 中登记元信息，
   包括 `protocol`（`openai` / `anthropic` / `gemini` / `ollama`）。
2. 若该服务不兼容上述任一协议，新增一个 `run_*` 异步函数，并实现对应的
   `parse_*` 行解析器，返回 `StreamEvent::Delta`（答案）、
   `StreamEvent::Reasoning`（思维链）或 `StreamEvent::Done`。
3. 在 `interpret_document` 的 `match provider.protocol` 中接入。
4. 前端无需改动，面板会按 `needsKey` / `needsEndpoint` / `models` 自动显示字段。

注意：思考型模型（qwen3、DeepSeek-R1）会把推理放进独立字段。
推理应走 `Reasoning` 事件（界面显示「思考中」），不要混进答案；
若模型只输出推理不输出答案，`consume_stream` 会在流结束时回退展示推理内容。

## 添加新的 Markdown 语法

在 `src/lib/markdown.ts` 的 `createMarkdownIt` 中注册 markdown-it 插件或自定义 rule。

若新增语法会产生 `<h1>`–`<h6>`，**必须**同步更新 `src/lib/blocks.ts` 的
`renderedHeadingCount()`，否则窗口化渲染的分块锚点会与文档大纲错位
（历史 bug：引用块、列表项、数学块内的标题曾导致点击「列表」跳到「图表」）。
`src/lib/__tests__/outline.test.ts` 会校验这一不变量。

## WebView2 启动失败的排查

`src-tauri/src/lib.rs` 会在启动时为 WebView2 选择一个可写的配置目录，
依次尝试本地 AppData、Roaming AppData、临时目录、可执行文件同级目录。
如果全部不可写，应用会弹出对话框说明原因，而不是静默退出。
