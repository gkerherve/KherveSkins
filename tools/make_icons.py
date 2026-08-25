#!/usr/bin/env python3
"""Draw the app's icons, so they are in the repo as a recipe and not as a
binary somebody has to open Photoshop to change.

    python tools/make_icons.py

Needs Pillow, and nothing else does — this is a workshop tool, not part of
the app. The icon is a sixteen-by-sixteen face scaled up with no smoothing,
because an icon for a pixel-art tool that is not itself pixel art is a lie
about what is inside.
"""

from __future__ import annotations

import os

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(HERE, "icons")

BG = (11, 16, 32)
PANEL = (27, 39, 67)

# a face, sixteen across. '.' is the background, and the rest is a palette.
FACE = [
    "................",
    "................",
    "...hhhhhhhhhh...",
    "..hhhhhhhhhhhh..",
    "..hHHhhhhhhhhh..",
    "..hhssssssssh...",
    "..hsssssssssh...",
    "..hsswssswssh...",
    "..hssIsssIssh...",
    "..hssssssssshh..",
    "..hsssSSsssshh..",
    "..hsssmmssssh...",
    "..hhssssssshh...",
    "...hhhhhhhhh....",
    "................",
    "................",
]
PAL = {
    "h": (58, 40, 28),
    "H": (78, 56, 40),
    "s": (226, 176, 138),
    "S": (206, 154, 118),
    "w": (245, 243, 238),
    "I": (52, 44, 40),
    "m": (150, 84, 74),
}


def draw(size: int, pad: float, radius: float) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * radius), fill=BG)
    inset = int(size * 0.08)
    d.rounded_rectangle(
        [inset, inset, size - 1 - inset, size - 1 - inset],
        radius=int(size * radius * 0.8), fill=PANEL,
    )

    tile = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    tp = tile.load()
    for y, row in enumerate(FACE):
        for x, ch in enumerate(row):
            if ch in PAL:
                tp[x, y] = (*PAL[ch], 255)
    span = int(size * (1 - pad * 2))
    span -= span % 16
    tile = tile.resize((span, span), Image.NEAREST)
    img.paste(tile, ((size - span) // 2, (size - span) // 2), tile)
    return img


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    for size in (192, 512):
        draw(size, 0.11, 0.22).save(os.path.join(OUT, f"icon-{size}.png"))
    # maskable: everything important inside the middle four fifths, because
    # Android will crop this to whatever shape that phone likes
    draw(512, 0.22, 0.0).save(os.path.join(OUT, "icon-maskable-512.png"))
    draw(64, 0.10, 0.20).save(os.path.join(OUT, "favicon-64.png"))
    print(f"wrote icons into {OUT}")


if __name__ == "__main__":
    main()
