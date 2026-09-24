#!/usr/bin/env python3
"""
Generates the pre-rendered desk textures used by the site (wood desk, cover
grain, paper grain). Run once; output goes to assets/textures/.
Light direction for the whole scene is TOP-LEFT: highlights on top/left
edges, shadows fall to the bottom-right.   Requires: numpy, Pillow.
"""
import numpy as np
from PIL import Image, ImageFilter
import os

rng = np.random.default_rng(2608)
OUT = os.path.join(os.path.dirname(__file__), "..", "assets", "textures")
os.makedirs(OUT, exist_ok=True)


def smooth_noise(h, w, sy, sx, seed_shift=0):
    """Value noise: random grid (h/sy x w/sx) upscaled with bicubic."""
    gh, gw = max(2, h // sy), max(2, w // sx)
    g = rng.random((gh, gw)).astype(np.float32)
    im = Image.fromarray((g * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC)
    return np.asarray(im, dtype=np.float32) / 255.0


def tileable_noise(n, sigma):
    """Tileable noise via FFT gaussian filtering (wraps at the borders)."""
    a = rng.standard_normal((n, n)).astype(np.float32)
    f = np.fft.fft2(a)
    fy = np.fft.fftfreq(n)[:, None]
    fx = np.fft.fftfreq(n)[None, :]
    g = np.exp(-2 * (np.pi ** 2) * (sigma ** 2) * (fx ** 2 + fy ** 2))
    r = np.real(np.fft.ifft2(f * g))
    r = (r - r.min()) / (r.max() - r.min())
    return r


# ------------------------------------------------------------------ WOOD DESK
def wood(W=2200, H=1400, plank=232):
    img = np.zeros((H, W, 3), np.float32)
    dark = np.array([0.30, 0.17, 0.09])
    mid = np.array([0.55, 0.33, 0.18])
    light = np.array([0.72, 0.47, 0.27])
    y = 0
    idx = 0
    while y < H:
        ph = plank + int(rng.integers(-24, 24))
        y1 = min(H, y + ph)
        h = y1 - y
        # long streaks: stretched noise, warped along x by a slow wave
        streak = np.zeros((h, W), np.float32)
        for (sy, sx, amp) in [(3, 420, 0.5), (2, 150, 0.3), (1, 40, 0.15), (1, 9, 0.08)]:
            streak += amp * smooth_noise(h, W, sy, sx)
        ring = smooth_noise(h, W, 26, 600)
        warp = np.sin((np.arange(h)[:, None] / 7.0) + ring * 9.0) * 0.5 + 0.5
        v = 0.55 * streak + 0.45 * warp * ring
        v = (v - v.min()) / (v.max() - v.min())
        tone = 0.86 + 0.28 * rng.random()          # per-plank tone shift
        col = dark + (mid - dark) * np.clip(v * 1.6, 0, 1)[..., None]
        col = col + (light - mid) * np.clip((v - 0.55) * 2.2, 0, 1)[..., None]
        col *= tone
        # fine pores
        pores = smooth_noise(h, W, 1, 3)
        col *= (0.93 + 0.14 * pores)[..., None]
        img[y:y1] = col
        # seam: dark groove + light lip on the lower-left facing edge (top-left light)
        if y > 0:
            img[y:y + 2] *= 0.30
            img[y + 2:y + 4] *= 1.10
        # butt joints (short vertical seams) every so often
        jx = int(rng.integers(300, W - 300))
        img[y:y1, jx:jx + 2] *= 0.35
        y = y1
        idx += 1
    # global lighting: soft key light top-left, vignette to bottom-right
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    key = np.exp(-(((xx - W * 0.28) / (W * 0.75)) ** 2 + ((yy - H * 0.18) / (H * 0.85)) ** 2))
    img *= (0.68 + 0.50 * key)[..., None]
    edge = 1 - 0.35 * (((xx - W / 2) / (W / 2)) ** 2 + ((yy - H / 2) / (H / 2)) ** 2) / 2
    img *= edge[..., None]
    img = np.clip(img, 0, 1)
    out = Image.fromarray((img * 255).astype(np.uint8))
    out = out.filter(ImageFilter.GaussianBlur(0.6))
    out.save(os.path.join(OUT, "desk-wood.webp"), quality=74, method=6)


# ----------------------------------------------------------- COVER (LEATHERETTE)
def cover_grain(n=384):
    a = tileable_noise(n, 1.1)
    b = tileable_noise(n, 3.0)
    g = 0.65 * a + 0.35 * b
    # emboss with top-left light
    gy, gx = np.gradient(g)
    emb = np.clip(0.5 + 6.0 * (-gx - gy), 0, 1)
    v = 0.5 * g + 0.5 * emb
    v = (v - v.min()) / (v.max() - v.min())
    Image.fromarray((v * 255).astype(np.uint8), "L").save(
        os.path.join(OUT, "cover-grain.webp"), quality=70, method=6)


# ------------------------------------------------------------------ PAPER GRAIN
def paper(n=320):
    fib = tileable_noise(n, 0.7)
    cloud = tileable_noise(n, 9.0)
    v = 0.7 * fib + 0.3 * cloud
    v = (v - v.min()) / (v.max() - v.min())
    v = 0.5 + (v - 0.5) * 0.9
    Image.fromarray((v * 255).astype(np.uint8), "L").save(
        os.path.join(OUT, "paper-grain.webp"), quality=70, method=6)


wood()
cover_grain()
paper()
for f in sorted(os.listdir(OUT)):
    print(f, os.path.getsize(os.path.join(OUT, f)) // 1024, "KB")
