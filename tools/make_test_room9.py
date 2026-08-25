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


# The figure as a RIGID SET OF SOLIDS, each one an upright elliptical column
# at a fixed place in the room, rather than a set of rectangles drawn to look
# right from each angle.
#
# This matters more than it sounds. A shape drawn per-angle is not the
# projection of ANY three-dimensional object, and a visual hull is the
# intersection of projections — so with four views the inconsistency hides in
# the slack and with twenty it carves the legs clean off. That is exactly what
# happened here, and for an hour it looked like the program had a bug in it.
# A test figure that is not a real object cannot be used to test a method that
# reconstructs real objects.
#
#   x    across the room, positive to the camera's right
#   z    toward the camera
#   rx/rz   the half-axes of the column's elliptical cross-section
PARTS = [
    # (x, z, rx, rz, y0, y1, colour)
    (-20, 0, 19, 19, 0.56, 1.00, SKIN),        # right leg
    (+20, 0, 19, 19, 0.56, 1.00, SKIN),        # left leg
    (0, 0, 46, 30, 0.44, 0.62, SHORTS),
    (0, 0, 46, 28, 0.20, 0.48, SHIRT),
    (-57, 0, 13, 13, 0.21, 0.50, None),        # arms: sleeve then bare
    (+57, 0, 13, 13, 0.21, 0.50, None),
    (0, 0, 12, 12, 0.16, 0.21, SKIN),          # neck
    (0, 0, 30, 27, 0.00, 0.17, None),          # head: hair then face
]


def figure(d: ImageDraw.ImageDraw, angle: int) -> None:
    """A boy standing with his arms DOWN, as people actually do."""
    cx = W // 2
    a = math.radians(angle)
    cos, sin = math.cos(a), math.sin(a)

    def band(t0: float, t1: float) -> tuple[int, int]:
        return CROWN + int(BODY_H * t0), CROWN + int(BODY_H * t1)

    def place(x, z, rx, rz):
        """Where an upright column lands in the picture, and how wide."""
        px = cx + x * cos - z * sin
        half = max(2, math.hypot(rx * cos, rz * sin))
        depth = x * sin + z * cos
        return px, half, depth

    # far things first, so a near arm covers the ribs behind it
    order = sorted(PARTS, key=lambda p: -place(p[0], p[1], p[2], p[3])[2])
    for (x, z, rx, rz, t0, t1, col) in order:
        px, half, _ = place(x, z, rx, rz)
        y0, y1 = band(t0, t1)
        if col is not None:
            d.rectangle([px - half, y0, px + half, y1], fill=col)
            continue
        if rx == 13:                                   # an arm: sleeve, then skin
            cut = y0 + int(BODY_H * 0.13)
            d.rectangle([px - half, y0, px + half, cut], fill=SHIRT)
            d.rectangle([px - half, cut, px + half, y1], fill=SKIN)
            continue
        # THE HEAD, and the one thing about a head that tells a program which
        # way somebody turned: the face is skin and the back of it is hair, so
        # which SIDE of the head the skin sits on is the answer.
        #
        # Worked out rather than faked per angle, because faking it is how a
        # fixture comes to agree with a bug. A point on a head at body angle φ
        # round from the face lands at u = r·sin(φ + a) and is visible while
        # cos(φ + a) > 0. Intersect the two and the face fills u from −r·cos a
        # up to +r when he has turned one way, and −r up to +r·cos a when he
        # has turned the other. At nought that is the whole width, at ninety
        # exactly half, at a hundred and eighty none of it.
        #
        # The old head drew a full-width skin box under a hair cap, so its two
        # profiles were identical and every left-right check quietly passed.
        d.rectangle([px - half, y0 + 12, px + half, y1], fill=SKIN)
        side = 1 if sin >= 0 else -1
        edge = px - half * cos * side
        if side > 0:
            d.rectangle([px - half - 3, y0 + 12, edge, y1], fill=HAIR)
            f0, f1 = edge, px + half
        else:
            d.rectangle([edge, y0 + 12, px + half + 3, y1], fill=HAIR)
            f0, f1 = px - half, edge
        # the fringe is on top of him whichever way he is facing
        d.rectangle([px - half - 3, y0, px + half + 3, y0 + int((y1 - y0) * 0.32)], fill=HAIR)
        wide = f1 - f0
        if wide > half * 1.2:                          # enough face for two eyes
            for t in (0.28, 0.72):
                ex = f0 + wide * t
                d.rectangle([ex - 6, y0 + 58, ex + 6, y0 + 68], fill=(56, 50, 48))
            d.rectangle([px - 11, y0 + 96, px + 11, y0 + 104], fill=(160, 104, 100))
        elif wide > half * 0.25:                       # a profile: nose and lip
            nose = f1 - 6 if side > 0 else f0 + 6
            d.rectangle([nose - 5, y0 + 58, nose + 5, y0 + 70], fill=(56, 50, 48))
            d.rectangle([nose - 6, y0 + 96, nose + 6, y0 + 104], fill=(160, 104, 100))


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


