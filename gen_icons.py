"""Generate YCUT Extractor icons at 16, 48, 128 px using Pillow with 4x supersampling."""
from PIL import Image, ImageDraw
import os, math

BRAND_BLUE  = (45, 124, 255, 255)   # #2d7cff
NAVY_BG     = (15,  23,  41, 255)   # #0f1729
GREEN       = (34, 197,  94, 255)   # #22c55e
WHITE       = (255, 255, 255, 255)

def draw_rounded_rect(draw, xy, r, fill):
    x0, y0, x1, y1 = xy
    draw.rectangle([x0 + r, y0, x1 - r, y1], fill=fill)
    draw.rectangle([x0, y0 + r, x1, y1 - r], fill=fill)
    for cx, cy in [(x0+r, y0+r), (x1-r, y0+r), (x0+r, y1-r), (x1-r, y1-r)]:
        draw.ellipse([cx-r, cy-r, cx+r, cy+r], fill=fill)

def create_icon(target_size):
    RENDER = target_size * 4          # draw at 4x, then downscale
    s = RENDER / 128                  # scaling factor vs 128-px reference grid

    img  = Image.new("RGBA", (RENDER, RENDER), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # ── background rounded square ─────────────────────────────────────────────
    bg_r = int(22 * s)
    draw_rounded_rect(draw, [0, 0, RENDER - 1, RENDER - 1], bg_r, NAVY_BG)

    # ── person head ──────────────────────────────────────────────────────────
    hcx, hcy, hr = int(64 * s), int(36 * s), int(17 * s)
    draw.ellipse([hcx - hr, hcy - hr, hcx + hr, hcy + hr], fill=BRAND_BLUE)

    # ── person body (filled half-ellipse) ─────────────────────────────────────
    bx, by = int(26 * s), int(57 * s)
    bw, bh = int(76 * s), int(52 * s)
    draw.pieslice([bx, by, bx + bw, by + bh], start=180, end=0, fill=BRAND_BLUE)

    # ── green export-badge circle (omit at 16 px — it would be 1-2 px) ───────
    if target_size >= 48:
        bcx, bcy, br = int(94 * s), int(94 * s), int(17 * s)
        draw.ellipse([bcx - br, bcy - br, bcx + br, bcy + br], fill=GREEN)

        # down-arrow: stem + triangle
        aw = max(2, int(5 * s))
        stem_top = bcy - int(9 * s)
        stem_bot = bcy - int(1 * s)
        draw.rectangle([bcx - aw // 2, stem_top, bcx + aw // 2, stem_bot], fill=WHITE)

        tip_y  = bcy + int(8 * s)
        half_w = int(9 * s)
        draw.polygon(
            [(bcx - half_w, stem_bot), (bcx + half_w, stem_bot), (bcx, tip_y)],
            fill=WHITE
        )

    # ── downscale with high-quality Lanczos ──────────────────────────────────
    return img.resize((target_size, target_size), Image.LANCZOS)


os.makedirs("icons", exist_ok=True)
for sz in (16, 48, 128):
    icon = create_icon(sz)
    path = f"icons/icon{sz}.png"
    icon.save(path, optimize=True)
    print(f"  OK  {path}  ({sz}x{sz})")

print("Done.")
