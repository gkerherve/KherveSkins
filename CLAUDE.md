# KherveSkins — working notes for Claude

## Do what was asked, without asking to

Everything asked for gets built in the session it is asked for. Standing
authorisation, every time.

- "Put it in the queue" means *do it this session*. A queue is an order of
  work, not a holding pen.
- **Do not stop to confirm.** Where a request could be read two ways, pick the
  reading a reasonable person meant, say which one in a sentence, and build
  it. A question that pauses the work costs more than a wrong guess, which is
  cheap to change once it exists and can be looked at.
- Never report something as done that is not. If part of a request was not
  built, say exactly which part and why, in the chat, without being asked.
- Big items go FIRST. A cheap fix that arrives while a large build is
  unfinished waits its turn.

## Always commit and push

At the end of every chat, commit the work. Group it into coherent commits —
one per feature or fix, `feat:` / `fix:` / `chore:` and a lowercase summary
that says what changed for the person using it. Work goes straight onto
`main`; no branches or PRs unless asked. Never commit `shots/`.

## What this is

A browser tool that turns a photograph into a Minecraft skin — the 64×64 PNG,
plus a live figure wearing it and an editor for both. **ES modules, Three.js
from a CDN, no build step and no npm.** Edit a file in `js/` and reload.
Python is only the dev server.

It has to work on **Windows and on Android from the same files**, which is
most of why it is a web app and all of why every control is pointer-events
and thumb-sized.

## Size

**Everything is written in sixty-fourths and multiplied.** `scaleOf(size)` is
the multiplier; 64, 128 and 256 are the sizes; nothing downstream hard-codes
64. The model's shape — where an arm hangs, how big a head is — stays in
sixty-fourths whatever the size, because he is the same man however finely he
is painted. Only the rectangles scale.

64 is the only size vanilla Java takes and is the default. The others are the
HD sizes, and they matter more than any of the cleverness below: at 256 a
face is thirty-two pixels across and the photograph carries the likeness by
itself. Two consequences worth remembering:

- **The texture is rebuilt with the figure**, not reused. A canvas that
  changes size under a Three texture does not reliably reach the card again;
  the geometry gets its new UVs, the picture stays the old one, and a 256
  skin renders as the same eight blocks it had at 64. That cost an hour.
- **The painter cannot draw texel by texel.** At 256 the dead-zone pass was
  sixty-five thousand canvas calls a redraw. The dead zones and the chequer
  are both stamped from cached images now, and the region lookup is a table
  (`regionMap`) rather than seventy-two rectangle comparisons per texel.

## The rule everything is built on

**At the size Minecraft actually takes, a face is eight pixels across.**

That one number decides the architecture. A photograph resized to 8×8 is a
beige smear with two grey dots in it — that is what a naïve version of this
program produces, and it is why most photo-to-skin tools look like nothing in
particular. Four things stop it, and none of them is optional:

1. **The warp** (`sampleFace`, `js/photo.js`). The eye line, the mouth line
   and both eye *columns* are pinned to whole texel centres before anything
   is averaged. An eye landing on the boundary between two texels is two
   half-eyes and reads as neither. This is the single highest-value thing in
   the codebase; the eye columns were added after a render showed a face with
   one eye and it was measured, not guessed.
2. **The detail pass** (`crisp`, `js/generate.js`). Averaging is precisely the
   operation that removes local contrast, so it is put back afterwards — on
   the 8×8, not on the photograph, because it is the small picture that has
   gone soft. It **must not overshoot**: clamped to the range of the
   neighbourhood, or the one dark texel beside a lit cheek becomes pure black
   and a black square on a face reads as a hole in the man.
3. **The nudge** (`emphasize`). The darkest texel in the eye row IS an eye,
   and is treated as one. Every colour it uses was found in that row of the
   photograph — it does not invent features, it commits to them.
4. **The de-background** (`dropBackground`). A head box is a rectangle and a
   head is not, so its corners are the wall. Found by flooding in from the
   EDGE — background is the stuff that touches the outside — and never
   allowed into the middle 4×4, because a grey-green eye against a grey wall
   is a closer colour match than an eye is to a cheek. It leaks if you skip
   it: the sides of the head are built from the front's edge column and the
   top from its first row, so one bad corner becomes a stripe down the ear.

## Finding the face

Two hard-won things, both found by looking at output rather than by reading
about faces:

**The eyes are HOLES.** The whites of eyes are never skin-coloured — the test
wants forty points of red over green and a sclera is neutral — so on any face
the two eyes are small enclosed gaps in an otherwise solid run of skin. Flood
the not-skin cells inward from the rim of the blob's box; what the flood
cannot reach is a hole; a pair of them at the same height and the right
distance apart is a face. Then the head follows from proportions that hold
across people (pupil distance ≈ 1/2.9 of head width, ≈ 1/4.25 of head
height, eye line halfway down). Within four pixels on every number, against a
reading off the skin's own edges that was out by a hundred and fifty.

