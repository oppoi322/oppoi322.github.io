---
title: 从零开始理解 CNN：卷积（Convolution）、ReLU、池化（Max Pooling）到底在做什么？
date: 2026-03-23 17:40:00
categories:
  - 技术
tags:
  - 深度学习
  - 计算机视觉
  - CNN
  - ReLU
  - MaxPool
  - PyTorch
---

很多人第一次读 AlexNet 会觉得“深奥”，其实问题不在 AlexNet，而在于：**CNN 的三个基础积木（卷积 / 激活函数 / 下采样）没理解透**。

这篇我不从 AlexNet 开始，也不追求把你一次讲到“能复现 ImageNet 精度”。我只做一件事：

> 从 0 把 CNN 的基本直觉和数学讲清楚，让你看任何 CNN（AlexNet/VGG/ResNet/ConvNeXt）都能说出：它到底在算什么、为什么这么算。

写法：中文为主，夹带必要英文术语，给可运行的 PyTorch 例子（但不强行训练大模型）。

<!-- more -->

## 0. 你需要先记住的 3 句话

1) **卷积层（Convolution layer）不是“在图片上滑来滑去”这么简单**，它真正的价值是：
   - 局部连接（local connectivity）
   - 权重共享（weight sharing）
   - 平移等变（translation equivariance）

2) **ReLU** 的价值不只是“换了个激活函数”，它解决的是：
   - 深网训练时的梯度传播（gradient flow）
   - 可优化性（optimization landscape）

3) **Max Pooling** 的本质是：
   - 有损下采样（lossy downsampling）
   - 用信息丢失换取计算/泛化/不变性（invariance）的收益

理解这三点，你再看 AlexNet 的“ReLU + overlapping maxpool + 大卷积核”就不会玄学。

---

## 1. CNN 解决的核心矛盾：图像太大，但有效规律很局部

假设输入是一张彩色图：`224×224×3`。

如果你用一个普通全连接层（Fully Connected, FC）把它直接连到 4096 维：

- 输入维度：224*224*3 ≈ 150k
- 参数量：150k * 4096 ≈ 6e8（6 亿级别）

这还只是第一层，根本训练不动。

CNN 的思想很朴素：

- 图像里的模式（边缘、角点、纹理）通常是**局部出现**的
- 同一种模式可能在图里很多位置出现（猫耳朵可以在左上也可以在右下）

所以我们希望：

- 只看局部（local）
- 同一个检测器在所有位置复用（share）

这就自然导向了卷积。

---

## 2. 卷积（Convolution）到底在做什么？

### 2.1 最小例子：单通道 2D 卷积（先别管多通道）

有一张 5×5 的灰度图（输入）：

```text
X (5x5)
1 1 1 0 0
0 1 1 1 0
0 0 1 1 1
0 0 1 1 0
0 1 1 0 0
```

一个 3×3 卷积核（kernel/filter）：

```text
K (3x3)
 1  0 -1
 1  0 -1
 1  0 -1
```

这个 K 很像在做“垂直边缘检测”：

- 左边为正、右边为负
- 如果局部区域左亮右暗（或相反），输出会大

卷积输出的某一个位置，其实就是：

- 从 X 里取一个 3×3 patch
- 和 K 做逐元素乘法再求和（dot product）

所以卷积层本质就是：**在很多局部区域上重复做同一个线性模型**。

### 2.2 “权重共享”带来什么？参数暴减

如果 kernel 是 3×3：

- 你只需要 9 个权重（+1 个 bias）
- 不管输入图像是 32×32 还是 224×224，这 9 个权重都能用

这就是 CNN 参数量爆降的根源。

### 2.3 平移等变（equivariance） vs 平移不变（invariance）

卷积有一个重要性质：

- 输入平移一点，输出的特征图也会平移一点

这叫 **equivariance**（等变），不是 invariance（不变）。

等变的意义是：

- 网络可以在任何位置检测同一种模式
- 后续层再决定“这个模式出现在哪里”是否重要

而 pooling / stride 等下采样，才会进一步带来“近似不变”。

---

## 3. stride 和 padding：为什么会改变输出尺寸？

卷积输出大小公式（只要记这一条）：

\[
H_{out} = \left\lfloor \frac{H_{in} + 2p - k}{s} \right\rfloor + 1
\]

- `k`：kernel size
- `s`：stride（步幅）
- `p`：padding（补边）

直觉解释：

- stride 越大，你“滑动得越快”，输出就越小（下采样更猛）
- padding 越大，你在边界补了更多虚拟像素，输出就可能变大/不缩水

一个非常关键的工程结论：

- **下采样可以用 pooling 做，也可以用 stride>1 的卷积做**
- AlexNet 第一层用 stride=4 的大卷积核，就是当年算力约束下的“快速下采样”

---

## 4. ReLU：为什么它让深网训练突然变得“能跑”？

ReLU 的定义只有一句话：

\[
\mathrm{ReLU}(x) = \max(0, x)
\]

听起来太简单，所以容易被轻视。但它解决的核心问题是：

### 4.1 梯度传播：别让导数在深层里“死掉”

假设你用 sigmoid/tanh。

- sigmoid 在很大一段区域导数接近 0（饱和）
- tanh 也一样

深网里梯度要穿过很多层链式法则：

\[
\frac{\partial L}{\partial x} = \frac{\partial L}{\partial y}\cdot\frac{\partial y}{\partial x}
\]

