#!/usr/bin/env python3
"""Erzeugt die App-Icons (180/192/512 px + maskable) mit Pillow.
Aufruf: python3 tools/make-icons.py  (schreibt nach icons/)."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent.parent / "icons"
OUT.mkdir(exist_ok=True)
RED = (200, 16, 46)
YELLOW = (255, 196, 0)
WHITE = (255, 255, 255)
FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
]


def font(size):
    for p in FONT_CANDIDATES:
        if Path(p).exists():
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def draw_icon(size, maskable=False):
    s = 4  # Supersampling gegen Treppen
    S = size * s
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if maskable:
        d.rectangle([0, 0, S, S], fill=RED)
        inset = int(S * 0.12)
    else:
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=RED)
        inset = int(S * 0.06)
    # gelbes Band (Flaggen-Motiv)
    band_h = int(S * 0.34)
    y0 = (S - band_h) // 2
    d.rectangle([0, y0, S, y0 + band_h], fill=YELLOW)
    if not maskable:
        # Bandecken an die Rundung anpassen: Maske
        mask = Image.new("L", (S, S), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=255)
        img.putalpha(mask)
    # Buchstabe Ñ
    txt = "Ñ"
    f = font(int(S * 0.62))
    bbox = d.textbbox((0, 0), txt, font=f)
    w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x = (S - w) // 2 - bbox[0]
    y = (S - h) // 2 - bbox[1] - int(S * 0.02)
    d.text((x + S // 90, y + S // 90), txt, font=f, fill=(0, 0, 0, 90))
    d.text((x, y), txt, font=f, fill=WHITE, stroke_width=int(S * 0.012), stroke_fill=RED)
    return img.resize((size, size), Image.LANCZOS)


for size in (180, 192, 512):
    draw_icon(size).save(OUT / f"icon-{size}.png", optimize=True)
draw_icon(512, maskable=True).save(OUT / "icon-512-maskable.png", optimize=True)
print("Icons geschrieben nach", OUT)
