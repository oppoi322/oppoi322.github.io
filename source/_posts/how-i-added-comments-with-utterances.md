---
title: 给 Hexo + GitHub Pages 加评论：utterances（用 GitHub Issues 作为评论存储）
date: 2026-03-22 15:13:00
tags:
  - Hexo
  - GitHub Pages
  - utterances
  - 评论系统
categories:
  - 技术
---

这个博客是跑在 GitHub Pages 上的静态站点：它只有 HTML/CSS/JS 文件，没有数据库、也没有后端服务进程。

因此“评论”这种需要 **写入/保存** 的功能，必须把数据存到别的地方（第三方服务、云函数、或某种可写存储）。我最终采用的是 **utterances**：

- 评论 UI 在文章页下方（读者不需要跳去 GitHub 页面操作）
- 评论数据存储在 GitHub 仓库的 **Issues** 里（每篇文章对应一个 Issue 线程）
- 读者评论时需要 GitHub 登录（防垃圾、也更省事）

本文记录接入过程，以及它背后大概用了哪些 GitHub 能力。

## 1. 为什么静态站点“天然没有评论”

静态站点部署到 GitHub Pages 后：

- 浏览器只能 **GET** 到页面文件
- 没有一个可以 **POST** 新评论、写数据库的后端

所以评论系统通常两种路线：

1) **接第三方评论服务**（它提供后端 + 存储）
2) **自己搭一个后端**（云函数 / serverless 也行）

utterances 属于一种很巧妙的“第三条路”：把 GitHub Issues 当成数据库。

## 2. utterances 的工作原理（概念版）

当你打开某篇文章时，页面底部会加载一段脚本：

- 它会根据文章的唯一标识（我们用的是 `pathname`）
- 在指定仓库里找到对应的 Issue
  - 找到了：就把 Issue 下面的评论渲染出来
  - 没找到：首次评论时会自动创建一个 Issue，然后再把评论写进去

你在页面里发的每条评论，本质上都会变成 GitHub 上该 Issue 的一条 **comment**。

### “每篇文章一个 Issue”是怎么做到的？

utterances 支持多种映射策略（`issue_term`）：

- `pathname`：用文章路径作为 key（当前站点使用）
- `url`：用完整 URL
- `title` / `og:title`：用标题

我们选择 `pathname` 的直觉原因是：

- 同一篇文章的路径固定时，评论线程就固定
- 不需要依赖标题（标题改了可能导致映射变化）

## 3. 为什么要在 GitHub 上“Install App”？

这不是下载到电脑上的那种 App，而是 **GitHub App 授权**。

原因：

- 评论要写入 Issues，属于“写操作”
- GitHub 必须确保这是一个被授权的应用在操作仓库资源

安装时建议选择：

- **Only select repositories** → 只授权 `oppoi322/oppoi322.github.io` 这一个仓库

这样权限范围最小。

## 4. 我在 Hexo 里做了哪些改动

Hexo 的 `landscape` 主题原生只有 Disqus / Valine 的插槽，没有 utterances。

因此我做了三件事：

### 4.1 把主题放进仓库（便于自定义）

把 `themes/landscape/` 放进源码仓库，让 GitHub Actions 构建时也能拿到我们修改过的模板。

### 4.2 新增 utterances 的模板片段

新增文件：

- `themes/landscape/layout/_partial/comments/utterances.ejs`

里面就是 utterances 官方提供的嵌入脚本（略微参数化）：

- `repo`：评论存储的仓库
- `issue-term`：映射策略
- `theme`：评论区主题

### 4.3 在文章页模板里插入评论区

在文章页模板（`themes/landscape/layout/_partial/article.ejs`）末尾加入：

- 仅在“文章详情页”显示（不是首页列表）
- 仅在该文章允许评论时显示

这样评论区会出现在正文后面。

### 4.4 在主题配置里加 utterances 配置

在 `themes/landscape/_config.yml` 里加了：

```yml
utterances:
  repo: oppoi322/oppoi322.github.io
  issue_term: pathname
  theme: github-light
```

## 5. 这套方案用到了哪些 GitHub 能力（API 视角）

从效果上看，utterances 主要依赖的是：

- **GitHub Issues**：作为“每篇文章一个线程”的存储
- **Issue Comments**：评论本体
- **GitHub App 授权**：让脚本能安全地读写 Issues

具体到 API 层面（不用你自己写 API 调用，utterances 都封装好了），大致会涉及：

- 查询/创建 Issue
- 查询/创建 Issue Comment

你在页面里看到的“回复某条评论”，其实就是在对应 Issue 里继续回复（同一个线程下的评论流）。

## 6. 优缺点

优点：

- 不用自建服务器/数据库
- 评论天然带账号体系（减少垃圾评论）
- 评论数据在你自己的 GitHub 仓库里，可导出、可管理

缺点：

- 评论者需要 GitHub 登录（不是完全匿名）
- 仓库里会多出一些 Issues（这就是评论存储的代价）

---

如果你也想给自己的 `xxx.github.io` 加评论：utterances 是“最轻量、最不需要运维”的路线之一。
