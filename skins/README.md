# skins/

Where **Save to skins/** puts things, when the little Python server is the one
serving the page.

Two files a skin, and both are the point:

- `name.png` — the 64x64 itself. This is the file Minecraft wants. Upload it,
  send it, sell it.
- `name.json` — every slider that made it, so a skin can be opened again in a
  month and adjusted rather than started over. It does **not** hold the
  photograph: that is yours and it stays wherever you keep it.

`index.json` is rebuilt from whatever PNGs are actually here, every time the
server starts and every time one is saved. It is a listing, not a record —
delete a PNG and it goes away by itself.
