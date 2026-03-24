# rose_fist

识别到握拳（fist/rock）后，把一朵玫瑰 P 到拳头上，看起来像「手里握着玫瑰」。

> 这是一个可运行的工程 Demo：
> - 手部检测：MediaPipe Hands
> - 握拳判断：基于手部关键点的启发式（PIP 关节角度）
> - 叠加玫瑰：对 PNG 做旋转/缩放后 alpha-blend 到掌心位置

## 目录结构

- `src/overlay_rose_on_fist.py` 主脚本（图片 / 摄像头）
- `assets/` 玫瑰 PNG、测试图片
- `outputs/` 输出结果

## 环境准备

建议 Python 3.10+。

```bash
cd source/rose_fist
python3 -m venv .venv
. .venv/bin/activate
pip install -U pip
pip install mediapipe==0.10.14 opencv-python numpy pillow
```

## 运行

### 1) 图片

```bash
. .venv/bin/activate
python src/overlay_rose_on_fist.py \
  --input assets/rock_sample.png \
  --output outputs/rock_with_rose.png \
  --rose assets/rose_fluent.png

# 可选：
# --rose assets/rose_twemoji.png
# --rose assets/rose_openmoji.png
```

### 2) 摄像头（webcam index 0）

```bash
. .venv/bin/activate
python src/overlay_rose_on_fist.py \
  --input 0 \
  --output outputs/webcam.mp4 \
  --rose assets/rose_fluent.png
```

## 参数

- `--curled-angle`：判断手指弯曲的角度阈值（默认 160 度）
- `--fist-curled-count`：至少多少根手指弯曲才认为是握拳（默认 3）

## 说明

- 由于没有训练专用的“握拳分类”模型，这里使用启发式：四根手指的 PIP 角度越小越弯曲。
- 对于真实图片/摄像头，效果会随光照、角度、遮挡变化；脚本里提供参数可调。
