# FaceCraft

Turn a photograph into a Minecraft skin.

Show it a picture of somebody, and it hands you the 64×64 PNG Minecraft wants
— a whole character, front and back, hair, clothes and shoes — with a live
figure standing beside it — watching your pointer — so you can see what you
are actually making. Then
adjust everything, or paint on it texel by texel.

One page of plain JavaScript. **No build step, no npm, nothing to install**,
and the same file runs on Windows and on Android.

![what it makes](docs/example.png)

## How many pixels

The one control that changes what the tool can do rather than what it makes.

![the three sizes](docs/resolutions.png)

At **64×64** a face is eight pixels across, and eight pixels is a suggestion
of somebody. It is also the only size vanilla Java Minecraft accepts, so it
is the default. **128** gives a sixteen-pixel face and **256** a
thirty-two-pixel one — brows, eyelids, lips, a hairline — and at those sizes
the photograph starts carrying the likeness by itself rather than leaning on
the tricks below.

128 and 256 are the HD skin sizes: Bedrock skin packs take them, and Java
does with an HD-skin mod. At either size the export offers a 64×64 as well,
averaged down rather than sampled, so there is always something to upload.

## Run it

**Windows** — double-click **Skin Maker.bat**, or:

```bash
python serve.py --open
```

Then <http://localhost:8140/>.

**Android** — start the server on your PC as above and open the address it
prints under `phone` (same wifi) in Chrome. Then **⋮ → Add to Home screen**
and it becomes an app: full screen, its own icon, and it keeps working with
the PC switched off, because everything it needs is cached the first time.

