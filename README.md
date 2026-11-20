# MarkThink

> 一个现代、简约、优雅的 Markdown 阅读器，让 AI 陪你读懂每一篇文档。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tauri](https://img.shields.io/badge/Tauri-2.x-24C8DB)](https://tauri.app)
[![React](https://img.shields.io/badge/React-19-61DAFB)](https://react.dev)
[![Rust](https://img.shields.io/badge/Rust-stable-orange)](https://www.rust-lang.org)

MarkThink 是一个基于 Tauri v2 的跨平台 Markdown 阅读器。它用系统自带的 WebView 渲染， 安装包只有 6.7 MB，内存占用约 60 MB，同时把排版、代码高亮、数学公式、图表做到位， 并能接入十家大模型服务，为你的文档生成结构化的解读，同时支持本地Ollama模型，支持转PDF和打印。

作者：[云间Yuki](https://github.com/inku2333)

---

## 特性

### 阅读体验

- **标准 Markdown 与 GFM**：脚注、任务列表、表格、删除线等常用扩展全部支持
- **精确代码高亮**：基于 Shiki，30+ 语言，明暗主题自动切换
- **数学公式**：KaTeX 渲染行内 `$…$` 与块级 `$$…$$`，支持多行矩阵与对齐环境
- **图表**：Mermaid 流程图、时序图、类图、甘特图
- **大纲与搜索**：自动生成标题大纲并随滚动高亮当前章节；全文搜索支持逐个跳转
- **排版可调**：字号、行高、内容宽度、字体（衬线 / 无衬线 / 等宽）实时生效
- **主题**：6 种强调色 × 明亮 / 暗黑 / 跟随系统
- **其他**：拖拽打开、最近记录、外部修改自动重载、导出独立 HTML、打印 / 导出 PDF

### 多标签（v2.0）

像 Notepad++ 一样同时打开多个文档，每个标签互不干扰：

- **标签栏**：切换、关闭（可中键关闭）、超出宽度自动滚动，活动标签始终可见
- **各自独立**：每个文档保存自己的未保存修改、滚动位置与视图模式
- **安全关闭**：有未保存修改的标签在关闭前会确认，`Ctrl+S` 随时保存
- **一次多选**：`Ctrl+O` 可多选文件，逐个在独立标签中打开
- **快捷键**：`Ctrl+W` 关闭、`Ctrl+Tab` / `Ctrl+Shift+Tab` 循环切换、`Ctrl+1…9` 直达

### 可视化编辑（v2.0）

直接改「最终的显示效果」，Markdown 原文由程序自动改写：

- **所见即所得**：在渲染结果上直接打字、选中、拖拽，排版与阅读视图完全一致
- **工具栏**：高频操作用常驻按钮，宽度不够时自动换行，任何窗口尺寸下都点得到
- **「更多」面板**：按用途分组的完整格式库——
  - **段落**：正文、标题 1–6、引用、代码块
  - **字符格式**：加粗、斜体、下划线、删除线、高亮、行内代码、上标、下标、清除格式
  - **列表与对齐**：无序 / 有序 / 任务列表、增减缩进、左 / 中 / 右 / 两端对齐
  - **插入**：链接、表格、图片、分隔线、数学公式、Mermaid 图表、代码片段
  - **颜色与字号**：24 色调色盘 + 原生取色器 + 十六进制输入、8 档字号预设、
    **可自由输入 1–50 的字号**、6 档行高
  - **编辑**：撤销、重做、复制、剪切、删除选中、全选
  - **表格**（光标在表格内时出现）：增删行列、合并 / 拆分单元格、删除表格
- **字体选择**：衬线 / 无衬线 / 等宽 / 楷体 / 宋体 / 黑体
- **源码视图**：需要精确控制时切到源码，选中段落后仍可用样式菜单一键套用
- **公式与图表可编辑**：公式、Mermaid 图表在手边就是「左侧改源码 + 右侧实时预览」，
  改一个字符就能立刻看到渲染结果，语法写错会给出定位提示
- **原样保留**：编辑器无法表达的区块以只读卡片保留，保存时一字不改；
  **没有改动过的区块整段原样写回**，不会重排你的文件
- **位置不丢**：阅读 / 编辑 / 源码之间来回切换，停在哪一页就还在哪一页
- **关前提醒**：有未保存修改时，`Ctrl+W`、关闭标签、关闭全部、甚至点窗口的 ✕
  都会先问一句「保存 / 不保存 / 取消」，保存失败不会把文档关掉
- **面板可拖拽**：左右侧边栏都能拖动调整宽度（双击恢复默认），AI 面板可以拉宽到
  舒服阅读，宽度会被记住
- **AI 产出自动归档**：每次解读完成都会写一份 Markdown 到程序同级的 `MarkThink-AI/`
  文件夹（位置可在设置里改），并默认直接在标签中打开；多轮问答可一键保存成一份
  完整对话记录。同名不同内容自动编号，绝不覆盖

> 保存是原子的：先写临时文件再替换，避免中途失败损坏原文档。
> 原本带 BOM 的文件会原样写回 BOM。

### AI 解读

选中一篇文档，让大模型帮你读懂它。五种解读方式：

| 方式 | 作用 |
| --- | --- |
| 通读解读 | 总览、核心论点、关键概念、结构与值得注意的细节 |
| 结构大纲 | 还原作者的论证层级与章节关系 |
| 批判评估 | 论证强度、潜在问题、作者回避的问题 |
| 通俗讲解 | 面向零基础读者，把难点讲透 |
| 追问对话 | 针对文档内容自由提问，支持多轮 |

支持的模型提供方：

| 提供方 | 协议 | 说明 |
| --- | --- | --- |
| DeepSeek | OpenAI 兼容 | 国内直连，性价比高 |
| OpenAI | OpenAI 兼容 | GPT 系列 |
| Moonshot (Kimi) | OpenAI 兼容 | 长上下文，适合整篇长文档 |
| 智谱 GLM | OpenAI 兼容 | 中文表现稳定 |
| 通义千问 | OpenAI 兼容 | 阿里云百炼 |
| OpenRouter | OpenAI 兼容 | 一个密钥访问多家模型 |
| Anthropic Claude | Anthropic | 长文理解与批判分析 |
| Google Gemini | Gemini | 上下文窗口大 |
| 自定义接口 | OpenAI 兼容 | 任意兼容 `/chat/completions` 的服务 |
| **Ollama** | Ollama | 本地模型，完全离线，文档不出本机 |

细节：

- **流式输出**：结果随生成逐字出现，不必等待整篇完成
- **思考过程分离**：qwen3、DeepSeek-R1 等推理模型会显示「思考中」状态，
  不把思维链混进正文；若模型只输出推理，会自动回退展示推理内容
- **本地模型自动发现**：选择 Ollama 后自动列出本机已下载的模型
- **上下文控制**：可限制发送字数，长文档自动截断并提示
- **连接测试**：一键验证密钥与地址
- **历史记录**：本次会话的解读结果可回看

## 性能设计

大文档不卡顿是这个项目的核心目标之一：

- **分块窗口化渲染**：文档按块分组，只挂载视口附近的 DOM。
  实测 1000 块 / 112 KB 的文档滚动时内存稳定在 63 MB
- **懒加载**：语法高亮、KaTeX、Mermaid 全部按需加载，首屏只渲染纯 HTML
- **流式节流**：AI 输出更新做节流，避免每帧重渲染
- **异步后端**：文件读取、目录遍历、AI 流由 tokio 处理，UI 不阻塞
- **大文件保护**：超过 24 MB 的文件只加载前 24 MB 并提示

## 安装

从 [Releases](https://github.com/inku2333/MarkThink/releases) 下载对应平台的安装包。

- **Windows**：`MarkThink_x64-setup.exe`
- **macOS**：`MarkThink_aarch64.dmg` / `MarkThink_x64.dmg`
- **Linux**：`.AppImage` / `.deb`

> **关于「未知发布者」提示**
> Windows 安装包使用自签名证书，在未安装该证书的机器上首次运行可能提示未知发布者。
> 这不影响使用；如需消除提示，可将随包提供的证书安装到「受信任的根证书颁发机构」
> 与「受信任的发布者」。

## 从源码构建

### 环境要求

| 组件 | 版本 |
| --- | --- |
| Node.js | 20.19+ 或 22.12+（Vite 7 的要求） |
| Rust | stable（MSVC 工具链） |
| WebView2 Runtime | Windows 10/11 通常已预装 |

Linux 还需 `webkit2gtk-4.1` 与 `libappindicator3`。

### 步骤

```bash
# 1. 安装前端依赖
npm install

# 2. 开发模式（热更新）
npm run tauri:dev

# 3. 生产构建 + 安装包
npm run tauri:build
```

构建产物位于仓库根目录的 `target/release/`：`markthink.exe` 是主程序，
安装包在 `target/release/bundle/nsis/`（由 `.cargo/config.toml` 的
`target-dir` 指定，不是 `src-tauri/target`）。

> 本机没有系统级 Rust，工具链随仓库放在 `.toolchain/`，由 `npm run tauri:*`
> 自动注入 `CARGO_HOME` / `RUSTUP_HOME` / `PATH`（见 [BUILD.md](BUILD.md) 2.1.1）。
> 想手敲 `cargo` 先执行 `call rust-env.cmd`。

### 测试

```bash
npm test                       # 前端单元测试（大纲锚点、搜索索引与分块导航）
npm run rust:test              # 后端单元测试（流解析、提示词、模型目录）

# 需要本机运行 Ollama 的集成测试
OLLAMA_TEST_MODEL=qwen3.5:4b npm run rust:test -- -- --ignored --nocapture
```

### 代码签名（可选）

`src-tauri/tauri.conf.json` 中**不含**证书指纹，因此任何人都能直接构建。
如需签名，创建 `src-tauri/tauri.local.conf.json`（已被 `.gitignore` 忽略）：

```json
{
  "bundle": {
    "windows": {
      "certificateThumbprint": "<你的证书指纹>"
    }
  }
}
```

然后构建时合并该配置：

```bash
npm run tauri -- build --config src-tauri/tauri.local.conf.json
```

## 项目结构

```
src/
  components/      界面组件（Reader / Sidebar / AiPanel / AboutDialog / Settings…）
  lib/             渲染管线（markdown / blocks / chunks / search / highlight / math / mermaid）
  state/           Zustand 状态（settings / document / ai）
  styles/          主题变量、全局样式、打印样式
src-tauri/
  src/ai.rs        解读模式提示词与请求组装
  src/ai_provider.rs  多协议流式调用与解析
  src/commands.rs  文件读取、目录列举、导出
  src/watcher.rs   文件变更监听
  tests/           Ollama 集成测试
samples/           测试文档
```

## 快捷键

| 组合 | 功能 |
| --- | --- |
| `Ctrl+O` | 打开文件（可多选，各自开一个标签） |
| `Ctrl+S` | 保存当前文档 |
| `Ctrl+W` | 关闭当前文档 |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | 下一个 / 上一个标签 |
| `Ctrl+1` … `Ctrl+9` | 跳到第 N 个标签 |
| `Ctrl+E` | 循环切换 阅读 / 编辑 / 源码（`Ctrl+Shift+E` 反向） |
| `Ctrl+F` | 文档内搜索 |
| `Ctrl+,` | 设置 |
| `Ctrl+Shift+T` | AI 解读面板 |
| `Esc` | 关闭搜索 / 弹窗 |

## 技术栈

- **外壳**：[Tauri v2](https://tauri.app)（Rust）
- **前端**：React 19 + TypeScript + Vite
- **渲染**：[markdown-it](https://github.com/markdown-it/markdown-it)、
  [Shiki](https://shiki.style)、[KaTeX](https://katex.org)、[Mermaid](https://mermaid.js.org)
- **可视化编辑**：[Tiptap](https://tiptap.dev)（ProseMirror）+ 自研 Markdown 序列化器
- **后端**：Rust + tokio + reqwest

## 贡献

欢迎提交 Issue 和 Pull Request。

- 发现 Bug：请说明复现步骤、系统版本与截图
- 新增模型提供方：参考 [DEVELOPMENT.md](DEVELOPMENT.md) 中的接入说明
- 提交代码前请确保 `npm test` 与 `npm run rust:test` 通过

## 许可证

本项目基于 [MIT License](LICENSE) 开源，© 2026 云间Yuki。

你可以自由使用、修改、分发本项目，包括商业用途，只需保留原始版权声明。

## 致谢

感谢上述所有开源项目的作者，MarkThink 建立在他们之上。
