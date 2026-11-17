"""Build site/data.js: zones, places, flight graph, transports, zone crossings for WoW Forever.
Sources: wago.tools DB2 exports for product wowf (build/db2), Leatrix_Maps icons (Anniversary install,
read-only) for dungeons / boats / zeppelins / tram / zone crossings, Leatrix_Plus recorded flight
seconds for calibrating flight speed. Ends with checks that exit non-zero on failure."""
import csv, os, re, json, math, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
HERE = os.path.dirname(os.path.abspath(__file__)); DB = os.path.join(HERE, "db2")
LEA = "/Applications/World of Warcraft/_anniversary_/Interface/AddOns"
rd = lambda t: list(csv.DictReader(open(os.path.join(DB, f"f_{t}.csv"), encoding="utf-8")))
FAIL = []
def check(ok, msg):
    print(("ok   " if ok else "FAIL ") + msg)
    if not ok: FAIL.append(msg)

from geo import uimap, CONT, CONT_OFF, W, H, rects, CITY_PARENT, ZONES, WALK_ZONES, world_to_px, zone_to_world, zone_of, walkzone

places = []
def add(**k):
    k["id"] = len(places); px, py = world_to_px(k["map"], k["wx"], k["wy"]); k["px"], k["py"] = px, py
    places.append(k); return k["id"]

# ---- flight points (Forever's own TaxiNodes / TaxiPath / TaxiPathNode) ----
tn = {int(r["ID"]): r for r in rd("TaxiNodes")}
paths = [(int(r["ID"]), int(r["FromTaxiNode"]), int(r["ToTaxiNode"])) for r in rd("TaxiPath")]
SKIP = ("Transport", "Generic", "Quest Path", "zzOLD", "Programmer")
def usable(i):
    r = tn.get(i)
    # a flight point exists for a faction only if a flight master mount is set for it (MountCreatureID_0 Horde,
    # _1 Alliance). A node with neither is a leftover path end, never a flight point: no default faction.
    return (r and r["ContinentID"] in ("0", "1") and not r["Name_lang"].startswith(SKIP)
            and (r["MountCreatureID_0"] != "0" or r["MountCreatureID_1"] != "0"))
taxi = {}
zone_by_name = {uimap[m]["Name_lang"].lower(): m for m in ZONES}
for i in sorted({a for _, a, b in paths if usable(a) and usable(b)} | {b for _, a, b in paths if usable(a) and usable(b)}):
    r = tn[i]; mp = int(r["ContinentID"]); x, y = float(r["Pos_0"]), float(r["Pos_1"])
    nm = r["Name_lang"]; town, _, zname = nm.partition(", ")
    z = None
    if zname:
        z = next((m for n, m in zone_by_name.items() if n.startswith(zname.lower()) and rects[m]["map"] == mp), None)
    z = walkzone(z) if z else zone_of(mp, x, y)
    fac = ("A" if r["MountCreatureID_1"] != "0" else "") + ("H" if r["MountCreatureID_0"] != "0" else "")
    taxi[i] = add(kind="flight", name=town if zname else nm, label=nm, map=mp, wx=x, wy=y, zone=z, fac=fac, taxi=i)
pn = {}
_pn_rows = {}
def rd_pathnodes(pid): return _pn_rows.get(pid, [])
for r in rd("TaxiPathNode"):
    _pn_rows.setdefault(int(r["PathID"]), []).append(r)
    pn.setdefault(int(r["PathID"]), []).append((int(r["NodeIndex"]), float(r["Loc_0"]), float(r["Loc_1"]), float(r["Loc_2"]), r["ContinentID"]))
