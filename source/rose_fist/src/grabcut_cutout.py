"""GrabCut-based cutout utility.

This script converts a photo (JPEG/PNG) into a transparent-background PNG cutout.
It is intentionally dependency-light: only OpenCV + numpy are used.

Usage:
  python src/grabcut_cutout.py --input assets/picsum_4.jpg --output assets/rose_real_cutout.png

Notes:
- GrabCut is heuristic. It works best when the foreground object is centered and
  contrasts with the background.
"""

from __future__ import annotations

import argparse
import cv2
import numpy as np


def grabcut_cutout(bgr: np.ndarray, rect_pad: float = 0.08, iter_count: int = 5) -> np.ndarray:
    """Return RGBA cutout from BGR image using a centered rectangle initialization."""
    h, w = bgr.shape[:2]

    # init mask and models
    mask = np.zeros((h, w), np.uint8)
    bgdModel = np.zeros((1, 65), np.float64)
    fgdModel = np.zeros((1, 65), np.float64)

    pad_x = int(rect_pad * w)
    pad_y = int(rect_pad * h)
    rect = (pad_x, pad_y, w - 2 * pad_x, h - 2 * pad_y)

    cv2.grabCut(bgr, mask, rect, bgdModel, fgdModel, iter_count, cv2.GC_INIT_WITH_RECT)

    # foreground mask: sure FG or probable FG
    fg = (mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD)
    alpha = (fg.astype(np.uint8) * 255)

    # soften edges a bit
    alpha = cv2.GaussianBlur(alpha, (0, 0), 1.2)

    rgba = cv2.cvtColor(bgr, cv2.COLOR_BGR2BGRA)
    rgba[:, :, 3] = alpha
    return rgba


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--output", required=True)
    ap.add_argument("--rect-pad", type=float, default=0.08)
    ap.add_argument("--iters", type=int, default=5)
    args = ap.parse_args()

    bgr = cv2.imread(args.input, cv2.IMREAD_COLOR)
    if bgr is None:
        raise SystemExit(f"Failed to read image: {args.input}")

    rgba = grabcut_cutout(bgr, rect_pad=args.rect_pad, iter_count=args.iters)
    ok = cv2.imwrite(args.output, rgba)
    if not ok:
        raise SystemExit(f"Failed to write output: {args.output}")

    print("saved", args.output)


if __name__ == "__main__":
    main()
