# 上传到 GitHub 操作指南

本文件记录把 MarkThink 发布到 GitHub 的完整步骤，包括代码仓库和 Release 安装包。
本文档本身可以删掉，或保留作为备忘。

> 本地已完成的部分：Git 仓库初始化（`main` 分支）、首个提交、`v0.1.0` 标签、
> 签名安装包（`target/release/bundle/nsis/MarkThink_0.1.0_x64-setup.exe`）。
> 下面从「创建远程仓库」开始，都是需要你在 GitHub 上操作的部分。

---

## 一、创建远程仓库

1. 打开 <https://github.com/new>
2. **Repository name** 填 `MarkThink`
3. **Description** 可填：`现代、简约、优雅的 Markdown 阅读器，支持多模型 AI 解读`
4. 选择 **Public**（要开源就选公开）
5. **不要**勾选 "Add a README file"、".gitignore"、"license" ——
   本地已有这些文件，勾选会造成冲突
6. 点击 **Create repository**

创建后会看到一个"快速设置"页面，复制其中 **HTTPS** 地址，形如：

```
https://github.com/inku2333/MarkThink.git
```

---

## 二、把本地代码推上去

在项目根目录（`C:\D\MDYUki`）执行：

```bash
# 1. 关联远程仓库（把地址换成你复制的那串）
git remote add origin https://github.com/inku2333/MarkThink.git

# 2. 确认关联成功
git remote -v

# 3. 推送 main 分支，并设置上游跟踪
git push -u origin main

# 4. 推送标签
git push origin v0.1.0
```

第 3 步会弹出登录窗口。**认证方式说明**：

GitHub 自 2021 年起不接受账号密码，必须用 **Personal Access Token（PAT）**：

1. 打开 <https://github.com/settings/tokens>
2. **Generate new token** → **Generate new token (classic)**
3. Note 随便填，Expiration 选 90 天或自定义
4. 勾选 **`repo`** 权限（必须），如需操作 Release 再加 **`workflow`**
5. 生成后**立刻复制** token（只显示一次）
6. 推送时：
   - Username 填 `inku2333`
   - Password 填 **token**（不是你的 GitHub 登录密码）

> 也可以装 [GitHub CLI](https://cli.github.com/)，用 `gh auth login` 走浏览器授权，
> 之后 `git push` 免 token。若你常推代码，推荐这种方式。

**验证**：推送完成后刷新 GitHub 页面，应能看到 110 个文件。

---

## 三、上传 Release 安装包

安装包体积 6.8 MB，**不能**直接进 Git 仓库（会把仓库搞臃肿），
必须走 GitHub 的 **Releases** 功能作为附件上传。

### 方式 A：网页操作（推荐，最直观）

1. 打开仓库页面 → 右侧 **Releases** → **Create a new release**
2. **Choose a tag** → 选择已有的 `v0.1.0`（如果你已推送标签）
   若没看到，点 "Select tag" 手动输入 `v0.1.0` 并选 "Create new tag"
3. **Release title** 填 `MarkThink 0.1.0`
4. **Describe this release** 填发行说明，例如：

   ```markdown
   ## MarkThink 0.1.0

   首个公开版本。

   ### 功能
   - Markdown 阅读：GFM、脚注、表格、任务列表
   - 代码高亮：Shiki，30+ 语言
   - 数学公式：KaTeX，支持多行矩阵
   - 图表：Mermaid 流程图 / 时序图 / 甘特图
   - AI 解读：DeepSeek / OpenAI / Moonshot / 智谱 / 通义 /
     OpenRouter / Anthropic / Gemini / Ollama 本地模型

   ### 安装
   下载下方 `MarkThink_0.1.0_x64-setup.exe` 直接安装。

   > Windows 安装包使用自签名证书，首次运行可能提示未知发布者，
   > 不影响使用。
   ```

5. **Attach binaries** 区域：把
   `C:\D\MDYUki\target\release\bundle\nsis\MarkThink_0.1.0_x64-setup.exe`
   拖进虚线框（或点 "Attach binaries by dropping them here or selecting them"）
6. 点击 **Publish release**

### 方式 B：命令行（GitHub CLI）

```bash
gh release create v0.1.0 \
  "target/release/bundle/nsis/MarkThink_0.1.0_x64-setup.exe" \
  --title "MarkThink 0.1.0" \
  --notes "首个公开版本，详见 README。"
```

---

## 四、日常开发流程

改完代码后：

```bash
git status                 # 看看改了哪些文件
git diff                   # 看具体改动内容
git add -A                 # 暂存所有改动
git commit -m "说明这次改了什么"
git push                   # 推送到 GitHub
```

**提交信息建议**用中文或英文都可以，写清楚"做了什么、为什么"，
例如 `修复大纲锚点错位`、`feat: 新增 AI 追问对话`。

### 发布新版本

```bash
# 1. 改版本号（package.json、src-tauri/Cargo.toml、src-tauri/tauri.conf.json 三处）
# 2. 构建
npx tauri build --bundles nsis --config src-tauri/tauri.local.conf.json

# 3. 提交并打标签
git add -A
git commit -m "release: v0.2.0"
git tag -a v0.2.0 -m "MarkThink 0.2.0"
git push && git push origin v0.2.0

# 4. 上传新安装包（网页或 gh release create v0.2.0 ...）
```

---

## 五、常见问题

**推送被拒绝（rejected / non-fast-forward）**
远程有本地没有的提交（常见于网页上改过 README）。先拉取合并：

```bash
git pull --rebase origin main
git push
```

**想确认某个文件会不会被上传**

```bash
git ls-files | grep 文件名        # 已跟踪的
git check-ignore -v 某文件        # 被忽略的，会说明是哪条规则
```

**误把大文件提交了**
从 Git 历史里彻底删除较麻烦（需 `git filter-repo`）。
最省事的做法是在提交前用 `git status` 检查一遍。
本项目的 `.gitignore` 已覆盖 `node_modules/`、`target/`、`dist/`、
`.toolchain/`、`.certs/`、`tauri.local.conf.json` 等。

**Token 泄露了怎么办**
立刻去 <https://github.com/settings/tokens> 撤销该 token，重新生成。

**换电脑后如何继续开发**

```bash
git clone https://github.com/inku2333/MarkThink.git
cd MarkThink
npm install
```

签名证书是机器本地的，新电脑上没有，构建时不加 `--config` 即可（不签名也能出包）。

---

## 六、给仓库加点门面（可选）

在仓库根目录可补充这些文件，GitHub 会自动识别：

| 文件 | 作用 |
| --- | --- |
| `.github/ISSUE_TEMPLATE/bug_report.md` | Bug 报告模板 |
| `.github/ISSUE_TEMPLATE/feature_request.md` | 功能建议模板 |
| `.github/workflows/build.yml` | CI：每次推送自动构建，验证能编译通过 |
| `CONTRIBUTING.md` | 贡献指南 |
| `CHANGELOG.md` | 版本变更记录 |

另外建议在仓库 **Settings → General** 里：

- **Topics** 填 `markdown`、`tauri`、`rust`、`react`、`ai`、`desktop-app`
  这样别人更容易搜到
- 确认 **Features → Issues**、**Discussions** 按需开启
