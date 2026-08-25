#!/usr/bin/env python3
"""A capture that fails the way a REAL one fails.

    python tools/make_test_room9.py

The earlier test room was too kind: one exposure, no shadow, arms held clear.
A real set of phone photographs taken in a real room has three things it does
not, and each one breaks the carve on its own:

  **exposure drift**   a phone re-meters between shots. A wall at 220 that
                       comes back at 190 in the next frame differs by ninety
                       across three channels, which is the entire threshold —
                       so the WALL registers as the person and the mask goes
                       to noise. This is the one that turns a carve into a
                       handful of chips.
  **shadow**           the person throws one on the floor and on the door
                       behind them. It differs from the empty room, so it is
                       "not the room", so it is the person — and the outline
                       grows a foot of floor, which wrecks the height every
                       other view is scaled against.
  **arms down**        which is what people actually do. An arm touching a
                       ribcage cannot be told from a ribcage by any outline,
                       so the hull fuses them and the Minecraft man comes out
                       as a barrel with no arms.

Writes `shots/room-plate.png` and `room-0` … `room-315`.
"""

from __future__ import annotations

import math
import os
import random

from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(HERE, "shots")

W, H = 620, 1340
FLOOR_Y = 980                     # where the wall meets the floor
FEET = 1180                       # the soles
CROWN = 300                       # the top of the head
BODY_H = FEET - CROWN

SKIN = (206, 158, 118)
HAIR = (44, 34, 30)
SHIRT = (150, 186, 178)           # the pale green tee
SHORTS = (28, 28, 32)
WALL = (232, 230, 226)
DOOR = (240, 238, 234)
TILE = (226, 224, 218)

# how the phone re-metered, shot by shot: a gain and a tint
EXPOSURE = {
    "plate": (1.00, (1.00, 1.00, 1.00)),
    0: (0.93, (1.02, 1.00, 0.97)),
    45: (0.84, (1.03, 1.00, 0.95)),
    90: (0.90, (1.01, 1.00, 0.98)),
    135: (0.87, (1.02, 1.00, 0.96)),
    180: (0.95, (1.00, 1.00, 1.00)),
    225: (0.88, (1.02, 1.00, 0.96)),
    270: (0.92, (1.01, 1.00, 0.98)),
    315: (0.86, (1.03, 1.00, 0.95)),
}


def room(d: ImageDraw.ImageDraw) -> None:
    d.rectangle([0, 0, W, FLOOR_Y], fill=WALL)
    # the door, its frame, and the dark set beyond it
    d.rectangle([150, 150, 430, FLOOR_Y], fill=(246, 244, 240))
    d.rectangle([170, 175, 410, FLOOR_Y - 20], fill=DOOR)
    d.rectangle([196, 215, 384, 520], outline=(228, 226, 220), width=4)
    d.rectangle([196, 560, 384, 900], outline=(228, 226, 220), width=4)
    d.rectangle([176, 640, 196, 700], fill=(150, 148, 144))     # the handle
    # a television and a shelf on the right, which is not a plain wall at all
    d.rectangle([470, 300, W, 560], fill=(28, 32, 44))
    d.rectangle([455, 560, W, 580], fill=(120, 74, 46))
    d.rectangle([455, 580, W, FLOOR_Y], fill=(148, 92, 58))
    d.rectangle([470, 700, W, 720], fill=(120, 74, 46))
    # the air conditioner
    d.rectangle([440, 110, W, 210], fill=(250, 250, 248))
    # the floor, with veins
    d.rectangle([0, FLOOR_Y, W, H], fill=TILE)
    rnd = random.Random(7)
    for _ in range(26):
        x0 = rnd.randint(-100, W)
        y0 = rnd.randint(FLOOR_Y, H)
        pts = [(x0, y0)]
        for _ in range(5):
            x0 += rnd.randint(-60, 90)
            y0 += rnd.randint(-30, 50)
            pts.append((x0, y0))
        d.line(pts, fill=(206, 204, 198), width=rnd.choice([1, 2, 3]))
    for gy in range(FLOOR_Y, H, 150):
        d.line([(0, gy), (W, gy)], fill=(212, 210, 204), width=2)


