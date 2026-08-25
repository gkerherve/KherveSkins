#!/usr/bin/env python3
"""A stand-in portrait, so a check does not need a real person's photograph.

    python tools/make_test_face.py

Writes `shots/test-face.png`: a head, shoulders and a shirt, drawn plainly
enough that the face-finder has an honest job to do and precisely enough that
a check can say where the eyes ARE and compare that with where the generator
put them. Not a photograph, and not meant to look like one — it is a ruler.
"""

from __future__ import annotations

import os

from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(HERE, "shots")

W, H = 640, 800
SKIN = (228, 178, 140)
SKIN_DARK = (198, 148, 112)
HAIR = (62, 42, 30)
SHIRT = (46, 104, 168)
EYE = (72, 118, 92)
LIP = (176, 96, 92)

# where things are, in pixels — the check reads these back
HEAD = (200, 120, 440, 470)          # left, top, right, bottom of the whole head
EYE_Y = 300
MOUTH_Y = 390


def main() -> None:
    img = Image.new("RGB", (W, H), (206, 214, 226))
    d = ImageDraw.Draw(img)
    # a wall behind, lit from the left
    for x in range(W):
        k = 1 - abs(x - W * 0.35) / W * 0.5
        d.line([(x, 0), (x, H)], fill=(int(196 * k), int(206 * k), int(220 * k)))

    # shoulders and shirt
    d.ellipse([60, 560, W - 60, H + 220], fill=SHIRT)
    d.rectangle([250, 430, 390, 590], fill=SKIN_DARK)          # neck

    # head
    d.ellipse(HEAD, fill=SKIN)
    # a little modelling down the right-hand side
    d.ellipse([HEAD[0] + 120, HEAD[1] + 40, HEAD[2] + 10, HEAD[3]], fill=SKIN_DARK)
    d.ellipse([HEAD[0] + 6, HEAD[1] + 10, HEAD[2] - 30, HEAD[3] - 20], fill=SKIN)

    # hair: a cap over the top third, with a fringe
    d.pieslice([HEAD[0] - 14, HEAD[1] - 10, HEAD[2] + 14, HEAD[1] + 260],
               start=180, end=360, fill=HAIR)
    d.rectangle([HEAD[0] - 14, HEAD[1] + 100, HEAD[0] + 26, HEAD[1] + 240], fill=HAIR)
    d.rectangle([HEAD[2] - 26, HEAD[1] + 100, HEAD[2] + 14, HEAD[1] + 240], fill=HAIR)

    # brows
    d.rectangle([256, EYE_Y - 34, 302, EYE_Y - 24], fill=HAIR)
    d.rectangle([338, EYE_Y - 34, 384, EYE_Y - 24], fill=HAIR)

    # eyes
    for cx in (279, 361):
        d.ellipse([cx - 26, EYE_Y - 14, cx + 26, EYE_Y + 14], fill=(246, 244, 240))
        d.ellipse([cx - 12, EYE_Y - 12, cx + 12, EYE_Y + 12], fill=EYE)
        d.ellipse([cx - 5, EYE_Y - 5, cx + 5, EYE_Y + 5], fill=(24, 20, 18))

    # nose and mouth
    d.polygon([(320, EYE_Y + 20), (306, MOUTH_Y - 26), (334, MOUTH_Y - 26)], fill=SKIN_DARK)
    d.ellipse([288, MOUTH_Y - 14, 352, MOUTH_Y + 14], fill=LIP)
    d.line([(288, MOUTH_Y), (352, MOUTH_Y)], fill=(120, 62, 60), width=3)

    img = img.filter(ImageFilter.GaussianBlur(1.4))
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, "test-face.png")
    img.save(path)
    print(f"{path}  head={HEAD} eyes={EYE_Y} mouth={MOUTH_Y}")
    room()


# The hard one.
#
# A PALE room and a PALE top, which is the case that caught the first version
# out: the background remover was asking "is this far from his complexion",
# and a white kitchen wall is nearer to a pale forehead than a shadowed cheek
# is. So the wall survived, and since the top of the head is built from the
# face's first row, it turned the crown white. Same head, same measurements —
# only what is behind it and what he is wearing have changed.
ROOM_SHIRT = (232, 226, 214)
ROOM_HAIR = (108, 78, 54)


def room() -> None:
    img = Image.new("RGB", (W, H), (236, 238, 240))
    d = ImageDraw.Draw(img)
    for x in range(W):
        k = 0.86 + 0.14 * (1 - abs(x - W * 0.3) / W)
        d.line([(x, 0), (x, H)], fill=(int(240 * k), int(241 * k), int(238 * k)))
    # a doorway and a worktop, so the wall is not one flat colour anywhere
    d.rectangle([40, 60, 190, 700], fill=(214, 216, 219))
    d.rectangle([470, 300, W, 360], fill=(198, 196, 190))
    d.rectangle([470, 360, W, 700], fill=(224, 222, 216))

    d.ellipse([60, 560, W - 60, H + 220], fill=ROOM_SHIRT)
    d.rectangle([250, 430, 390, 590], fill=SKIN_DARK)
    d.ellipse(HEAD, fill=SKIN)
    d.ellipse([HEAD[0] + 120, HEAD[1] + 40, HEAD[2] + 10, HEAD[3]], fill=SKIN_DARK)
    d.ellipse([HEAD[0] + 6, HEAD[1] + 10, HEAD[2] - 30, HEAD[3] - 20], fill=SKIN)
    d.pieslice([HEAD[0] - 18, HEAD[1] - 10, HEAD[2] + 18, HEAD[1] + 250],
               start=180, end=360, fill=ROOM_HAIR)
    d.rectangle([HEAD[0] - 18, HEAD[1] + 100, HEAD[0] + 30, HEAD[1] + 260], fill=ROOM_HAIR)
    d.rectangle([HEAD[2] - 30, HEAD[1] + 100, HEAD[2] + 18, HEAD[1] + 260], fill=ROOM_HAIR)
    # a fringe, which is what pushes the eyes down the head
    d.rectangle([HEAD[0] + 20, HEAD[1] + 100, HEAD[2] - 20, HEAD[1] + 138], fill=ROOM_HAIR)

    d.rectangle([258, EYE_Y - 30, 300, EYE_Y - 22], fill=(84, 62, 44))
    d.rectangle([340, EYE_Y - 30, 382, EYE_Y - 22], fill=(84, 62, 44))
    for cx in (279, 361):
        d.ellipse([cx - 24, EYE_Y - 12, cx + 24, EYE_Y + 12], fill=(244, 242, 238))
        d.ellipse([cx - 11, EYE_Y - 11, cx + 11, EYE_Y + 11], fill=(96, 118, 132))
        d.ellipse([cx - 4, EYE_Y - 4, cx + 4, EYE_Y + 4], fill=(28, 24, 22))
    d.polygon([(320, EYE_Y + 24), (308, MOUTH_Y - 28), (332, MOUTH_Y - 28)], fill=SKIN_DARK)
    d.ellipse([292, MOUTH_Y - 12, 348, MOUTH_Y + 12], fill=(196, 138, 132))
    d.line([(292, MOUTH_Y), (348, MOUTH_Y)], fill=(140, 88, 84), width=3)

    img = img.filter(ImageFilter.GaussianBlur(1.6))
    path = os.path.join(OUT, "test-room.png")
    img.save(path)
    print(f"{path}  the pale-wall, pale-shirt case")


if __name__ == "__main__":
    main()
