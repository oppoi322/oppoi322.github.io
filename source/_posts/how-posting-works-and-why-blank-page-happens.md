---
title: 文章是怎么“上传并生效”的？以及为什么有时会出现白屏
date: 2026-03-22 23:40:00
tags:
  - Hexo
  - GitHub Pages
  - GitHub Actions
  - 复盘
categories:
  - 技术
---

很多人第一次用 Hexo + GitHub Pages 时都会有一个直觉：

> “我是不是把 Markdown 文件上传到仓库里就行了？”

答案是：**对于这个站点来说，Markdown 只是“源码的一部分”**。真正对外提供访问的是 *构建后的静态 HTML*。

这篇文章把两件事说清楚：

1) 正常写文章、发布上线的标准流程
2) 为什么有时候明明只是改了点东西，却会导致首页白屏（以及如何避免）

---

## 1. 这个仓库里到底有什么？（源码 vs 产物）

这个博客用的是典型的 GitHub Pages 工作流：

- `main` 分支：存 **源码**
  - `source/_posts/*.md`：文章 Markdown
  - `themes/landscape/**`：主题模板（EJS）、样式、脚本
  - `.github/workflows/pages.yml`：Actions 构建 + 发布脚本

- `gh-pages` 分支：存 **产物**（构建结果）
  - `index.html`
  - `about/index.html`
  - `2026/03/22/.../index.html`
  - `css/`、`js/`、图片等

GitHub Pages 对外提供的，其实就是 `gh-pages` 分支里的那堆 HTML/CSS/JS 文件。

> 换句话说：你打开网页时，浏览器根本不会“现场解析 Markdown”。它只会拿到已经生成好的 HTML。

---

## 2. 正常发布文章的流程（最推荐的做法）

### 2.1 写文章

在仓库里新增/编辑：

- `source/_posts/xxx.md`

建议写作时用 `<!-- more -->` 控制摘要（之前我已经加了 `excerpt_separator` 配置）。

### 2.2 提交源码

把修改 commit 到 `main`：

```bash
git add -A
git commit -m "Add post"
git push
```

### 2.3 GitHub Actions 自动构建

推送到 `main` 后，Actions 会自动执行：

1) 安装依赖（pnpm）
2) `hexo clean`
3) `hexo generate` → 生成 `public/`
4) 把 `public/` 发布到 `gh-pages` 分支

### 2.4 GitHub Pages 提供访问

Pages 配置指向：

- source: `gh-pages` 分支 `/` 根目录

所以只要 `gh-pages` 更新成功，你刷新网页就会看到新文章。

---

## 3. 为什么“上传”会导致白屏？（核心原因）

白屏通常不是因为“文章写坏了”，而是因为 **构建产物坏了**。

最常见的触发方式是：

- 改了主题模板（例如 `themes/landscape/layout/index.ejs`）
- 模板里有语法错误/变量未定义
- `hexo generate` 在生成某个页面（尤其是首页 `index.html`）时出错
- 导致生成出来的 `public/index.html` 是空的（0 字节）或不完整
- 这个坏的 `index.html` 被发布到 `gh-pages`
- 浏览器访问首页，拿到的就是空文件 → 看起来像“全白”

这次我们遇到的就是这种情况：为了做“置顶 sticky”，我修改了首页模板，第一次版本里没有正确处理 Hexo 的 posts 集合和主题里依赖的变量（例如 `index`），导致生成失败，最终 `index.html` 变成了 0 字节。

---

## 4. 如何降低白屏概率（实践建议）

1) **写文章尽量只改 `source/_posts/`**
   - 纯内容改动，风险最低。

2) **改主题/模板前先本地生成一次**

```bash
pnpm exec hexo clean
pnpm exec hexo generate
```

确保本地 `public/index.html` 不是 0 字节，并且能打开。

3) **关注 Actions 的构建日志**

如果页面异常，第一时间看：

- GitHub → Actions → 最新一次工作流是否 success

4) **知道“白屏”往往是首页 HTML 出问题**

可以快速验证：

- 访问 `https://oppoi322.github.io/` 看是否返回空内容
- 或看 `gh-pages` 分支的 `index.html` 是否异常（0 字节）

---

## 5. 复盘：这次白屏是怎么修好的

思路很直接：

1) 先确认现象：HTTP 200 但内容长度为 0
2) 确认根因：`gh-pages/index.html` 是空文件
3) 本地复现：运行 `hexo generate --debug` 定位模板报错
4) 修正模板：保证首页模板能正常渲染
5) 重新发布：让 Actions 生成新的 `public/` 并发布到 `gh-pages`

---

如果你希望把这套流程做得更“像产品”，下一步还可以加一个小检查：当构建出来的 `public/index.html` 为空时，让 CI 直接失败并阻止发布——这样就不会再把空白首页推到线上。
