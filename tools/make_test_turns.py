#!/usr/bin/env python3
"""Four photographs of a person who does not exist, for checking the carve.

    python tools/make_test_turns.py

Writes `shots/turn-plate.png` and `turn-0/90/180/270.png`: a boxy figure of
KNOWN dimensions, photographed from four quarters against a room, plus the
empty room. It is a ruler, not a photograph — the whole point is that the
carve can be compared with numbers rather than with an impression.

The figure, in the same units the carve reports (cubes of the volume, with
the crown at nought):

    head      0 .. 15      shoulders at 16
    torso    16 .. 44      hips at 45
    legs     45 .. 71
    arms     held a gap away from the ribs, which is the thing the guidance
             asks for and the thing this file exists to prove matters
"""

from __future__ import annotations

import math
import os

from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(HERE, "shots")

W, H = 480, 720
FLOOR = 660
TOP = 90                       # crown
BODY_H = FLOOR - TOP           # 570 px tall

# the figure in fractions of its own height, measured from the crown
HEAD = (0.00, 0.22)
NECK = (0.22, 0.25)
TORSO = (0.25, 0.62)
LEGS = (0.62, 1.00)

SKIN = (226, 176, 140)
HAIR = (74, 52, 36)
SHIRT = (58, 104, 168)
TROUSER = (46, 54, 82)
SHOE = (36, 32, 28)
ARM_GAP = 18                   # the daylight between arm and ribcage


def room(d: ImageDraw.ImageDraw) -> None:
    for y in range(H):
        k = 0.80 + 0.20 * (1 - y / H)
        d.line([(0, y), (W, y)], fill=(int(214 * k), int(218 * k), int(224 * k)))
    d.rectangle([0, FLOOR + 26, W, H], fill=(150, 142, 132))


def band(t: float) -> int:
    return TOP + int(BODY_H * t)


def figure(d: ImageDraw.ImageDraw, angle: int) -> None:
    """Draw the figure as seen from `angle` degrees round it.

    Depth is drawn as a narrower silhouette: a person is about half as deep
    as they are wide, so a side view is narrower than a front view, and the
    quarter turns in between are what actually make the carve work.
    """
    cx = W // 2
    a = math.radians(angle)
    # half-width of each part, front-on and in profile
    def w(front: float, side: float) -> int:
        # An ELLIPSE, not a box. Widths that simply ADD make the diagonal view
        # the widest of the lot, which no torso does — and a program that
        # finds the front by looking for the widest outline would then be
        # tested against a figure that is widest at forty-five degrees. A body
        # in cross-section is an ellipse and projects as one.
        return max(2, int(math.hypot(front * math.cos(a), side * math.sin(a))))

    # legs
    y0, y1 = band(LEGS[0]), band(LEGS[1])
    legw = w(15, 15)
    gap = int(10 * abs(math.cos(a)))
    for sx in (-1, 1):
        x = cx + sx * (gap + legw // 2)
        d.rectangle([x - legw // 2, y0, x + legw // 2, y1 - 22], fill=TROUSER)
        d.rectangle([x - legw // 2, y1 - 22, x + legw // 2, y1], fill=SHOE)

    # torso
    y0, y1 = band(TORSO[0]), band(TORSO[1])
    tw = w(40, 24)
    d.rectangle([cx - tw, y0, cx + tw, y1], fill=SHIRT)

    # arms, held clear of the ribs but JOINED at the shoulder, which is what a
    # real one does — an arm floating free of the body is a separate shape,
    # and any sane silhouette finder throws away everything but the largest
    aw = w(13, 13)
    yoke = int(ARM_GAP * abs(math.cos(a))) + 10
    for sx in (-1, 1):
        x = cx + sx * (tw + ARM_GAP + aw)
        d.rectangle([min(x - aw, cx - tw), y0, max(x + aw, cx + tw), y0 + yoke], fill=SHIRT)
        d.rectangle([x - aw, y0, x + aw, y1 - 10], fill=SHIRT)
        d.rectangle([x - aw, y1 - 10, x + aw, y1 + 26], fill=SKIN)

    # neck
    y0, y1 = band(NECK[0]), band(NECK[1])
    nw = w(11, 11)
    d.rectangle([cx - nw, y0, cx + nw, y1], fill=SKIN)

    # head, with hair on the crown and round the back
    y0, y1 = band(HEAD[0]), band(HEAD[1])
    hw = w(26, 24)
    d.rectangle([cx - hw, y0, cx + hw, y1], fill=SKIN)
    d.rectangle([cx - hw, y0, cx + hw, y0 + int((y1 - y0) * 0.34)], fill=HAIR)
    facing = math.cos(a)
    if facing > 0.4:
        for ex in (-hw // 2, hw // 2):
            d.rectangle([cx + ex - 5, y0 + 34, cx + ex + 5, y0 + 42], fill=(60, 62, 70))
        d.rectangle([cx - 10, y0 + 60, cx + 10, y0 + 66], fill=(158, 96, 92))
    elif facing < -0.4:
        d.rectangle([cx - hw, y0, cx + hw, y0 + int((y1 - y0) * 0.72)], fill=HAIR)


def shot(angle: int | None, path: str) -> None:
    img = Image.new("RGB", (W, H))
    d = ImageDraw.Draw(img)
    room(d)
    if angle is not None:
        figure(d, angle)
    img.filter(ImageFilter.GaussianBlur(0.6)).save(path)
    print(path)


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    shot(None, os.path.join(OUT, "turn-plate.png"))
    # eight turns, not four: the diagonals are what round a shoulder off, and
    # they are what the carve was short of
    for a in (0, 45, 90, 135, 180, 225, 270, 315):
        shot(a, os.path.join(OUT, f"turn-{a}.png"))
    # AND one deliberately spoiled set, because the interesting question is
    # not "does it work when the shots are perfect" — it is what happens when
    # one of them is not. This one has a turn taken from further back.
    global TOP, FLOOR, BODY_H
    keepT, keepF, keepB = TOP, FLOOR, BODY_H
    TOP, FLOOR = 150, 600
    BODY_H = FLOOR - TOP
    shot(90, os.path.join(OUT, "turn-bad90.png"))
    TOP, FLOOR, BODY_H = keepT, keepF, keepB
    print(f"figure: crown y={TOP} floor y={FLOOR} height={BODY_H}px")
    print("  head 0.00-0.22  neck 0.22-0.25  torso 0.25-0.62  legs 0.62-1.00")


if __name__ == "__main__":
    main()