def figure(d: ImageDraw.ImageDraw, angle: int) -> None:
    """A boy standing with his arms DOWN, as people actually do."""
    cx = W // 2
    a = math.radians(angle)

    def w(front: float, side: float) -> int:
        return max(2, int(abs(front * math.cos(a)) + abs(side * math.sin(a))))

    def band(t0: float, t1: float) -> tuple[int, int]:
        return CROWN + int(BODY_H * t0), CROWN + int(BODY_H * t1)

    # legs
    y0, y1 = band(0.56, 1.00)
    legw = w(19, 19)
    gap = int(11 * abs(math.cos(a)))
    for sx in (-1, 1):
        x = cx + sx * (gap + legw // 2)
        d.rectangle([x - legw // 2, y0, x + legw // 2, y1], fill=SKIN)

    # shorts
    y0, y1 = band(0.44, 0.62)
    sw = w(46, 30)
    d.rectangle([cx - sw, y0, cx + sw, y1], fill=SHORTS)
    if abs(math.cos(a)) > 0.3:
        d.polygon([(cx - sw + 8, y1 - 6), (cx, y0 + 20), (cx + sw - 8, y1 - 6)],
                  outline=(238, 238, 240), width=4)

    # torso
    y0, y1 = band(0.20, 0.48)
    tw = w(46, 28)
    d.rectangle([cx - tw, y0, cx + tw, y1], fill=SHIRT)

    # ARMS DOWN, touching the body — no daylight at the ribs
    aw = w(13, 13)
    ay0, ay1 = band(0.21, 0.50)
    for sx in (-1, 1):
        x = cx + sx * (tw + aw - 2)
        d.rectangle([x - aw, ay0, x + aw, ay0 + int(BODY_H * 0.13)], fill=SHIRT)
        d.rectangle([x - aw, ay0 + int(BODY_H * 0.13), x + aw, ay1], fill=SKIN)

    # neck and head
    y0, y1 = band(0.16, 0.21)
    nw = w(12, 12)
    d.rectangle([cx - nw, y0, cx + nw, y1], fill=SKIN)
    y0, y1 = band(0.00, 0.17)
    hw = w(30, 27)
    d.rectangle([cx - hw, y0 + 12, cx + hw, y1], fill=SKIN)
    d.rectangle([cx - hw - 3, y0, cx + hw + 3, y0 + int((y1 - y0) * 0.40)], fill=HAIR)
    facing = math.cos(a)
    if facing > 0.4:
        for ex in (-hw // 2, hw // 2):
            d.rectangle([cx + ex - 6, y0 + 58, cx + ex + 6, y0 + 68], fill=(56, 50, 48))
        d.rectangle([cx - 11, y0 + 96, cx + 11, y0 + 104], fill=(160, 104, 100))
    elif facing < -0.4:
        d.rectangle([cx - hw - 3, y0, cx + hw + 3, y0 + int((y1 - y0) * 0.80)], fill=HAIR)


def shadows(img: Image.Image, angle: int) -> Image.Image:
    """The shadow he throws — on the floor at his feet and on the door."""
    lay = Image.new("L", img.size, 0)
    d = ImageDraw.Draw(lay)
    cx = W // 2
    off = int(40 * math.sin(math.radians(angle)))
    d.ellipse([cx - 150 + off, FEET - 60, cx + 150 + off, FEET + 70], fill=64)
    d.rectangle([cx - 90 + off * 2, CROWN + 60, cx + 130 + off * 2, FLOOR_Y], fill=34)
    lay = lay.filter(ImageFilter.GaussianBlur(26))
    dark = Image.new("RGB", img.size, (0, 0, 0))
    return Image.composite(dark, img, lay.point(lambda v: v)).convert("RGB") \
        if False else Image.blend(img, Image.composite(dark, img, lay), 1.0)


def expose(img: Image.Image, key) -> Image.Image:
    gain, tint = EXPOSURE[key]
    px = img.load()
    for y in range(img.height):
        for x in range(img.width):
            r, g, b = px[x, y]
            px[x, y] = (min(255, int(r * gain * tint[0])),
                        min(255, int(g * gain * tint[1])),
                        min(255, int(b * gain * tint[2])))
    return img


def shot(angle, path: str) -> None:
    img = Image.new("RGB", (W, H))
    d = ImageDraw.Draw(img)
    room(d)
    if angle is not None:
        figure(d, angle)
        img = shadows(img, angle)
    img = expose(img, "plate" if angle is None else angle)
    img = img.filter(ImageFilter.GaussianBlur(0.8))
    img.save(path)
    print(path)


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    shot(None, os.path.join(OUT, "room-plate.png"))
    for a in (0, 45, 90, 135, 180, 225, 270, 315):
        shot(a, os.path.join(OUT, f"room-{a}.png"))
    print(f"crown y={CROWN} feet y={FEET} height={BODY_H}px  (arms DOWN, shadowed,")
    print("  and every shot metered differently, which is the point)")


if __name__ == "__main__":
    main()