如果每层的 \(\partial y/\partial x\) 都很小，那乘着乘着就接近 0（vanishing gradient）。

ReLU 在正半轴导数是 1：

- 很大一部分激活不会缩小梯度
- 优化器更容易“把误差传回去”

这就是 AlexNet 论文里强调的：ReLU 能让训练快很多。

### 4.2 稀疏激活（sparsity）：一种天然的正则

ReLU 会把负数截断为 0，这意味着：

- 很多神经元对某张图像根本不激活
- 表征变得更稀疏

稀疏往往会带来更好的泛化（你可以把它理解成一种结构化的 feature selection）。

### 4.3 ReLU 的坑：Dead ReLU

ReLU 也不是完美：

- 如果某个神经元长期落在负半轴，梯度为 0，它可能“死掉”

这就是后来会出现 LeakyReLU / ELU / GELU 等变体的原因之一。

但在 2012 年那个训练配方里，ReLU 的优势远大于问题。

---

## 5. Max Pooling：它不是“为了防过拟合”这么一句话

Max pooling 的定义：在一个窗口里取最大值。

如果窗口是 2×2：

```text
[1 3]        -> 3
[2 0]
```

### 5.1 它做了三件事

1) **下采样**：特征图变小，计算量下降
2) **局部不变性**：小位移导致的激活位置变化，被 pooling 吃掉一部分
3) **信息选择**：max 只保留“最强响应”，其它细节丢失

这第三点很关键：pooling 是有损的（lossy）。

所以 pooling 的真正问题是：

- 你愿意丢掉哪些信息，换来哪些收益？

### 5.2 为什么 AlexNet 用“overlapping pooling”（3×3 stride 2）？

很多现代模型用 2×2 stride 2（不重叠）。

AlexNet 用 3×3 stride 2，窗口之间会重叠：

- 重叠意味着下采样更“平滑”
- 边界效应更弱
- 论文报告它能带来小但稳定的误差下降（0.x% 那种）

你可以把它当作当年“recipes 还不丰富”时的一种有效 trick。

### 5.3 现代替代：stride conv、avg pool、甚至不 pool

后续的发展里，pooling 逐渐没那么“必需”：

- 很多网络直接用 stride=2 的卷积做下采样
- ViT 系列甚至把下采样变成 patch embedding

但理解 pooling 仍然重要：它解释了早期 CNN 的“特征图为什么变小”。

---

## 6. 用 PyTorch 直观看看：卷积/池化/ReLU 的 shape 怎么变

下面这段代码你直接跑，就能看到：

- 经过 conv 输出尺寸如何变化
- pooling 之后如何变化
- ReLU 不改 shape，但改分布

```python
import torch
import torch.nn as nn

x = torch.randn(1, 3, 227, 227)  # NCHW

conv1 = nn.Conv2d(3, 96, kernel_size=11, stride=4, padding=0)
relu = nn.ReLU()
pool = nn.MaxPool2d(kernel_size=3, stride=2)

y = conv1(x)
print('conv1:', y.shape)   # (1, 96, 55, 55)

y = relu(y)
print('relu :', y.shape)   # shape 不变

y = pool(y)
print('pool :', y.shape)   # (1, 96, 27, 27)
```

如果你跑出来不是 55/27，说明你对 stride/padding 的直觉还没形成——那就回到第 3 节再对照公式算一次。

---

## 7. 为什么这些基础积木拼起来就能识别物体？（从“边缘”到“语义”）

一条常见的解释链：

- 前几层：边缘/角点/简单纹理（low-level features）
- 中间层：局部结构（例如眼睛、轮廓片段）
- 后几层：更抽象的组合（例如“脸”“车轮”“动物身体”）

卷积负责“在局部检测模式”，层层堆叠就是逐渐扩大感受野（receptive field），让网络看见更大范围的组合。

ReLU 让这种层叠在优化上可行。

Pooling/stride 让计算可控，并在某种程度上引入不变性。

当你把这条链打通，再看 AlexNet/VGG/ResNet 的差别，你会发现它们都在回答同一个问题：

> 我应该用什么方式扩大感受野、增加表达能力，同时还能训练得动、泛化得好？

---

## 8. 读到这里，再去看 AlexNet 会轻松很多

AlexNet 的关键“时代感”可以总结成：

- 用较大的早期卷积核 + 大 stride 快速下采样（算力约束）
- 用 ReLU 让深网训练变快（优化约束）
- 用 pooling/LRN/dropout/augmentation 顶住泛化（经验配方）
- 用双 GPU 分拆 + groups=2（显存约束）

下一篇我会把这套基础直接嫁接到 AlexNet：逐层解释它为什么这么设计，并给你一份可跑的小规模训练脚本（用 ImageWoof 或 ImageNet 子集）。

---

## References（写作参考）

1) LeCun et al. **Gradient-Based Learning Applied to Document Recognition** (LeNet-5, 1998)
- http://yann.lecun.com/exdb/publis/pdf/lecun-98.pdf

2) Goodfellow, Bengio, Courville. **Deep Learning**（教科书，CNN/优化基础）
- https://www.deeplearningbook.org/

3) Stanford CS231n Notes（CNN 基础讲得很清楚）
- https://cs231n.github.io/convolutional-networks/

4) Krizhevsky, Sutskever, Hinton. **ImageNet Classification with Deep Convolutional Neural Networks**（AlexNet 原文）
- https://www.cs.toronto.edu/~kriz/imagenet_classification_with_deep_convolutional.pdf
