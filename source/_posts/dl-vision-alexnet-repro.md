---
title: 视觉深度学习的分水岭（1）：AlexNet 原文精读 + PyTorch 可复现实现（含结构手绘图）
date: 2026-03-23 17:10:00
categories:
  - 技术
tags:
  - 深度学习
  - 计算机视觉
  - AlexNet
  - CNN
  - PyTorch
---

AlexNet（Krizhevsky, Sutskever, Hinton 2012）经常被一句话概括成“它用 GPU 在 ImageNet 上把 CNN 训起来了”。这句话不算错，但太粗。

我更愿意把它当成一次**系统工程的胜利**：模型结构、优化细节、数据增强、并行策略、以及当年极其有限的显存约束，被作者硬生生拼成了一套能跑通、能泛化、能在大赛上赢的方案。

这篇文章我会以**论文原文**为主线，做三件更“硬”的事：

1) 把 AlexNet 逐层拆开：输出尺寸（shape）、参数量（params）、计算量（FLOPs 的量级）、以及每个设计在当年解决的具体痛点
2) 把“经典点”讲透：ReLU 为什么在当时像作弊器、overlapping max-pooling 为什么能带来可量化收益、LRN 到底是什么/为何后来被替代、dropout 何以成为 FC 层救命稻草
3) 给一份**从零写**的 PyTorch AlexNet（不用 torchvision 的现成实现），并给出一套尽量贴近论文语境、但又能在今天的硬件上跑通的复现策略

> 注：我不会在正文里写“我按什么写作风格”“我会怎么满足谁的要求”之类的自我说明——只把内容写扎实。

<!-- more -->

## 1. 论文到底做到了什么：把关键数字读准

先把论文开头那组“能量密度”很高的数字抄在白板上（这一步很重要，因为后面所有工程取舍都围绕这些约束转）：

- 任务：ImageNet LSVRC（当时使用 ILSVRC-2010 / 2012 的子集，1000 classes）
- 数据：约 1.2M 训练图（high-resolution images），1000 类
- 模型规模：约 60M parameters、650k neurons（作者自己的表述）
- 结构：5 个卷积层 + 3 个全连接层 + 1000-way softmax
- 训练硬件：2× GTX 580（3GB 显存）
- 训练时间：约 5–6 天

论文里有两组常被混写的成绩：

- 论文主体叙述的是在 ILSVRC-2010 上训练/测试时的结果（例如 top-1 37.5%，top-5 17.0% 这类数字会出现在摘要中）
- 同时作者也提到他们把一个 variant 送去 ILSVRC-2012，拿到 top-5 15.3%（对比第二名 26.2%）

很多博客会把 15.3% 当成“AlexNet 论文在 2012 的结果”，这在叙事上没问题，但严格说：**摘要里把两件事放在一起讲**，读者需要知道它们指向的 evaluation setting 并不完全相同。

这类“数字对齐”是写深度文章的第一步：你要确保自己引用的每个百分比都在正确的上下文里。

---

## 2. AlexNet 结构：不仅要画出来，还要“算出来”

我先给两张结构图：

- 图 A：一眼看数据流（层级结构）
- 图 B：更像“结构体”的盒图（带关键超参）

### 2.1 图 A：层级结构（dataflow）

假设输入为 `227×227×3`（论文训练时从 `256×256` 中随机裁剪，常见实现会在 224/227 间切换；这里先固定 227 方便算 shape）：

```text
Input: 227x227x3
  |
  |  Conv1: 96, k=11, s=4, p=0          -> 55x55x96
  |  ReLU
  |  LRN
  |  MaxPool: k=3, s=2                  -> 27x27x96
  |
  |  Conv2: 256, k=5,  s=1, p=2, g=2    -> 27x27x256
  |  ReLU
  |  LRN
  |  MaxPool: k=3, s=2                  -> 13x13x256
  |
  |  Conv3: 384, k=3,  s=1, p=1         -> 13x13x384
  |  ReLU
  |
  |  Conv4: 384, k=3,  s=1, p=1, g=2    -> 13x13x384
  |  ReLU
  |
  |  Conv5: 256, k=3,  s=1, p=1, g=2    -> 13x13x256
  |  ReLU
  |  MaxPool: k=3, s=2                  -> 6x6x256
  |
  |  Flatten                             -> 9216
  |  FC6: 4096 + ReLU + Dropout
  |  FC7: 4096 + ReLU + Dropout
  |  FC8: 1000
  |  Softmax
```

