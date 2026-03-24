"""overlay_rose_on_fist.py

Detect a hand in an image/video, classify if it's a fist, and overlay a rose image
on top of the fist (like holding a rose).

Approach
- Hand detection / landmarks: MediaPipe Hands
- Fist classification (heuristic): finger PIP joint angles
- Rose overlay: alpha-blend PNG onto an ROI centered at the palm

This is meant as a practical demo that runs locally.

Usage
  # image
  python src/overlay_rose_on_fist.py --input assets/rock_sample.png --output outputs/rock_with_rose.png

  # webcam
  python src/overlay_rose_on_fist.py --input 0 --output outputs/webcam.mp4

Notes
- If you pass a number as --input it will be treated as a webcam index.
- For best results, use a rose PNG with transparency.
"""

from __future__ import annotations

import argparse
import os
from dataclasses import dataclass
from typing import Optional, Tuple, Union

import cv2
import numpy as np
from PIL import Image

import mediapipe as mp


@dataclass
class FistHeuristicConfig:
    # A finger is considered curled if PIP angle < this threshold
    curled_angle_deg: float = 160.0
    # If curled fingers (index/middle/ring/pinky) >= this => fist
    fist_curled_count: int = 3


def _pip_angle_deg(pts: np.ndarray, mcp: int, pip: int, tip: int) -> float:
    """Angle at PIP joint (MCP-PIP-TIP). Straight finger ~180deg."""
    a = pts[mcp]
    b = pts[pip]
    c = pts[tip]
    ba = a - b
    bc = c - b
    denom = (np.linalg.norm(ba) * np.linalg.norm(bc)) + 1e-6
    cosv = float(np.dot(ba, bc) / denom)
    cosv = float(np.clip(cosv, -1.0, 1.0))
    return float(np.degrees(np.arccos(cosv)))


def classify_fist_from_landmarks(
    pts_xy: np.ndarray, cfg: FistHeuristicConfig
) -> Tuple[bool, dict]:
    """Return (is_fist, debug_metrics)."""
    fingers = {
        "index": (5, 6, 8),
        "middle": (9, 10, 12),
        "ring": (13, 14, 16),
        "pinky": (17, 18, 20),
    }
    angles = {name: _pip_angle_deg(pts_xy, *idxs) for name, idxs in fingers.items()}
    curled = {k: (v < cfg.curled_angle_deg) for k, v in angles.items()}
    curled_count = sum(1 for v in curled.values() if v)
    is_fist = curled_count >= cfg.fist_curled_count
    dbg = {
        "angles": {k: round(v, 1) for k, v in angles.items()},
        "curled": curled,
        "curled_count": curled_count,
        "threshold": cfg.curled_angle_deg,
    }
    return is_fist, dbg


def load_rgba(path: str) -> np.ndarray:
    img = Image.open(path).convert("RGBA")
    return np.array(img)


