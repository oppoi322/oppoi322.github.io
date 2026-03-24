# rose_fist 开发过程与自我评估（迭代记录）

> 目标：识别到“握拳/rock/fist”后，把玫瑰花叠加到拳头上，像“握着一朵玫瑰”。

## 总体方案

- **手部检测/关键点**：MediaPipe Hands（非自训练，直接用现成推理）
- **握拳判定**：启发式（四根手指的 PIP 关节角度）
- **叠加**：PNG（带 alpha）缩放+旋转后，alpha-blend 到掌心位置

为何选启发式：
- 训练一个稳健的“握拳分类模型”需要数据集、训练、验证、部署；时间成本高。
- MediaPipe 已能给出 21 个关键点，基于几何做规则可以快速得到可运行 demo。

---

## 迭代评估 01：确认目标、选技术路线
- 发现/问题：需求允许传统/深度学习，我选择 **MediaPipe + 几何规则**。
- 解决：搭建 Python 环境；准备 rose_fist 项目骨架。
- 结果：路线确定，可开始实现。

## 迭代评估 02：准备素材（玫瑰 PNG）
- 发现/问题：尝试从 Wikimedia 下载 `Rose.png`，多次 **SSL timeout**。
- 解决：改用 GitHub 可访问的资源：Twemoji 的玫瑰 emoji PNG（透明背景）。随后为了“枝条更长”与更清晰展示，又补充了 Fluent UI Emoji / OpenMoji 版本作为可选素材。
- 结果：获得 `assets/rose_twemoji.png`。

## 迭代评估 03：准备握拳测试图片（真实图片）
- 发现/问题：从 MediaPipe 仓库下载的 `front_camera_pixel2.jpg` 手部检测失败（MediaPipe Hands 返回 None）。
- 解决：重新找更“干净”的手势数据源，最终选用 **RockPaperScissorsCNN** 仓库的 `rock/paper/scissors` 示例图。
- 结果：`rock_sample.png` 可以稳定检测到手。

## 迭代评估 04：MediaPipe Hands 在卡通图上不工作
- 发现/问题：我自己画的卡通拳头图片（PIL）无法被 MediaPipe 检测到。
- 解决：放弃卡通图，优先使用真实数据集示例（RPS）。
- 结果：检测稳定性提升。

## 迭代评估 05：握拳判定方法选择
- 发现/问题：直接用 y 坐标判断“伸直/弯曲”会受手旋转影响。
- 解决：改用 **PIP 关节角度**：角度接近 180° = 伸直；很小 = 弯曲。
- 结果：对旋转更鲁棒。

## 迭代评估 06：阈值与分类测试
- 发现/问题：需要验证阈值在 rock/paper/scissors 上区分度。
- 解决：在三张图上计算四指 PIP 角度：
  - rock：4 根手指都“弯曲”（角度很小）
  - paper：0 根手指弯曲（角度接近 180）
  - scissors：2 根弯曲
- 结果：选择规则 `curled_angle < 160°` 且 `curled_count >= 3` 判为 fist。

## 迭代评估 07：玫瑰叠加位置与尺寸
- 发现/问题：需要把玫瑰放在“拳头/掌心”而不是任意位置。
- 解决：用 wrist + 四个 MCP 的均值近似 palm center；尺寸用 hand bbox 的 0.9 倍。
- 结果：玫瑰在 rock 图上覆盖在手部区域附近。

## 迭代评估 08：输出验证
- 发现/问题：需要确认确实输出了图片且大小正确。
- 解决：脚本输出 `outputs/rock_with_rose.png` 并检查文件类型/大小。
- 结果：输出成功。

## 迭代评估 09：资源清理与鲁棒性
- 发现/问题：下载失败时生成了 404 文本文件（伪装成 .jpg/.png），会污染 assets。
- 解决：删除无效资源；增加 `.gitignore` 忽略 outputs 与 venv。
- 结果：仓库更干净，运行更可复现。

## 迭代评估 10：仓库集成与交付
- 发现/问题：需要把完整项目放进 `oppoi322.github.io` 的 `source/rose_fist`。
- 解决：提交并 push 到 GitHub。
- 结果：完成代码交付。

---

## 成功/失败结论

- **成功**：在 `assets/rock_sample.png`（握拳/rock）上能检测手并叠加玫瑰，生成 `outputs/rock_with_rose.png`。
- **局限**：
  - 该版本是启发式规则，并非训练分类器；在复杂真实场景（遮挡、手套、极端角度、多人、光照差）可能误判。
  - 玫瑰的位置是 palm center 近似，并未做精确的“手指夹持点”估计。

## 后续可改进方向

1. 增加更多真实握拳样例进行阈值校准与统计验证（precision/recall）。
2. 使用 MediaPipe 的 handedness、手掌法线方向，对玫瑰姿态做更真实的旋转。
3. 若要更稳健：采集数据 + 训练一个轻量分类器（输入 21 点的归一化坐标）。