### 2.2 图 B：结构体盒图（更“工程”）

```text
┌───────────────────────────────┐
│ Input 227×227×3               │
└───────────────┬───────────────┘
                │
┌───────────────▼───────────────┐
│ Conv1 11×11 s4, 96ch + ReLU   │  -> 55×55×96
│ LRN                             │
│ MaxPool 3×3 s2 (overlap)       │  -> 27×27×96
└───────────────┬───────────────┘
                │
┌───────────────▼───────────────┐
│ Conv2 5×5 s1 p2, 256ch g=2     │  -> 27×27×256
│ + ReLU + LRN                   │
│ MaxPool 3×3 s2 (overlap)       │  -> 13×13×256
└───────────────┬───────────────┘
                │
┌───────────────▼───────────────┐
│ Conv3 3×3 s1 p1, 384ch + ReLU  │  -> 13×13×384
│ Conv4 3×3 s1 p1, 384ch g=2     │  -> 13×13×384
│ Conv5 3×3 s1 p1, 256ch g=2     │  -> 13×13×256
│ MaxPool 3×3 s2                 │  -> 6×6×256
└───────────────┬───────────────┘
                │
┌───────────────▼───────────────┐
│ Flatten 9216                   │
│ FC6 4096 + ReLU + Dropout 0.5  │
│ FC7 4096 + ReLU + Dropout 0.5  │
│ FC8 1000 + Softmax             │
└───────────────────────────────┘
```

到这里仍然只是“画”。想写得深入，必须再做两件事：

- 把 shape 算对（这决定你实现是不是“真 AlexNet”）
- 把参数量算出来（你会立刻理解为什么 dropout 主要用在 FC）

---

## 3. Shape 推导：每一层输出尺寸怎么来的？

卷积/池化输出尺寸公式（只写一遍，后面都用它）：

\[
H_{out} = \left\lfloor \frac{H_{in} + 2p - k}{s} \right\rfloor + 1
\]

以 Conv1 为例：

- 输入 227
- k=11, s=4, p=0

\[
\left\lfloor \frac{227 - 11}{4} \right\rfloor + 1 = \left\lfloor 54 \right\rfloor + 1 = 55
\]

所以 Conv1 输出 55×55×96。

Pool1 是 3×3, s=2（overlapping），p=0：

\[
\left\lfloor \frac{55 - 3}{2} \right\rfloor + 1 = 27
\]

后面同理，你会得到最终进入 FC 的张量是 6×6×256，也就解释了 Flatten 是 9216。

如果你的实现算出来不是 9216，那你八成在输入尺寸/conv1 padding/某个 pooling stride 上偏了。

---

## 4. 参数量：为什么 AlexNet“主要靠 FC 堆参数”？

参数量的计算公式：

- Conv：`Cout * (Cin/groups) * kH * kW + Cout(bias)`
- FC：`out * in + out(bias)`

我们快速估一下量级（不追求每个 bias 的个位数精确，但要抓住结构性的结论）：

### 4.1 Conv1
- Cin=3, Cout=96, k=11
- params ≈ 96 * 3 * 11 * 11 ≈ 34,848（+96 bias）

### 4.2 Conv2（groups=2）
- Cin=96, g=2 → 每组 Cin=48
- Cout=256, 通常也按 2 组分配，每组 Cout=128
- params ≈ 256 * 48 * 5 * 5 = 256 * 1,200 = 307,200（+256 bias）

### 4.3 Conv3
- 384 * 256 * 3 * 3 ≈ 884,736

### 4.4 Conv4（groups=2）
- 384 * (384/2) * 3 * 3 ≈ 663,552

### 4.5 Conv5（groups=2）
- 256 * (384/2) * 3 * 3 ≈ 442,368