It is an ordinary static site, so any web host works too — put the folder
somewhere and it runs, with everything except *Save to skins/* (which needs
the little Python server to have somewhere to write).

## Using it

**Photo.** Choose a picture, take one with the phone's camera, paste one, or
drop one on the window. A head-and-shoulders shot looking at the camera gives
the best face.

It finds the head by itself and draws a box round it, with two dashed lines
across it and two pins on the eye line. **Those matter more than anything
else in the program.** A Minecraft face is eight pixels across, so an eye
landing between two of them is two half-eyes and reads as neither — the
sampler pins the eye line, the mouth line and both eyes onto whole texels
before it averages anything. When the automatic guess is wrong, drag them;
it takes a second and it is the difference between a face and a smudge.

![four photographs, carved, and made into a man](docs/carve.png)

**3D.** The other way in, and the more interesting one: **a handful of
photographs and it works out your actual shape**. Not a face on a box — you, from every
side. Prop the phone up, stand well back, and turn a little at a time. Then give it
**one photograph of the empty room and all the rest in one go** — four of
them, or ten, or twenty; it works out which way round each one was on its
own, from the order you took them and where the face is. Four quarter turns
is the least that works and more is better, because four outlines cannot tell
a round shoulder from a boxy one.

It works by **shape from silhouette**. In each photograph it decides which
pixels are you and which are room; then it takes a block of space where you
stood, chops it into little cubes, and asks of every cube whether it lands on
you in *all four* pictures. Land on the room even once and the cube was never
there. What survives is you, in cubes — spin it, then press **Turn this into
a Minecraft man**.

Two things it does that make a real capture work rather than a staged one.
The **empty-room** shot is exposure-matched to each frame before it is
subtracted, because a phone re-meters between shots and a wall that comes back
darker otherwise reads as a person — on a real set that put 87% of one picture
inside the outline. And a **shadow** is told from a person by chromaticity: a
shadow does not change what colour the floor is, only how much light comes off
it. Without that the outline grows a foot of floor, and since every view is
scaled on the height of its outline, one shadow mis-scales the lot.

**Or skip the photographs and take one video.** Prop the phone, press record
on the empty room, step in, turn one slow full circle, step out, stop. The
recording is the whole capture in a single take — the opening frame is the
empty room and everything after it is a turn. The program pulls out a couple
of stills a second, drops the ones where nobody is in frame and the ones
where you had not actually turned since the last one kept, and builds the
moment it has enough. A second video adds to the pile; carry on turning from
where the last one stopped. (A truly live camera needs a secure https page,
which a home server is not — a recording is the same pixels at thirty a
second, and you can retake it.)

Everything it needs to know about the photographs it works out from their
SHAPE and never from a fraction of the frame — where the neck is, which way
you were facing, which way round you turned. Hair up in a bun, standing back,
right up close: same answers. It also checks the empty-room shot is the same
shape as the turns, because a plate from a different camera compares every
pixel with the wrong one and hands back a solid block.

Each shot's thumbnail shows you **what it found** — room dimmed, person lit —
so a capture that has gone wrong is a glance rather than a mystery.

Every view is scaled on the **median** height of all of them rather than its
own, which is what makes one duff photograph cost a little accuracy instead
of most of the person: the same set with one shot taken from further back
carves to the same neck, hip and floor, to the cube, and the app names the
odd one out.

Two consequences of the method are why the guidance is worded as it is. The
camera must not move and you must turn on the spot, because the whole thing
assumes one axis of rotation. And **hold your arms a little away from your
sides** — an arm touching your ribs cannot be told from your ribs, and you
come out as a barrel.

![the head alone, carved from the same photographs](docs/head.png)

**Just the head.** A tick box on the same card, and it is the setting most
people want. Everything else is unchanged — the same photographs, the same
empty room, the same turns — but it carves from the crown to the neck only,
so the whole grid lands on the part anybody recognises: **about fifty cubes
across a face instead of ten**, from exactly the pictures you already gave it.
The body keeps whatever it already had, so a head from photographs can sit on
a wardrobe you dressed by hand.

**You do not have to say which sort of photographs they are.** A head-and-
shoulders portrait has a head a third of the outline tall; somebody standing
back has a head an eighth of it. The program measures that and ticks the box
itself, because there is no body in a portrait to carve and pretending
otherwise gives you a Minecraft man whose legs were guessed off his chin.
Untick it and it stops guessing.

It is also the better answer for a face, and not only the cheaper one. The
six squares of the head are taken **straight from the photographs** — for
each square, the shot taken most nearly square-on to it — rather than through
the cubes. Going through the hull costs two averagings, photographs into
cubes and cubes into texels, and a face sixteen pixels across cannot spare
either. The hull is still built, because it is the thing you spin and it is
how the app knows the head's own proportions; it is simply not in the path
between the photograph and the face. The front square still gets the eye and
mouth **warp** that the single-photograph path uses, which is most of the
difference between a face and a smear.

**Face.** Which of the eight rows the eyes and the mouth sit on, and the tone
of the photograph — brightness, contrast, colour, warmth, sharpness. Also
*features*: how hard the eyes, the brow line and the mouth are drawn on top
of what was sampled. Every colour it uses was found in your photograph; what
the slider changes is how much it commits to them.

![the wardrobe](docs/wardrobe.png)

**Wear.** The wardrobe, laid out the way Minecraft's own is, as a **tree**:
Hair, Tops, Bottoms, Outerwear, Headwear, Gloves, Footwear, Face Items, Back
Items. Tap a heading to open it in place — more than one can be open at once,
and they stay how you leave them. Inside each is a grid of things, every one
drawn on a little figure in *your* colours so choosing between two of them is
a fair comparison.

**Two hundred and forty-four items**, every one generated rather than stored,
so they fit any resolution and any palette. Fifty haircuts; thirty-five tops;
denim that streaks, knit that has a grain, leather that speckles, metal with
a highlight down it; plaid and tartan and camouflage and argyle; hems, cuffs,
collars, seams, laces and buttons.

Each category has a colour of its own, and the three the photograph can
actually answer — hair, top, bottom, footwear — start on **From the photo**,
which means "leave what the picture gave you".

**Style**, the first entry, is the rest of it: how many pixels, classic or
slim arms, the five colours the photograph gave (each labelled *read off the
photograph*, *yours*, or *invented*), whether to take the clothes off the
photograph at all, and the shading and grain.

**Paint.** The flat image, every face outlined so you can tell an ear from a
hem. Brush, eraser, eyedropper, fill, lighten, darken, and **Move**; both
layers or one; undo and redo. Getting about: two fingers, the middle button,
the right button or the Move tool all drag the picture; the wheel and pinch
zoom, and so do the **+ / − / Fit** buttons. The one that actually gets used
is **Jump to…** — pick *left leg — back* off the list rather than hunting for
it. **Mirror** paints the other side of the body at the same time
— the left arm lives twenty-eight rows away from the right one and faces the
other way, and doing that by hand is what makes people give up. You can also
turn on **paint on him** above the figure and click the model directly.

Painting survives the sliders. Move anything on any other tab and the face is
rebuilt underneath, with your work laid back on top.

**Save.** *Download* gives you the PNG. On a phone, *Share* hands it straight
to another app. *Listing picture* renders the figure big, on nothing, for
whatever you are selling it on. *Keep* puts it on this browser's shelf so an
unfinished face is still there tomorrow, and *Save to skins/* writes the PNG
and its settings into this folder — so a skin can be reopened in a month and
adjusted rather than started over.

### Getting it into Minecraft

- **Java** — minecraft.net → your profile → Skins → upload the PNG. Classic
  or slim must match the button in the top bar here.
- **Bedrock** (phone, console, Windows 10/11) — Dressing Room → Classic Skins
  → Owned → Import, and pick the PNG.

## How it works

Nine files, and each one has a job:

| file | what it knows |
| --- | --- |
| `js/layout.js` | the shape of a skin: which rectangle of the 64×64 is the back of his left calf |
| `js/pixels.js` | the image buffer, and colour arithmetic |
| `js/photo.js` | finding a head in a photograph, and squeezing part of one into a grid of texels |
| `js/generate.js` | the whole man: face, hair, the back of the head, and clothes |
| `js/model.js` | the figure in three dimensions, and the walk |
| `js/cropper.js` | the box, the two lines and the two pins |
| `js/paint.js` | the flat editor, and mirroring |
| `js/carve.js` | telling a person from a room, and carving the visual hull |
| `js/turns.js` | working out which way round each photograph was |
| `js/faces3d.js` | the six squares of the head, straight from the photographs |
| `js/voxel.js` | showing the carved person |
| `js/fit.js` | the carved person, made into a Minecraft man |
| `js/wardrobe.js` | two hundred and forty-four garments, each a function |
| `js/doll.js` | the little figures in the wardrobe's grid |
| `js/store.js` | the shelf, and every way out |
| `js/app.js` | what is wired to what |

The one thing worth understanding before changing anything: **at the size
Minecraft actually takes, a face is eight pixels across.** An ordinary resize
of a photograph to that is a beige smear with two grey dots in it, which is
why most photo-to-skin tools look like nothing in particular. Four things
stop it — the **warp**, which pins the eyes and the mouth to whole texels
before averaging; the **detail** pass, which puts back the local contrast
that averaging is precisely the operation for removing; the **nudge**, which
decides that the darkest texel in the eye row is an eye and treats it as one;
and the **wall**, because a head box is a rectangle and a head is not, so
what was behind the person is flooded out from the edge before it can leak
down the side of the head. Every one of them eases off as the size goes up.

The face-finder is worth a paragraph of its own, because the thing that made
it work was not a better colour rule. **The whites of eyes are never
skin-coloured** — so on any face, of any complexion, in any light, the two
eyes are two small holes punched in an otherwise solid run of skin. Find the
holes, and the rest of the head follows from proportions that hold across
people: the distance between the pupils is about a third of the width of a
head and a quarter of its height. Measured against a drawn portrait whose
true measurements were known, that lands within four pixels on every number
— where reading the head off the edges of the skin was out by a hundred and
fifty.

## Tools

`tools/make_icons.py` draws the app icons and `tools/make_test_face.py` draws
a stand-in portrait, so a check never needs a real person's photograph. Both
need Pillow; nothing else in the project needs anything.

## Selling them

The program is yours and so is what comes out of it. A real person's face is
not: a recognisable likeness of a living celebrity, *sold*, is a
publicity-rights problem nearly everywhere, however it was drawn. That is a
question about whose photograph you fed it, and it is yours to answer.
