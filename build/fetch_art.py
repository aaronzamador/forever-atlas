"""Download Forever (wowf) world-map tiles from wago.tools and compose one PNG per uiMap.
Cached: tiles land in build/tiles/<fdid>.blp and are not re-fetched."""
import csv, os, sys, urllib.request, concurrent.futures as cf
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(HERE, "db2"); TILES = os.path.join(HERE, "tiles"); OUT = os.path.join(HERE, "..", "site", "img")
os.makedirs(TILES, exist_ok=True); os.makedirs(OUT, exist_ok=True)
rd = lambda t: list(csv.DictReader(open(os.path.join(DB, f"f_{t}.csv"), encoding="utf-8")))
uimap = {r["ID"]: r for r in rd("UiMap")}
assign = {r["UiMapID"]: r for r in rd("UiMapAssignment") if r["UiMin_0"] == "0" and r["MapID"] in ("0", "1")}
xart = {r["UiMapID"]: r["UiMapArtID"] for r in rd("UiMapXMapArt") if r["PhaseID"] == "0"}
tiles = {}
for r in rd("UiMapArtTile"):
    if r["LayerIndex"] == "0":
        tiles.setdefault(r["UiMapArtID"], []).append((int(r["RowIndex"]), int(r["ColIndex"]), r["FileDataID"]))
want = [m for m in assign if m in xart and uimap[m]["Type"] in ("2", "3")]
def get(fd):
    p = os.path.join(TILES, fd + ".blp")
    if os.path.exists(p) and os.path.getsize(p) > 100: return p
    req = urllib.request.Request(f"https://wago.tools/api/casc/{fd}?download&product=wowf", headers={"User-Agent": "Mozilla/5.0"})
    data = urllib.request.urlopen(req, timeout=60).read()
    if data[:4] != b"BLP2": raise RuntimeError(f"{fd}: not a BLP ({data[:40]!r})")
    open(p, "wb").write(data); return p
jobs = sorted({fd for m in want for (_, _, fd) in tiles[xart[m]]})
print(len(want), "maps,", len(jobs), "tiles")
with cf.ThreadPoolExecutor(6) as ex:
    for fd, res in zip(jobs, ex.map(lambda f: (get(f), None)[1], jobs)): pass
for m in want:
    ts = tiles[xart[m]]
    img = Image.new("RGB", (1024, 768))
    for (r, c, fd) in ts:
        t = Image.open(os.path.join(TILES, fd + ".blp")).convert("RGB")
        img.paste(t, (c * 256, r * 256))
    img = img.crop((0, 0, 1002, 668))
    scale = 2 if uimap[m]["Type"] == "2" else 1
    img.save(os.path.join(OUT, f"{m}.jpg"), quality=86)
print("wrote", len(want))