把 5 个 conv 加起来，大概是 2–3M 参数级别。

### 4.6 FC6 / FC7 / FC8
- FC6：9216 → 4096：约 37.7M
- FC7：4096 → 4096：约 16.8M
- FC8：4096 → 1000：约 4.1M

你会立刻看到：**参数主要在 FC6/FC7**。

这也解释了两个历史现象：

1) dropout 放在 FC 层是最划算的（那里最容易 overfit，也最“奢侈”）
2) 后来网络把大 FC 改成 GAP / 1×1 conv / 更深的 conv stack，本质是在把参数预算从“死记硬背的分类器”迁移到“可迁移的表征层”

---

## 5. 三个“看似普通但其实关键”的设计：写深就写在这里

### 5.1 ReLU：为什么论文强调它能让训练快很多？

论文对比了 ReLU vs tanh 的收敛速度（在 CIFAR-10 上），结论是 ReLU 能显著加速。

从优化角度解释：

- tanh/sigmoid 在大部分区域会进入饱和（saturation），梯度接近 0
- 深网里梯度要穿过多层非线性才能回传，一旦多层饱和叠加，更新会非常慢
- ReLU 在正半轴导数为 1，相当于在很大区域内给优化器“更线性的地形”

这件事在 2012 年尤其重要：当时还没有 BN、没有成熟的 initialization/训练 recipes，ReLU 是一种非常实用的“训练稳定器”。

### 5.2 Overlapping Max-Pooling：为什么不是 2×2 s2？

AlexNet 采用 3×3, stride 2 的 max pooling，这意味着 pooling window 之间有 overlap。

论文给出的经验结论是：overlapping 的 pooling 能带来小但稳定的提升（top-1/top-5 error 都会下降几个 0.x）。

直觉解释：

- non-overlap pooling（2×2 s2）是硬切块，边界效应更强
- overlap 相当于做了更“平滑”的下采样，特征对小位移更稳，同时不会把信息切得太碎

你可以把它理解成：当年没有很多现代 trick（例如更强的 augment、label smoothing、mixup 等），这个设计提供了一点朴素但有效的 invariance。

### 5.3 LRN：它到底在做什么？为什么今天很少用了？

LRN（Local Response Normalization）的常见形式（论文采用的 family）是对同一空间位置、不同 channel 的响应做归一化：

\[
b_{x,y}^i = a_{x,y}^i / \left(k + \alpha \sum_{j=i-n/2}^{i+n/2} (a_{x,y}^j)^2 \right)^{\beta}
\]

其中 `a` 是 ReLU 后的激活，`b` 是归一化后的输出。

为什么当时有用？

- 它鼓励“同位置不同通道”之间产生一种竞争（competition），让强响应更突出
- 在 ReLU 输出稀疏时，这种 competition 可能帮助形成更可分离的特征

为什么后来被替代？

- BN（batch normalization）提供了更稳定、对优化更友好的归一化机制
- 更好的训练 recipes（数据增强、正则、初始化）让 LRN 的边际收益变小
- LRN 计算开销不小，且对现代大规模训练不如 BN/LayerNorm 这类工具通用

写到这里才算“讲透”：不是说 LRN“过时了”，而是它解决的问题后来有更好的通用解法。

---

## 6. Groups=2：这不是 MobileNet 的那种“高效卷积”

conv2/conv4/conv5 使用 groups=2，很多现代读者会自然联想到 depthwise separable conv（MobileNet）。但 AlexNet 的 group 更像是“硬件妥协的结构痕迹”。

论文背景：两张 GTX 580，每张只有 3GB 显存。作者把网络分到两张 GPU 上跑，group conv 的形式使得中间某些层主要在各自 GPU 内计算，减少跨 GPU 的通信。

所以你在复现时要把它当成两件事：

- **结构上确实是 group conv**（所以你的实现应支持 groups=2 才算对齐）
- **目的并不是现代意义的效率卷积**，而是当年的并行/显存工程

这也解释了一个现象：如果你在今天把 groups=2 去掉（改成普通 conv），模型未必变差，甚至可能更好；但那就不再是“原论文那条路径”。