# A figure that is NOT left-right symmetric, which is the only kind that can
# test which way round the side views go.
#
# The ground truth is physical and needs no convention to state: in the FRONT
# photograph the person faces the camera, so whatever appears on the LEFT of
# that picture is on the person's OWN RIGHT. The generator places its parts by
# `px = cx + x*cos - z*sin`, so at nought a part at negative x lands on the
# left of the frame — which is why PARTS calls x=-20 the right leg. Paint that
# arm red and the red arm is his right arm, in every view, for ever.
MARK = {-57: (206, 44, 44), +57: (44, 92, 206)}     # right red, left blue

# The same trick on the head, for the framing people actually use when they
# want a FACE: a head-and-shoulders portrait. A patch on each cheek, his right
# one red, sitting forward of centre so it shows in profile as well as head-on.
CHEEKS = [
    (-26, -14, 7, 7, 0.095, 0.145, (206, 44, 44)),
    (+26, -14, 7, 7, 0.095, 0.145, (44, 92, 206)),
    # Hair UP, in a bun, which is what half the people who photograph their own
    # face are wearing — and it is the thing that broke this. Anything that
    # looks at "the top sixth of the outline" for a face finds a bun, scores
    # nought either way, and then picks which way the person turned out of the
    # rounding error underneath it.
    (0, 6, 15, 15, -0.030, 0.005, HAIR),
]
PORTRAIT = (0, 232, W, 720)                        # head, neck and shoulders


def main() -> None:
    import sys
    turns = 8
    if "--portrait" in sys.argv:
        # what somebody photographing their own face hands the program: the
        # neck is HALFWAY down the outline, not an eighth of the way
        PARTS.extend(CHEEKS)
        os.makedirs(OUT, exist_ok=True)
        for a in [None, 0, 45, 90, 135, 180, 225, 270, 315]:
            name = "port-plate.png" if a is None else f"port-{a}.png"
            path = os.path.join(OUT, name)
            shot(a, path)
            Image.open(path).crop(PORTRAIT).save(path)
        print("head-and-shoulders framing; his RIGHT cheek is red")
        print("and lands on the LEFT of port-0.png")
        return
    if "--mark" in sys.argv:
        # his right arm red, his left arm blue, and nothing else changed
        for i, part in enumerate(PARTS):
            if part[2] == 13:
                PARTS[i] = part[:6] + (MARK[part[0]],)
        os.makedirs(OUT, exist_ok=True)
        shot(None, os.path.join(OUT, "mark-plate.png"))
        for a in (0, 45, 90, 135, 180, 225, 270, 315):
            shot(a, os.path.join(OUT, f"mark-{a}.png"))
        print("his RIGHT arm is red and lands on the LEFT of mark-0.png")
        return
    if "--turns" in sys.argv:
        turns = int(sys.argv[sys.argv.index("--turns") + 1])
    os.makedirs(OUT, exist_ok=True)
    shot(None, os.path.join(OUT, "room-plate.png"))
    # the canonical eight, which the regression checks are written against
    for a in (0, 45, 90, 135, 180, 225, 270, 315):
        shot(a, os.path.join(OUT, f"room-{a}.png"))
    for i in range(turns):
        a = round(i * 360 / turns)
        # metering wanders shot to shot whether or not the table has an entry
        if a not in EXPOSURE:
            EXPOSURE[a] = (0.84 + 0.14 * ((i * 7) % 5) / 4,
                           (1.00 + 0.03 * ((i * 3) % 3) / 2, 1.00, 0.98))
        shot(a, os.path.join(OUT, f"many-{i:02d}-{a}.png"))
    print(f"{turns} turns written as many-NN-DEG.png")
    print(f"crown y={CROWN} feet y={FEET} height={BODY_H}px  (arms DOWN, shadowed,")
    print("  and every shot metered differently, which is the point)")


if __name__ == "__main__":
    main()