flights = []
for pid, a, b in paths:
    if a not in taxi or b not in taxi: continue
    pts = sorted(pn.get(pid, []))
    L = sum(math.dist(p[1:4], q[1:4]) for p, q in zip(pts, pts[1:]) if p[4] == q[4])
    if L <= 0: L = math.dist((places[taxi[a]]["wx"], places[taxi[a]]["wy"]), (places[taxi[b]]["wx"], places[taxi[b]]["wy"])) * 1.2
    mp = int(tn[a]["ContinentID"])
    line = [world_to_px(mp, p[1], p[2]) for k, p in enumerate(pts) if p[4] == str(mp) and (k % 3 == 0 or k == len(pts) - 1)]
    flights.append(dict(a=taxi[a], b=taxi[b], len=round(L), pts=[[round(x, 1), round(y, 1)] for x, y in line]))

# ---- calibrate flight speed against Leatrix's recorded seconds (direct legs only) ----
rec = []
for fac in ("Alliance", "Horde"):
    src = open(f"{LEA}/Leatrix_Plus/Leatrix_Plus_Flight_{fac}.lua", encoding="utf-8-sig", errors="replace").read()
    cont = None
    for line in src.splitlines():
        m = re.match(r'\s*\[(\d+)\]\s*=\s*\{', line)
        if m: cont = int(m[1]); continue
        m = re.match(r'\s*\["([\d.:]+)"\]\s*=\s*(\d+),\s*--\s*(.*)$', line)
        if m and cont in (1414, 1415):
            p = m[1].split(":")
            if len(p) >= 4: rec.append((cont, [n.strip() for n in m[3].split(", ")], int(m[2])))
# Leatrix's continent fractions are TBC's continent rects (they include Quel'Thalas / Azuremyst), so match by name.
ALIAS = {"stormwind": "stormwind", "ironforge": "ironforge"}
def near(cont, name):
    hits = [pid for pid in taxi.values() if CONT[places[pid]["map"]] == cont and places[pid]["name"].lower().startswith(name.lower()[:10])]
    return hits
fl = {(f["a"], f["b"]): f for f in flights}
# Flight-time model, fitted to every recorded flight whose legs all exist in Forever:
#   seconds = total path length / speed + base + perStop * (legs - 1)
# A chained flight does not land at the stops in between, so a stop costs far less than a fresh take-off.
# The page reads these numbers from data.js; nothing restates them.
import numpy as np
rows = []
for cont, names, s in rec:
    lens = []
    for x, y in zip(names, names[1:]):
        fs = [fl[(a, b)] for a in near(cont, x) for b in near(cont, y) if (a, b) in fl]
        if len(fs) != 1: lens = None; break
        lens.append(fs[0]["len"])
    if lens and s > 15: rows.append((lens, s))
def fit(sample):
    X = np.array([[sum(l), 1.0, len(l) - 1.0] for l, _ in sample]); y = np.array([s for _, s in sample], float)
    c = np.linalg.lstsq(X, y, rcond=None)[0]
    return dict(speed=1 / c[0], base=c[1], perStop=c[2])