---

## 7. 从零实现：PyTorch AlexNet（贴近论文语义）

下面给一个更完整、更可对照的实现：

- 保留 LRN（可开关）
- 保留 groups=2
- 明确把 LRN 放在 conv1/conv2 的 ReLU 后
- 提供一个 `debug_shapes()` 用于逐层打印 shape，确保你复现时不会跑偏

```python
import torch
import torch.nn as nn

class AlexNetFromScratch(nn.Module):
    def __init__(self, num_classes: int = 1000, use_lrn: bool = True, dropout: float = 0.5):
        super().__init__()
        self.use_lrn = use_lrn
        self.lrn = nn.LocalResponseNorm(size=5, alpha=1e-4, beta=0.75, k=2.0)

        self.conv1 = nn.Conv2d(3, 96, kernel_size=11, stride=4, padding=0)
        self.pool1 = nn.MaxPool2d(kernel_size=3, stride=2)

        self.conv2 = nn.Conv2d(96, 256, kernel_size=5, stride=1, padding=2, groups=2)
        self.pool2 = nn.MaxPool2d(kernel_size=3, stride=2)

        self.conv3 = nn.Conv2d(256, 384, kernel_size=3, stride=1, padding=1)
        self.conv4 = nn.Conv2d(384, 384, kernel_size=3, stride=1, padding=1, groups=2)
        self.conv5 = nn.Conv2d(384, 256, kernel_size=3, stride=1, padding=1, groups=2)
        self.pool5 = nn.MaxPool2d(kernel_size=3, stride=2)

        self.relu = nn.ReLU(inplace=True)
        self.drop = nn.Dropout(p=dropout)

        self.fc6 = nn.Linear(256 * 6 * 6, 4096)
        self.fc7 = nn.Linear(4096, 4096)
        self.fc8 = nn.Linear(4096, num_classes)

    def forward(self, x):
        x = self.relu(self.conv1(x))
        if self.use_lrn:
            x = self.lrn(x)
        x = self.pool1(x)

        x = self.relu(self.conv2(x))
        if self.use_lrn:
            x = self.lrn(x)
        x = self.pool2(x)

        x = self.relu(self.conv3(x))
        x = self.relu(self.conv4(x))
        x = self.relu(self.conv5(x))
        x = self.pool5(x)

        x = torch.flatten(x, 1)
        x = self.drop(self.relu(self.fc6(x)))
        x = self.drop(self.relu(self.fc7(x)))
        x = self.fc8(x)
        return x

    @torch.no_grad()
    def debug_shapes(self, device='cpu'):
        self.eval().to(device)
        x = torch.zeros(1, 3, 227, 227, device=device)
        def p(name, t):
            print(f"{name:>10}: {tuple(t.shape)}")

        x = self.relu(self.conv1(x)); p('conv1', x)
        if self.use_lrn:
            x = self.lrn(x); p('lrn1', x)
        x = self.pool1(x); p('pool1', x)

        x = self.relu(self.conv2(x)); p('conv2', x)
        if self.use_lrn:
            x = self.lrn(x); p('lrn2', x)
        x = self.pool2(x); p('pool2', x)

        x = self.relu(self.conv3(x)); p('conv3', x)
        x = self.relu(self.conv4(x)); p('conv4', x)
        x = self.relu(self.conv5(x)); p('conv5', x)
        x = self.pool5(x); p('pool5', x)

        x = torch.flatten(x, 1); p('flat', x)
```

你跑 `model.debug_shapes()`，如果看到：

- conv1: (1, 96, 55, 55)
- pool1: (1, 96, 27, 27)
- pool2: (1, 256, 13, 13)
- pool5: (1, 256, 6, 6)
- flat:  (1, 9216)

说明你形状对齐了。

---

## 8. 训练复现：怎么把“论文策略”翻译成今天能跑的 recipe

严格 1:1 复现 AlexNet 的训练并不现实（尤其是双 GPU 切分 + 当年特定 CUDA kernel + 当年 ImageNet preprocessing），但你可以把复现目标拆成三层：

