"""Shared map geometry for WoW Forever: uiMap rects (world yards), continent layout in page pixels, conversions."""
import csv, os
HERE = os.path.dirname(os.path.abspath(__file__)); DB = os.path.join(HERE, "db2")
rd = lambda t: list(csv.DictReader(open(os.path.join(DB, f"f_{t}.csv"), encoding="utf-8")))
uimap = {int(r["ID"]): r for r in rd("UiMap")}
CONT = {1: 1414, 0: 1415}                     # MapID -> continent uiMap
CONT_OFF = {1414: 0, 1415: 1052}              # x offset of each continent image in page pixels
W, H = 1002, 668
rects = {}
for r in rd("UiMapAssignment"):
    if r["UiMin_0"] != "0" or r["MapID"] not in ("0", "1"): continue
    m = int(r["UiMapID"]); f = lambda i: float(r[f"Region_{i}"])
    rects[m] = dict(map=int(r["MapID"]), xmin=f(0), ymin=f(1), xmax=f(3), ymax=f(4), area=int(r["AreaID"]))
CITY_PARENT = {1453: 1429, 1455: 1426, 1458: 1420, 1454: 1411, 1456: 1412, 1457: 1438}
ZONES = [m for m in rects if uimap[m]["Type"] == "3" and m not in (1463, 1464)]
WALK_ZONES = [m for m in ZONES if m not in CITY_PARENT]

def world_to_px(mapid, x, y):
    c = rects[CONT[mapid]]
    u = (c["ymax"] - y) / (c["ymax"] - c["ymin"]); v = (c["xmax"] - x) / (c["xmax"] - c["xmin"])
    return round(u * W + CONT_OFF[CONT[mapid]], 2), round(v * H, 2)
def zone_to_world(m, zx, zy):
    r = rects[m]
    return r["xmax"] - zy / 100 * (r["xmax"] - r["xmin"]), r["ymax"] - zx / 100 * (r["ymax"] - r["ymin"])
def zone_of(mapid, x, y):
    """Zone whose rect holds the point most centrally (rects overlap; this picks the likeliest)."""
    best, bm = 9, None
    for m in WALK_ZONES:
        r = rects[m]
        if r["map"] != mapid: continue
        u = (r["ymax"] - y) / (r["ymax"] - r["ymin"]); v = (r["xmax"] - x) / (r["xmax"] - r["xmin"])
        d = max(abs(u - .5), abs(v - .5))
        if d < best: best, bm = d, m
    return bm if best <= 0.5 else None
def walkzone(m): return CITY_PARENT.get(m, m)
