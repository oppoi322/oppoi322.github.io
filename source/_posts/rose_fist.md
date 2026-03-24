---
title: rose_fist：识别握拳并在拳头上 P 一朵玫瑰（含在线 Demo）
date: 2026-03-24 12:45:00
tags:
  - ComputerVision
  - MediaPipe
  - Demo
categories:
  - Projects
---

这篇文章介绍我做的 **rose_fist** 小项目（已升级为“真实玫瑰照片抠图 + 握持遮挡 + 方向约束”）：

- 当图片中检测到 **握拳（fist/rock）** 时，在拳头（掌心位置附近）叠加一朵玫瑰 PNG，让它看起来像“手里握着玫瑰”。
- 同时提供一个 **网页端 Demo**：可以在文章网页中上传图片，直接看到效果。

项目源码在本仓库：`source/rose_fist/`。

## 1. 在线 Demo

打开：**/rose_fist/demo/**

- 你可以上传任意图片
- 若判断为握拳，会叠加玫瑰
- 若非握拳，不叠加

> Demo 纯前端实现，无需后端。

## 2. 核心思路

### 2.1 手部检测

使用 **MediaPipe Hands / HandLandmarker** 输出 21 个手部关键点。

### 2.2 “握拳”判定（启发式规则）

我用四根手指（食指/中指/无名指/小指）的 **PIP 关节角度**做判断：

- 角度接近 180°：手指较直（打开）
- 角度很小：手指弯曲（握拳时常见）

规则：

- 若 `PIP angle < 160°` 视为该手指“弯曲”
- 统计弯曲手指数量 `curled_count`
- 当 `curled_count >= 3` 判定为 **握拳**

这个规则不是训练出来的模型，但实现简单、可解释，足够作为 Demo。

### 2.3 玫瑰叠加

- 玫瑰素材使用透明背景 PNG（Twemoji）
- 玫瑰位置：用 `wrist + 四个 MCP` 的均值近似 **掌心中心**
- 玫瑰大小：根据手部关键点 bbox 估算
- 玫瑰旋转：用 `wrist -> middle_mcp` 的方向估计手的朝向

## 3. 测试图片与最终效果（必须可见）

我选用了 Rock/Paper/Scissors 数据示例图做测试：

### 3.1 输入（握拳 / rock）

原图：

![](/rose_fist/assets/rock_sample.png)

结果（叠加玫瑰：
1) 玫瑰主方向与拳头方向 **垂直（90°）**
2) 花朵在 **大拇指那一侧**
3) 枝条被手握住（遮挡））：

## 你选择的玫瑰素材（版本 1）

最终效果：

![](/rose_fist/site_images/rock_with_user_rose.png)

原图（抠图前）：

![](/rose_fist/assets/rose_user_selected.jpg)

GrabCut 自动抠图后的透明 PNG：

![](/rose_fist/assets/rose_user_selected_cutout.png)

## 你选择的玫瑰素材（版本 2）

最终效果：

![](/rose_fist/site_images/rock_with_user_rose2.png)

原图（抠图前）：

![](/rose_fist/assets/rose_user_selected2.jpg)

GrabCut 自动抠图后的透明 PNG：

![](/rose_fist/assets/rose_user_selected2_cutout.png)

## 你选择的玫瑰素材（版本 3）

最终效果：

![](/rose_fist/site_images/rock_with_user_rose3.png)

原图（抠图前）：

![](/rose_fist/assets/rose_user_selected3.jpg)

GrabCut 自动抠图后的透明 PNG：

![](/rose_fist/assets/rose_user_selected3_cutout.png)

## 你选择的玫瑰素材（版本 4）

最终效果：

![](/rose_fist/site_images/rock_with_user_rose4.png)

原图（抠图前）：

![](/rose_fist/assets/rose_user_selected4.jpg)

GrabCut 自动抠图后的透明 PNG：

![](/rose_fist/assets/rose_user_selected4_cutout.png)

## 你选择的玫瑰素材（版本 5）

最终效果：

![](/rose_fist/site_images/rock_with_user_rose5_thumbside.png)

（已修正：按“旋转后花朵重心”判定拇指侧；并且让花朵下方与小拇指侧各露出少量绿枝条。）

（对比：上一版）

![](/rose_fist/site_images/rock_with_user_rose5_centroid.png)

原图（抠图前）：

![](/rose_fist/assets/rose_user_selected5.jpg)

GrabCut 自动抠图后的透明 PNG：

![](/rose_fist/assets/rose_user_selected5_cutout.png)

（本次版本 5 使用“你选择的玫瑰照片 + GrabCut 自动抠图”的 cutout 做测试素材：
- 原图：`assets/rose_user_selected5.jpg`
- 抠图：`src/grabcut_cutout.py` 自动生成 `assets/rose_user_selected5_cutout.png`）

（对比：之前“仅花朝向大拇指”的版本）

![](/rose_fist/site_images/rock_with_rose_held_thumb_fluent.png)

- Twemoji（对比）：

![](/rose_fist/site_images/rock_with_rose_held_thumb_twemoji.png)

（对比：旧版“整朵玫瑰直接贴在手上”）

![](/rose_fist/site_images/rock_with_rose.png)

### 3.2 输入（张开手 / paper）

原图：

![](/rose_fist/assets/paper_sample.png)

结果（不叠加玫瑰）：

![](/rose_fist/site_images/paper_with_rose.png)

### 3.3 输入（剪刀手 / scissors）

原图：

![](/rose_fist/assets/scissors_sample.png)

结果（不叠加玫瑰）：

![](/rose_fist/site_images/scissors_with_rose.png)

## 4. 如何在本地跑 Python 版本

```bash
cd source/rose_fist
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt

python src/overlay_rose_on_fist.py \
  --input assets/rock_sample.png \
  --output outputs/rock_with_rose.png \
  --rose assets/rose_twemoji.png
```

## 5. 局限与改进

- 这是启发式规则：复杂真实场景可能误判（遮挡、角度极端、手套、强背光、多人等）。
- 玫瑰放在“掌心中心近似”，不一定是精确的“夹持点”。

改进方向：

1. 收集更多握拳样例做阈值统计（precision/recall）。
2. 训练一个轻量分类器：输入 21 点归一化坐标，输出 fist/non-fist。
3. 对玫瑰姿态用更稳定的手掌平面估计，叠加更自然。

---

附：更详细的开发过程与 10 次迭代评估记录：

- `source/rose_fist/docs/process_report.md`
