---
title: 把 Hexo 首页从“全文展开”改成“标题列表”
date: 2026-03-22 15:21:00
tags:
  - Hexo
  - 主题
  - landscape
categories:
  - 技术
---

我一开始打开首页时，主题会把每篇文章的正文直接渲染出来（看起来像“所有文章都展开了”）。我更希望首页只展示标题，点击标题后再看全文。

## 改法（landscape 主题）

这个站点使用的是 `landscape` 主题。

首页模板在：

- `themes/landscape/layout/index.ejs`

原来是：

```ejs
<%- partial('_partial/archive', {expand: true, index: true}) %>
```

把 `expand: true` 改成 `expand: false`：

```ejs
<%- partial('_partial/archive', {expand: false, index: true}) %>
```

这样首页就会走“归档列表”渲染逻辑：只显示日期 + 标题，不再输出每篇文章的 `post.content`。

## 额外补充

为了以后在列表页控制摘要，我顺便在根配置 `_config.yml` 加了：

```yml
excerpt_separator: "<!-- more -->"
```

之后写文章时插入 `<!-- more -->`，就可以让列表页只显示摘要部分。