def predict(m, lens): return sum(lens) / m["speed"] + m["base"] + m["perStop"] * (len(lens) - 1)
def med_abs_err(m, sample):
    e = sorted(abs(predict(m, l) - s) / s for l, s in sample); return e[len(e) // 2], e[len(e) * 9 // 10]
# held-out: fit on one half, score the other half (each way), so the score is not the fit grading itself
half_a, half_b = rows[0::2], rows[1::2]
ho = [med_abs_err(fit(half_a), half_b), med_abs_err(fit(half_b), half_a)]
FLIGHT = fit(rows)
print(f"flight model: {FLIGHT['speed']:.1f} yd/s + {FLIGHT['base']:.1f}s + {FLIGHT['perStop']:.1f}s per extra stop, from {len(rows)} recorded flights "
      f"({sum(len(l) == 1 for l, _ in rows)} direct)")
print(f"held-out median |error| {ho[0][0]*100:.1f}% / {ho[1][0]*100:.1f}%, 90th pct {ho[0][1]*100:.1f}% / {ho[1][1]*100:.1f}%")
for name, sub in (("direct", [r for r in rows if len(r[0]) == 1]), ("multi-stop", [r for r in rows if len(r[0]) > 1])):
    print(f"  {name}: median |error| {med_abs_err(FLIGHT, sub)[0]*100:.1f}% (n={len(sub)})")
check(len(rows) >= 300, f"{len(rows)} recorded flights matched to Forever legs (need >= 300)")
check(max(h[0] for h in ho) < 0.09, "held-out flight times within 9% median error")
check(25 < FLIGHT["speed"] < 45 and 0 <= FLIGHT["base"] < 60 and -5 < FLIGHT["perStop"] < 30, "flight model parameters physically plausible")

# ---- Leatrix_Maps icons: dungeons, transports, crossings ----
src = open(f"{LEA}/Leatrix_Maps/Leatrix_Maps_Icons.lua", encoding="utf-8-sig", errors="replace").read()
def lstr(e):
    return "".join(re.findall(r'L\["([^"]*)"\]|"([^"]*)"', e) and [a or b for a, b in re.findall(r'L\["([^"]*)"\]|"([^"]*)"', e)])
def split_args(s):
    out, d, cur, q = [], 0, "", False
    for ch in s:
        if ch == '"': q = not q
        if not q and ch in "([{": d += 1
        if not q and ch in ")]}": d -= 1
        if ch == "," and d == 0 and not q: out.append(cur.strip()); cur = ""
        else: cur += ch
    if cur.strip(): out.append(cur.strip())
    return out
icons = []; zone = None
for line in src.splitlines():
    m = re.match(r'\s*--\[\[.*?\]\]\s*\[(\d+)\]\s*=\s*\{', line)
    if m: zone = int(m[1]); continue
    m = re.match(r'\s*\{("(\w+)",.*?)\},?\s*(--.*)?$', line)
    if m and zone in rects:
        a = split_args(m[1])
        icons.append(dict(kind=a[0].strip('"'), zx=float(a[1]), zy=float(a[2]), name=lstr(a[3]),
                          desc=lstr(a[4]) if len(a) > 4 and a[4] != "nil" else "", target=int(a[12]) if len(a) > 12 and a[12].isdigit() else None, zone=zone))
check(len(icons) > 300, f"parsed {len(icons)} Leatrix icons")
# geometry check: Leatrix flight icons vs Forever TaxiNodes, same zone rects assumed
errs = []
for ic in icons:
    if ic["kind"] in ("FlightA", "FlightH", "FlightN"):
        wx, wy = zone_to_world(ic["zone"], ic["zx"], ic["zy"]); mp = rects[ic["zone"]]["map"]
        d = min((math.dist((wx, wy), (places[p]["wx"], places[p]["wy"])) for p in taxi.values() if places[p]["map"] == mp), default=1e9)
        errs.append(d)
errs.sort()
print(f"Leatrix flight icon vs Forever TaxiNode: median {errs[len(errs)//2]:.0f} yd, 90th pct {errs[len(errs)*9//10]:.0f} yd, n={len(errs)}")
check(errs[len(errs) // 2] < 40, "zone rects place Leatrix icons on Forever's flight masters (median < 40 yd)")

for ic in icons:
    k = ic["kind"]; mp = rects[ic["zone"]]["map"]; wx, wy = zone_to_world(ic["zone"], ic["zx"], ic["zy"])
    if k in ("Dungeon", "Raid", "Dunraid"):
        ic["pid"] = add(kind="dungeon" if k == "Dungeon" else "raid", name=ic["name"], label=ic["name"], map=mp, wx=wx, wy=wy, zone=walkzone(ic["zone"]), fac="AH")
# ---- boats and zeppelins: Forever's own transport loops (TaxiPath + TaxiPathNode) ----
# Which loops still run, their mode and faction: method.gg "All Travel Routes in WoW Forever" (fetched 2026-11-17).
# Leatrix's list is the Anniversary one and misses Forever's new boats. A stop is a path node with Delay > 0.
# Paths 11398/11457 go to Zephras Isle (map 2991, off our two continents) and are left out; path 295 (classic
# Menethil-Auberdine) is superseded in Forever by the Auberdine -> Menethil -> Southshore loop (11167).
ROUTES = {
    241: ("boat", "AH", "Booty Bay - Ratchet boat"), 292: ("boat", "A", "Menethil - Theramore boat"),
    293: ("boat", "A", "Auberdine - Rut'theran boat"), 303: ("boat", "A", "Feathermoon ferry"),
    11167: ("boat", "A", "Auberdine - Menethil - Southshore boat"), 11391: ("boat", "AH", "Steamwheedle Port - Powderfuse Port boat"),
    11616: ("boat", "A", "Stormwind Harbour - Auberdine boat"),
    285: ("zeppelin", "H", "Orgrimmar - Grom'gol zeppelin"), 301: ("zeppelin", "H", "Undercity - Grom'gol zeppelin"),
    302: ("zeppelin", "H", "Orgrimmar - Undercity zeppelin"),
}
# Departure cycles measured by players: warcraft.wiki.gg "Travel guide to zeppelins and boats" (fetched 2026-11-17).
MEASURED_CYCLE = {302: 239, 301: 315}
# Elsewhere the cycle is estimated: moving time at TRANSPORT_SPEED (30 yd/s, the server value emulators use; it is
# NOT in client data) + the dock delays + LOAD_S per teleport. A segment is a teleport when it changes continent, its
# start node has Flags & 1, or it jumps more than 1500 yd. At 30 yd/s path 301 predicts 301 s against a measured 315 s;
# path 302 predicts 329 s against a measured 239 s, so estimated cycles are flagged in the page.
TRANSPORT_SPEED, LOAD_S, JUMP = 30.0, 10.0, 1500.0
def loop_of(pid):
    rows = sorted(_pn_rows.get(pid, []), key=lambda r: int(r["NodeIndex"]))
    seg = []
    for k, r in enumerate(rows):
        p = rows[k - 1]   # k == 0 takes the last node: the path is a loop
        same = p["ContinentID"] == r["ContinentID"]
        d = math.dist((float(p["Loc_0"]), float(p["Loc_1"])), (float(r["Loc_0"]), float(r["Loc_1"]))) if same else 0.0
        tele = (not same) or (int(p["Flags"]) & 1) or d > JUMP
        seg.append(dict(map=int(r["ContinentID"]), x=float(r["Loc_0"]), y=float(r["Loc_1"]), delay=int(r["Delay"]),
                        move=0.0 if tele else d / TRANSPORT_SPEED, load=LOAD_S if tele else 0.0))
    return seg
transports = []   # directed legs: a -> b, t seconds (average wait + ride), mode, fac, est
for pid, (mode, fac, title) in ROUTES.items():
    seg = loop_of(pid)
    check(len(seg) > 4, f"transport path {pid} ({title}) present in Forever data")
    if len(seg) <= 4: continue
    stops = [k for k, s in enumerate(seg) if s["delay"] > 0]
    est_cycle = sum(s["move"] + s["load"] + s["delay"] for s in seg)
    cycle = MEASURED_CYCLE.get(pid, est_cycle)
    scale = (cycle - sum(s["delay"] for s in seg)) / (est_cycle - sum(s["delay"] for s in seg))   # spread a measured cycle over the path
    docks = {}
    for k in stops:
        s = seg[k]
        if s["map"] not in (0, 1): continue
        near = min((p for p in places if p["map"] == s["map"] and p["kind"] in ("town", "poi", "flight", "dock")), key=lambda p: math.hypot(p["wx"] - s["x"], p["wy"] - s["y"]))
        # (near only checks that a stop sits on land we know; the dock is named after its route and zone)
        same = next((d for kk, d in docks.items() if math.hypot(seg[kk]["x"] - s["x"], seg[kk]["y"] - s["y"]) < 40), None)
        if same is not None: docks[k] = same; continue   # one pier the loop visits twice (Feathermoon): one dock
        docks[k] = add(kind="dock", name=f"{title} ({uimap[zone_of(s['map'], s['x'], s['y'])]['Name_lang']} side)", label=f"{mode.title()} dock: {title}",
                       map=s["map"], wx=s["x"], wy=s["y"], zone=zone_of(s["map"], s["x"], s["y"]), fac=fac, mode=mode, route=title)
    best = {}
    for a in docks:
        for b in docks:
            if docks[a] == docks[b]: continue
            t, k = 0.0, a
            while k != b:   # forward round the loop, so a one-way loop is priced the way it really runs
                k = (k + 1) % len(seg); t += (seg[k]["move"] + seg[k]["load"]) * scale + (seg[k]["delay"] if k != b else 0)
            key = (docks[a], docks[b]); best[key] = min(best.get(key, 1e9), t)
    for (da, db), t in best.items():
        transports.append(dict(a=da, b=db, mode=mode, fac=fac, t=round(cycle / 2 + t), cycle=round(cycle), est=pid not in MEASURED_CYCLE, route=title))
# Deeprun Tram: an animated transport, not a path; Leatrix's two tram icons give the platforms
trams = [ic for ic in icons if ic["kind"] == "TravelA" and ic["name"].startswith("Tram to")]
check(len(trams) == 2, "both Deeprun Tram platforms found in Leatrix")
tram_docks = [add(kind="dock", name=t["name"], label="Deeprun Tram", map=0, wx=zone_to_world(t["zone"], t["zx"], t["zy"])[0], wy=zone_to_world(t["zone"], t["zx"], t["zy"])[1],
                  zone=walkzone(t["zone"]), fac="AH", mode="tram", route="Deeprun Tram") for t in trams]
TRAM_T = 100   # estimate: ride plus average wait; the tram is not in path data
transports += [dict(a=tram_docks[0], b=tram_docks[1], mode="tram", fac="AH", t=TRAM_T, est=True, route="Deeprun Tram"),
               dict(a=tram_docks[1], b=tram_docks[0], mode="tram", fac="AH", t=TRAM_T, est=True, route="Deeprun Tram")]
for t in transports:
    print(f'  {t["route"][:42]:42} {places[t["a"]]["name"][-28:]:28} -> {places[t["b"]]["name"][-28:]:28} {t["t"]:4}s{" est" if t["est"] else ""}')
check(len(transports) >= 20, f"{len(transports)} directed transport legs (expect >= 20)")
check(all(30 < t["t"] < 900 for t in transports), "every transport leg between 30 s and 15 minutes")
check(all(places[p]["fac"] in ("A", "H", "AH") for p in taxi.values()), "every flight point has a faction from a real flight-master mount")
check(not any(places[p]["label"].startswith("Southshore Ferry") for p in taxi.values()), "the mountless Southshore Ferry path end is not a flight point")

# zone crossings: an arrow in zone A pointing to zone B; the node belongs to both
crossings = 0
for ic in icons:
    if ic["kind"] != "Arrow" or ic["target"] not in rects: continue
    za, zb = walkzone(ic["zone"]), walkzone(ic["target"])
    if za == zb or zb not in WALK_ZONES or za not in WALK_ZONES: continue
    mp = rects[ic["zone"]]["map"]; wx, wy = zone_to_world(ic["zone"], ic["zx"], ic["zy"])
    add(kind="crossing", name=f'{uimap[za]["Name_lang"]} → {uimap[zb]["Name_lang"]}', label=ic["desc"] or "zone border", map=mp, wx=wx, wy=wy, zone=za, zone2=zb, fac="AH")
    crossings += 1
# Forever's new zones have no Leatrix arrows: connect them to neighbours at the middle of the rect overlap (approximate)
covered = {ic["zone"] for ic in icons if ic["kind"] == "Arrow"}
for nz in [m for m in WALK_ZONES if m not in covered and m not in CITY_PARENT]:
    r = rects[nz]
    for m in WALK_ZONES:
        if m == nz or rects[m]["map"] != r["map"]: continue
        s = rects[m]
        x0, x1 = max(r["xmin"], s["xmin"]), min(r["xmax"], s["xmax"]); y0, y1 = max(r["ymin"], s["ymin"]), min(r["ymax"], s["ymax"])
        if x1 - x0 < 300 or y1 - y0 < 300: continue
        add(kind="crossing", name=f'{uimap[nz]["Name_lang"]} ↔ {uimap[m]["Name_lang"]}', label="approximate border (new zone, no recorded path)", map=r["map"],
            wx=(x0 + x1) / 2, wy=(y0 + y1) / 2, zone=nz, zone2=m, fac="AH", approx=True)
        crossings += 1
print("crossings:", crossings, "new zones without recorded arrows:", [uimap[m]["Name_lang"] for m in WALK_ZONES if m not in covered])

# ---- towns from AreaPOI (Forever's own) ----
area = {int(r["ID"]): r for r in rd("AreaTable")}
area_to_ui = {v["area"]: k for k, v in rects.items() if v["area"]}
def ui_of_area(a):
    seen = 0
    while a and seen < 8:
        if a in area_to_ui: return area_to_ui[a]
        a = int(area[a]["ParentAreaID"]) if a in area else 0; seen += 1
    return None
names_taken = {(p["name"].lower(), p["map"]) for p in places}
for r in rd("AreaPOI"):
    if r["ContinentID"] not in ("0", "1") or not r["Name_lang"].strip() or r["Importance"] in ("0",) and r["Icon"] not in ("4", "5", "6"): continue
    mp = int(r["ContinentID"]); x, y = float(r["Pos_0"]), float(r["Pos_1"])
    z = ui_of_area(int(r["AreaID"])); z = walkzone(z) if z in rects else zone_of(mp, x, y)
    if not z or (r["Name_lang"].lower(), mp) in names_taken or r["Name_lang"] in ("Under Attack",): continue
    names_taken.add((r["Name_lang"].lower(), mp))
    add(kind="town" if r["Importance"] in ("2", "3", "4") else "poi", name=r["Name_lang"], label=r["Name_lang"], map=mp, wx=x, wy=y, zone=z, fac="AH")

zones = {m: dict(name=uimap[m]["Name_lang"], map=rects[m]["map"], city=m in CITY_PARENT,
                 new=m in (2482, 2548, 2652),
                 box=[*world_to_px(rects[m]["map"], rects[m]["xmax"], rects[m]["ymax"]), *world_to_px(rects[m]["map"], rects[m]["xmin"], rects[m]["ymin"])],
                 yds=[rects[m]["xmax"] - rects[m]["xmin"], rects[m]["ymax"] - rects[m]["ymin"]])
         for m in ZONES}
conts = {c: dict(name=uimap[c]["Name_lang"], map=rects[c]["map"], off=CONT_OFF[c], rect=[rects[c][k] for k in ("xmin", "ymin", "xmax", "ymax")]) for c in CONT_OFF}
check(all(p["zone"] in rects for p in places), "every place has a zone")
check(len([p for p in places if p["kind"] == "flight"]) >= 70, f'{len([p for p in places if p["kind"]=="flight"])} flight points')
counts = {}
for p in places: counts[p["kind"]] = counts.get(p["kind"], 0) + 1
print("places:", counts, "flight legs:", len(flights))
for p in places: p["wx"], p["wy"] = round(p["wx"], 1), round(p["wy"], 1)
out = dict(built="wowf " + "1.60.1", flight={k: round(float(v), 2) for k, v in FLIGHT.items()}, flightN=len(rows), zones=zones, conts=conts, places=places, flights=flights, transports=transports, cityParent=CITY_PARENT)
open(os.path.join(HERE, "..", "site", "data.js"), "w").write("window.WOWDATA=" + json.dumps(out, separators=(",", ":"), ensure_ascii=False) + ";")
if FAIL: sys.exit("FAILED: " + "; ".join(FAIL))
