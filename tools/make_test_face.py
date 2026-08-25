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


if __name__ == "__main__":
    main()