- Level 1：结构/shape/参数量对齐（最重要）
- Level 2：在一个 ImageNet 子集上稳定收敛（验证训练管线与正则有效）
- Level 3：在完整 ImageNet 上逼近经典精度（这需要足够算力和训练时长）

### 8.1 数据增强（augmentation）

论文里最核心的两类增强：

1) **random crops**：从 256×256 中随机裁 227×227（训练时），测试时用中心裁剪
2) **horizontal flipping**：镜像增强

另外还有颜色扰动（常被称为 PCA lighting noise）——这是 AlexNet 时代非常标志性的 trick。

对应到 PyTorch（伪代码）：

```python
train_tf = T.Compose([
    T.RandomResizedCrop(227, scale=(0.875, 1.0)),
    T.RandomHorizontalFlip(p=0.5),
    # 可选：ColorJitter / Lighting noise（更贴近 AlexNet）
    T.ToTensor(),
    T.Normalize(mean=..., std=...),
])

test_tf = T.Compose([
    T.Resize(256),
    T.CenterCrop(227),
    T.ToTensor(),
    T.Normalize(mean=..., std=...),
])
```

### 8.2 优化器与正则

经典组合：

- SGD + momentum（0.9）
- weight decay（5e-4）
- dropout（0.5）

这里最容易写浅的地方是：很多人只会列参数，但不解释“为什么这些参数组合在当年有效”。更完整的理解是：

- **大 FC + 大数据仍会 overfit**：dropout 在 FC 层强行制造模型集成效果
- **SGD+momentum** 在当时仍是最稳的优化器（Adam 等现代方法当年还不是主流 recipe）
- **weight decay** 对大模型的泛化起到持续约束

### 8.3 学习率（LR schedule）

AlexNet 时代常见做法是 step decay（例如当验证集不再提升就把 LR 降 10×）。

今天你可以先用一个“能跑通、易理解”的 schedule：

- 初始 lr：按 batch size 线性缩放（例如 bs=256 时 lr=0.1；bs=128 时 lr=0.05）
- 每当 val acc 平台期：lr *= 0.1

---

## 9. 写在最后：AlexNet 的“深”不在结构，而在把系统瓶颈挪开

如果你把 AlexNet 只看成“11×11 stride 4 + 三个 FC”，那它确实显得粗糙。

但如果你把它放回 2012 年：

- 显存小到需要切两张 GPU
- 训练配方远不成熟
- 数据集第一次大到足以支持大模型

那你会发现它更像一套“能打赢的系统设计”。它真正打开的，是一种新范式：

> 不是先手工做特征再分类，而是端到端（end-to-end）地把表征学习出来。

下一篇我会写 VGG：为什么 3×3 堆深度看起来更“朴素”，却反而更可扩展、更容易成为后续 ResNet 的跳板。

---

## References（本文写作参考）

1) Krizhevsky, Sutskever, Hinton. **ImageNet Classification with Deep Convolutional Neural Networks**（作者主页 PDF）
- https://www.cs.toronto.edu/~kriz/imagenet_classification_with_deep_convolutional.pdf

2) NeurIPS Proceedings 2012 收录版（同一论文的官方收录链接）
- https://proceedings.neurips.cc/paper/2012/file/c399862d3b9d6b76c8436e924a68c45b-Paper.pdf

3) Nair & Hinton. **Rectified Linear Units Improve Restricted Boltzmann Machines**（ReLU 早期工作）
- https://www.cs.toronto.edu/~hinton/absps/reluICML.pdf

4) Srivastava et al. **Dropout: A Simple Way to Prevent Neural Networks from Overfitting**（JMLR 2014）
- https://jmlr.org/papers/v15/srivastava14a.html

5) Siddhesh Bangar. **AlexNet Architecture Explained**（二手讲解，本文用于对照与补充叙事）
- https://medium.com/@siddheshb008/alexnet-architecture-explained-b6240c528bd5

6) torchvision 官方 AlexNet 页面（用于接口/结构对照，不作为本文实现依赖）
- https://pytorch.org/vision/stable/models/generated/torchvision.models.alexnet.html