**The colour rule has two holes in it** and both were found the same way.
Dark brown hair is the same colour as skin in chroma and differs only in
brightness — hence the value floor, and hence `splitByBrightness`, which asks
THIS head where its own light and dark halves divide (Otsu) rather than
imposing a threshold that would exclude somebody's complexion. A cream shirt
clears the standard chroma test by a whisker, and a portrait is mostly shirt
— hence `r - g > 12`, because skin has forty or fifty points of red over
green at any complexion and undyed cloth has six.

`fromBlob` is the old path, kept for closed eyes, sunglasses and heads turned
away. It is much worse and it is never nothing.

## The other load-bearing agreement

**The figure faces −Z, and his right hand is at +X.** `layout.js` and
`model.js` both depend on it. Get it backwards and everything still renders,
inside out, with his parting on the wrong side — the kind of wrong that
survives a dozen screenshots because nobody can say why it looks odd.

Two consequences in `setBoxUV` (`js/model.js`), both verified against renders
rather than reasoned about:

- The four upright faces take their rectangle as you would read it.
- The top and bottom are turned through **half a circle**, because Three
  unwraps a box as though it faced +Z. On the top face, image-up is the BACK
  of the head; on the bottom face, image-up is the FRONT. They are not the
  same, and that is correct.
- Neighbouring boxes overlap by **half a percent** (`WELD`). Minecraft's
  parts touch exactly, which is invisible against an opaque world and a
  hairline crack down the middle of him in the listing shot, which has no
  background at all.
- Every rectangle is inset by **a twentieth of a texel** (`BLEED`). Without
  it the far edge of a face samples exactly on the boundary and
  nearest-neighbour rounds INTO THE NEXT RECTANGLE — a dashed grey hem along
  one edge of a limb, invisible until you photograph the model against a
  colour that is not the page.

## The carve

`js/carve.js` is shape-from-silhouette, and it is the only photogrammetry
that belongs in this program: no model to download, no build step, nothing
about lenses, and its natural output is CUBES, which is what the destination
is made of. Four outlines, a block of space, and every cube that misses the
person in any one view is carved away.

Its limits are honest and worth knowing before trying to fix them. A hull is
the tightest shape the outlines allow and never tighter — it cannot see into
a dimple, and with four views the cross-sections are square, which is why a
45-degree view of the result looks boxier than the front. More views would
round it; nothing else will.

Three things that cost time and would cost it again:

- **`mw`/`mh` are the picture, `x/y/w/h` are the person in it.** Spreading
  the bounding box over the mask's own `w`/`h` made every projection read the
  wrong row, silently, and the carve returned zero cubes with no error.
- **Line the views up on the HEAD, not on the outline's middle.** A person
  turning on the spot keeps their head over the axis; their silhouette centre
  moves, because a shoulder is wider than a chest.
- **An arm that does not touch the body is a separate blob**, and
  `keepLargest` will bin it. Real arms attach at the shoulder so this is fine
  in practice — but it is why the test generator draws a yoke, and it is the
  reason the guidance asks for daylight at the ribs and not at the shoulder.

`js/fit.js` maps the carve onto the model, and the fact it exists to deal
with is that **a person is seven and a half heads tall and a Minecraft man is
four**. So the mapping is anatomical, not a scale: find the neck, the hips
and the floor and pin them to the joins between the boxes — the same trick as
the eye line, one ring out.

Two mistakes already made there, both of which produce a figure that renders
happily and is wrong:

- **Every part needs its OWN box of cubes.** One scale for the whole figure
  cannot work: the model's head is as wide as its chest and a real head is
  half as wide, so a head box sized off the torso reaches past the ears and
  samples nothing.
- **Count the leg-split within the TRUNK's columns.** Arms held clear of the
  sides make three runs across a slice from shoulder to wrist, so "how many
  runs" answers three long before it answers two, and puts the hips in the
  ribs.

`python tools/make_test_turns.py` draws the four views plus the empty room,
of a figure whose neck, hips and floor are known. The carve should land on
16 / 45 / 71 of 72 cubes. If it drifts, that is a regression however good the
render looks.

## The wardrobe

`js/wardrobe.js` is a hundred and twenty-five items across nine categories,
and **not one of them is stored**. Every item is a function that paints in
FRACTIONS of the part it is on, so the same wardrobe fits a 64 and a 256
without a second set of numbers, and takes whatever colour it is handed.

The thing that makes it cheap is that Minecraft's two layers ARE a wardrobe's
layers: the base is the person and what is against their skin (hair, shirt,
trousers, a beard), the outer is what goes over it (a jacket, a hat, glasses,
a pack). So a hat covers hair by being on the head's overlay, and taking it
off reveals the hair rather than a hole. Nothing needed a third layer, which
is just as well.

Two rules that are easy to get wrong:

- **Order is the order a person dresses in.** `CATEGORIES` is that order —
  tops before outerwear, hair before hats, face last. Anything drawing on the
  outer layer draws after everything on the skin under it.
- **A chosen haircut must REPLACE the built-in one.** `bareHead` paints the
  photograph's hair out first. Without it "Shaved" is not shaved and every
  style in the grid looks identical, because underneath it is.