def split_rose_stem_flower(rose_rgba: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Split a rose RGBA into (stem_rgba, flower_rgba).

    We treat "green-ish" pixels as stem/leaves, and the rest as flower.
    This is a heuristic that works well for emoji-style roses (e.g. Twemoji).
    """
    rgba = rose_rgba.copy()
    rgb = rgba[..., :3].astype(np.float32)
    a = rgba[..., 3:4].astype(np.float32)

    # Convert to HSV-ish via OpenCV for robust green detection.
    bgr = rgb[..., ::-1].astype(np.uint8)
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)

    # green range (tunable)
    lower = np.array([35, 40, 40], dtype=np.uint8)
    upper = np.array([95, 255, 255], dtype=np.uint8)
    green_mask = cv2.inRange(hsv, lower, upper).astype(bool)

    stem = rgba.copy()
    flower = rgba.copy()

    # Stem keeps only green pixels
    stem_alpha = (a[..., 0] > 0) & green_mask
    stem[..., 3] = np.where(stem_alpha, stem[..., 3], 0)

    # Flower keeps everything except green pixels
    flower_alpha = (a[..., 0] > 0) & (~green_mask)
    flower[..., 3] = np.where(flower_alpha, flower[..., 3], 0)

    return stem, flower


def find_anchor_bottom(overlay_rgba: np.ndarray) -> tuple[int, int]:
    """Find a bottom-most non-transparent pixel as anchor (x,y) within overlay image."""
    alpha = overlay_rgba[..., 3]
    ys, xs = np.where(alpha > 0)
    if len(xs) == 0:
        # fallback to bottom center
        h, w = overlay_rgba.shape[:2]
        return w // 2, h - 1
    y = int(ys.max())
    xs_at_y = xs[ys == y]
    x = int(np.median(xs_at_y))
    return x, y


def alpha_blend_rgba(bg_bgr: np.ndarray, fg_rgba: np.ndarray, x: int, y: int) -> np.ndarray:
    """Alpha blend fg_rgba onto bg_bgr with fg's top-left at (x,y)."""
    out = bg_bgr.copy()
    H, W = out.shape[:2]
    fh, fw = fg_rgba.shape[:2]

    # compute intersection
    x0 = max(0, x)
    y0 = max(0, y)
    x1 = min(W, x + fw)
    y1 = min(H, y + fh)
    if x0 >= x1 or y0 >= y1:
        return out

    roi = out[y0:y1, x0:x1]

    fx0 = x0 - x
    fy0 = y0 - y
    fx1 = fx0 + (x1 - x0)
    fy1 = fy0 + (y1 - y0)
    fg = fg_rgba[fy0:fy1, fx0:fx1]

    fg_rgb = fg[..., :3][:, :, ::-1].astype(np.float32)  # RGBA->BGR
    alpha = (fg[..., 3:4].astype(np.float32)) / 255.0

    roi_f = roi.astype(np.float32)
    blended = (1.0 - alpha) * roi_f + alpha * fg_rgb
    out[y0:y1, x0:x1] = blended.astype(np.uint8)
    return out


def rose_overlay_pose(pts_xy: np.ndarray, image_shape: Tuple[int, int]) -> Tuple[Tuple[int, int], int, float]:
    """Heuristic placement for holding a rose.

    Returns:
      center (cx,cy), size_px, rotation_deg

    Uses palm center approximated by average of wrist + MCPs.
    Size is based on hand bbox.
    Rotation is based on wrist->middle_mcp direction.
    """
    H, W = image_shape
    wrist = pts_xy[0]
    mcps = pts_xy[[5, 9, 13, 17]]
    palm = np.mean(np.vstack([wrist, mcps]), axis=0)

    xs = pts_xy[:, 0]
    ys = pts_xy[:, 1]
    bbox_w = float(xs.max() - xs.min())
    bbox_h = float(ys.max() - ys.min())
    hand_size = max(bbox_w, bbox_h)

    # rose roughly the palm size; slightly larger for better illusion
    size_px = int(max(32, min(1.05 * hand_size, 0.9 * min(W, H))))

    # rotation: align with forearm direction
    middle_mcp = pts_xy[9]
    v = middle_mcp - wrist
    rot = float(np.degrees(np.arctan2(v[1], v[0])))

    cx, cy = int(palm[0]), int(palm[1])
    return (cx, cy), size_px, rot


def fist_occlusion_mask_from_bbox(img_shape: Tuple[int, int], pts_xy: np.ndarray) -> np.ndarray:
    """Create an approximate occlusion mask for the fist region.

    This is a *heuristic* that uses the landmarks bbox as the hand area.
    We erode it a bit to simulate the interior part of the fist that should occlude the stem.

    Returns uint8 mask 0/255.
    """
    H, W = img_shape
    xs = pts_xy[:, 0]
    ys = pts_xy[:, 1]
    x0, y0 = int(max(0, xs.min())), int(max(0, ys.min()))
    x1, y1 = int(min(W - 1, xs.max())), int(min(H - 1, ys.max()))

    mask = np.zeros((H, W), dtype=np.uint8)
    cv2.rectangle(mask, (x0, y0), (x1, y1), 255, thickness=-1)

    # erode to get inner region (more conservative)
    k = max(3, int(0.08 * max(x1 - x0, y1 - y0)))
    if k % 2 == 0:
        k += 1
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
    mask = cv2.erode(mask, kernel, iterations=1)

    return mask


def rotate_and_resize_rgba(img_rgba: np.ndarray, size_px: int, rotation_deg: float) -> np.ndarray:
    pil = Image.fromarray(img_rgba, mode="RGBA")
    pil = pil.resize((size_px, size_px), resample=Image.Resampling.LANCZOS)
    pil = pil.rotate(rotation_deg, expand=True, resample=Image.Resampling.BICUBIC)
    return np.array(pil)


def detect_hand_landmarks(image_bgr: np.ndarray, min_det_conf: float = 0.2):
    mp_hands = mp.solutions.hands
    hands = mp_hands.Hands(
        static_image_mode=True,
        max_num_hands=1,
        min_detection_confidence=min_det_conf,
    )
    rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
    res = hands.process(rgb)
    if not res.multi_hand_landmarks:
        return None
    lms = res.multi_hand_landmarks[0].landmark
    H, W = image_bgr.shape[:2]
    pts = np.array([(lm.x * W, lm.y * H) for lm in lms], dtype=np.float32)
    return pts


def process_image(input_path: str, output_path: str, rose_path: str, cfg: FistHeuristicConfig, debug: bool = True):
    img = cv2.imread(input_path)
    if img is None:
        raise FileNotFoundError(f"Could not read image: {input_path}")

    pts = detect_hand_landmarks(img)
    if pts is None:
        if debug:
            print("No hand detected")
        cv2.imwrite(output_path, img)
        return {
            "hand_detected": False,
            "is_fist": False,
        }

    is_fist, dbg = classify_fist_from_landmarks(pts, cfg)

    out = img.copy()
    if is_fist:
        rose_rgba = load_rgba(rose_path)
        (cx, cy), size_px, rot = rose_overlay_pose(pts, out.shape[:2])

        # Prepare rose layers: stem (green) and flower (non-green)
        stem_rgba0, flower_rgba0 = split_rose_stem_flower(rose_rgba)
        stem_rgba = rotate_and_resize_rgba(stem_rgba0, size_px=size_px, rotation_deg=rot)
        flower_rgba = rotate_and_resize_rgba(flower_rgba0, size_px=size_px, rotation_deg=rot)

        # Anchor the stem bottom to the palm center to create "held" illusion.
        ax, ay = find_anchor_bottom(stem_rgba)

        # Top-left so that anchor lands at (cx,cy)
        x = int(cx - ax)
        y = int(cy - ay)

        # 1) draw stem first
        out1 = alpha_blend_rgba(out, stem_rgba, x, y)

        # 2) occlude stem by fist region (approx mask)
        occ = fist_occlusion_mask_from_bbox(out.shape[:2], pts)
        # apply occlusion only in overlapping region of stem
        H, W = out.shape[:2]
        fh, fw = stem_rgba.shape[:2]
        x0 = max(0, x)
        y0 = max(0, y)
        x1 = min(W, x + fw)
        y1 = min(H, y + fh)
        if x0 < x1 and y0 < y1:
            fx0 = x0 - x
            fy0 = y0 - y
            fx1 = fx0 + (x1 - x0)
            fy1 = fy0 + (y1 - y0)
            stem_alpha = stem_rgba[fy0:fy1, fx0:fx1, 3]
            occ_roi = occ[y0:y1, x0:x1]
            # where occlusion is on, reduce stem visibility by setting those pixels back to original out
            # (simple but effective)
            m = (stem_alpha > 0) & (occ_roi > 0)
            out1_roi = out1[y0:y1, x0:x1]
            orig_roi = out[y0:y1, x0:x1]
            out1_roi[m] = orig_roi[m]
            out1[y0:y1, x0:x1] = out1_roi

        # 3) draw flower on top (outside the fist)
        out = alpha_blend_rgba(out1, flower_rgba, x, y)

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    cv2.imwrite(output_path, out)

    if debug:
        print({
            "hand_detected": True,
            "is_fist": is_fist,
            **dbg,
        })

    return {
        "hand_detected": True,
        "is_fist": is_fist,
        **dbg,
    }


def _is_int(s: str) -> bool:
    try:
        int(s)
        return True
    except Exception:
        return False


def process_webcam(input_index: int, output_path: str, rose_path: str, cfg: FistHeuristicConfig):
    cap = cv2.VideoCapture(input_index)
    if not cap.isOpened():
        raise RuntimeError(f"Could not open webcam index {input_index}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    writer = cv2.VideoWriter(output_path, fourcc, fps, (w, h))

    mp_hands = mp.solutions.hands
    hands = mp_hands.Hands(
        static_image_mode=False,
        max_num_hands=1,
        min_detection_confidence=0.3,
        min_tracking_confidence=0.3,
    )

    rose_rgba = load_rgba(rose_path)

    while True:
        ok, frame = cap.read()
        if not ok:
            break

        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        res = hands.process(rgb)
        out = frame

        if res.multi_hand_landmarks:
            lms = res.multi_hand_landmarks[0].landmark
            pts = np.array([(lm.x * w, lm.y * h) for lm in lms], dtype=np.float32)
            is_fist, _dbg = classify_fist_from_landmarks(pts, cfg)
            if is_fist:
                (cx, cy), size_px, rot = rose_overlay_pose(pts, (h, w))
                rose2 = rotate_and_resize_rgba(rose_rgba, size_px=size_px, rotation_deg=rot)
                x = int(cx - rose2.shape[1] / 2)
                y = int(cy - rose2.shape[0] / 2)
                out = alpha_blend_rgba(out, rose2, x, y)

        writer.write(out)

    cap.release()
    writer.release()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True, help="Image path or webcam index (e.g. 0)")
    ap.add_argument("--output", required=True, help="Output image/video path")
    ap.add_argument("--rose", default="assets/rose_twemoji.png", help="Rose PNG (with alpha) path")
    ap.add_argument("--curled-angle", type=float, default=160.0)
    ap.add_argument("--fist-curled-count", type=int, default=3)
    args = ap.parse_args()

    cfg = FistHeuristicConfig(curled_angle_deg=args.curled_angle, fist_curled_count=args.fist_curled_count)

    if _is_int(args.input):
        process_webcam(int(args.input), args.output, args.rose, cfg)
    else:
        process_image(args.input, args.output, args.rose, cfg, debug=True)


if __name__ == "__main__":
    main()
