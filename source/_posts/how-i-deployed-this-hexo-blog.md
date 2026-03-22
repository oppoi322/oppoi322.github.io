---
title: 我是如何把这个 Hexo 博客部署到 GitHub Pages（oppoi322.github.io）
date: 2026-03-22 14:20:00
tags:
  - Hexo
  - GitHub Pages
  - GitHub Actions
  - 部署
categories:
  - 技术
---

这篇文章记录一下这个站点（`oppoi322.github.io`）从 0 到上线的全过程：本地生成 Hexo、把源码推到 GitHub、用 GitHub Actions 自动构建、最后由 GitHub Pages 对外提供访问。

> 说明：本文更像是一份“可复现的流水账”。如果你照着做，基本可以把自己的 `xxx.github.io` 也搭起来。

## 目标

- 用 Hexo 生成静态博客
- 源码放在仓库 `oppoi322/oppoi322.github.io` 的 `main` 分支
- 由 GitHub Actions 自动构建（生成 `public/`）
- 构建产物发布到 `gh-pages` 分支
- GitHub Pages 从 `gh-pages` 分支根目录提供站点：<https://oppoi322.github.io/>

## 1. 本地初始化 Hexo

环境：Node.js + npm（或 pnpm）。

初始化一个 Hexo 站点：

```bash
npm i -g hexo-cli
hexo init blog
cd blog
npm i
```

本地预览：

```bash
npx hexo server
```

生成静态文件（产物在 `public/`）：

```bash
npx hexo clean
npx hexo generate
```

## 2. 创建 GitHub Pages 仓库

GitHub Pages 的默认规则是：

- 个人主页仓库名必须是：`<用户名>.github.io`

所以这里仓库名是：

- `oppoi322.github.io`

仓库设为 Public。

## 3. 把 Hexo 源码推到 main 分支

在 Hexo 项目根目录初始化 git，并推到 GitHub：

```bash
git init -b main
git add -A
git commit -m "init hexo"

git remote add origin https://github.com/oppoi322/oppoi322.github.io.git
git push -u origin main
```

同时建议加 `.gitignore`，不要把 `node_modules/`、`public/` 之类提交进去：

```gitignore
node_modules/
public/
.deploy_git/
.DS_Store
Thumbs.db
```

> 这里选择“提交源码而不是提交 public”，因为我们希望由 Actions 来负责构建。

## 4. 配置 GitHub Actions：构建并发布到 gh-pages

在仓库里创建工作流文件：`.github/workflows/pages.yml`。

核心逻辑：

1) checkout 代码
2) 安装依赖
3) `hexo generate` 生成 `public/`
4) 使用 `peaceiris/actions-gh-pages` 把 `public/` 推到 `gh-pages` 分支

本次部署中用的是 **pnpm**（因为项目里有 `pnpm-lock.yaml`），工作流大致如下：

```yaml
name: Deploy Hexo to GitHub Pages

on:
  push:
    branches:
      - main
  workflow_dispatch:

permissions:
  contents: write

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 9

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build
        run: |
          pnpm exec hexo clean
          pnpm exec hexo generate

      - name: Deploy
        uses: peaceiris/actions-gh-pages@v4
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./public
```

### 踩过的坑

- 一开始用 `npm ci`，但仓库里没有 `package-lock.json`（只有 `pnpm-lock.yaml`），所以 CI 直接报错。
- 后来切到 pnpm，但需要注意顺序：要先安装 pnpm，再让 `setup-node` 进行 pnpm 缓存配置，否则会出现 “找不到 pnpm 可执行文件”。

## 5. 配置 GitHub Pages 的 Source

进入仓库 Settings → Pages：

- Source 选择 `gh-pages` 分支
- 目录选择 `/(root)`

保存后等待构建完成。

如果出现短暂 404/errored，通常是 Pages 构建队列或缓存，需要等一会儿；必要时可以重新触发一次 Pages build。

## 6. 以后如何写文章并发布

写一篇新文章：

```bash
npx hexo new "My Post"
```

编辑 `source/_posts/*.md`，然后提交并推到 `main`：

```bash
git add -A
git commit -m "add post"
git push
```

推送到 `main` 后，Actions 会自动构建并把生成的静态文件发布到 `gh-pages`，页面随后更新。

---

如果你也想做一个自己的 `xxx.github.io`：最关键的就三件事——仓库名规则、Actions 自动发布、Pages 指向 `gh-pages` 分支。其余都是“锦上添花”的主题和内容。