`js/cloth.js` is what makes a garment look like a garment rather than a
colour swatch, and it is four things, each one line of arithmetic: the WEAVE
(denim streaks, knit grain, leather speckle, a bright band down metal), the
LIGHT (darker at the hem than the shoulder, and a torso curves away at its
sides), the PRINT (stripes and plaid are a second COLOUR, not a shade of the
first, because that is what dye does) and the EDGES (a hem, a cuff, a collar
and a seam are one line of pixels each, and are most of what tells a jumper
from a t-shirt at forty pixels).

Hair gets the same treatment under a different name: vertical strands of two
or three tones, a highlight at the crown, roots a shade darker than the ends.
Without it every dark haircut is the same brown hat.

`js/doll.js` draws the thumbnails, and the head is drawn as a BOX rather than
a square on purpose: a bob and a crew cut have the same front face, and a cap
and a beanie have the same band — what separates them is the sides and the
top. Drawn flat, half the wardrobe is twenty identical brown rectangles,
which is exactly what the first version of that grid looked like.

Two traps in the rack UI, both found the hard way:

- **`fillGrid` runs before the grid is in the document**, so guarding the
  chunked loader with `grid.isConnected` stops it after the first five
  pictures. It is guarded with a token instead — which answers the question
  actually being asked, "is this still the fill that grid wants".
- **Whatever would COVER the thing being chosen comes off first.** A hood is
  outerwear and it sits on the head, so a coat left on turns fifty haircuts
  into fifty identical hoods.

## The body, not just the head

`photoClothes` samples the torso, the arms and the legs out of the photograph
the same way the face is sampled, and lays them OVER the plain clothes drawn
first. Over, not instead of: `sampleRect` reports how much of each rectangle
was actually inside the picture, and anything under four fifths is left alone
— so a head-and-shoulders shot gets a real shirt and invented trousers rather
than a shirt and a grey smear off the bottom edge.

The frame for it is `bodyFrame`, in head-heights, because a head is the only
ruler available. It is a guess, and it is wrong for a child and for a
photograph taken from below, which is why it wants to become a box on screen
like the head's.

## Painting must outlive the generator

Every slider re-runs `generate()` over the whole 64×64. A face somebody spent
five minutes fixing must not be wiped out because they nudged the contrast
afterwards. `S.edits` in `js/app.js` is that promise: a map of every texel
laid by hand, replayed after every rebuild. The painter reports writes
through `onWrite`, and its undo snapshots the map alongside the pixels — undo
that restored the image but not the record would put the paint straight back
on the next slider move.

Anything new that writes to the skin by hand has to go through the painter,
or it will not survive.

## Verifying a change

`window` carries the test hooks. Drive those and read the picture rather than
asking anybody to look:

| hook | what it does |
| --- | --- |
| `__load(url)` | load a photograph and build from it |
| `__state()` | frame, options, palette, how many texels were painted |
| `__render(yaw, pitch, dist)` | draw ONE frame on demand |
| `__fit()` | re-size the canvases — a headless browser fires no animation frames, so the ResizeObserver never runs and the canvas stays 1px wide |
| `__texel(x, y)` | read the image |
| `__size(n)` | change the resolution, or ask what it is |
| `__wear(cat, id)` | put something on, or ask what is on |
| `__render(...)` | draws one frame — and aims his head, exactly as the loop does |
| `__openCat(key)` | open one rack of the wardrobe, or go back to the list |
| `__shot(key, url)` | hand the capture one of its five photographs |
| `__build()` | carve, and say how many cubes survived |
| `__toMc()` | turn the carve into a skin |
| `__cap` | the shots, the volume and the voxel mesh |
| `__paint(x, y, hex)` | lay one texel exactly as a click would |
| `capture(name)` | POST the render to `shots/NAME.png` |
| `captureSkin(name)` | POST the 64×64 itself |
| `__gfx` | the renderer, scene and camera, for a camera the orbit cannot reach |

`python tools/make_test_face.py` draws two portraits with their head box, eye
line and mouth line PRINTED, so a check can compare what the finder said with
where they actually are. They are rulers, not photographs.

- `shots/test-face.png` — the plain one.
- `shots/test-room.png` — **the hard one**: a pale room and a pale top, which
  is the case that caught two versions out. A white wall is nearer to a pale
  forehead than a shadowed cheek is, and a cream shirt reads as skin.

Both should land within four pixels on the box and on the nose for the eye
line, the mouth line and both eye columns. If one of them drifts, that is a
regression however good the render looks.

**Read the texels before believing a screenshot.** A dump of the 8×8 face
settles in one call what a dozen camera angles argue about. And a render
against a colour that is not the page background is the only way to see a
hole in the model.

Serve on a port of your own (`python serve.py --port 8150`) rather than one
somebody is using.

## What is not built

- **No second figure to compare against.** Judging a skin means judging it
  next to another one, and there is nowhere to put a reference.
- **Nothing knows about capes, or Bedrock's extra geometry.** Classic and
  slim, and that is all.
- **The shelf is this browser's only.** `localStorage`, so a skin kept on the
  phone is not on the PC. `skins/` on the server is the shared half, and
  nothing syncs the two.
- **No batch.** One photograph at a time, and somebody selling a set of forty
  would want a folder in and a folder out.
