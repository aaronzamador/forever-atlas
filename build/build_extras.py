"""Build site/extras.js: service NPCs (errands), quest hubs (levelling), herb and ore spawns (gathering).
Source: Forever's own QuestieDB store (QuestieDB_Forever.toc) and its areaId->uiMap table, ForeverArtisan's
herb/ore skill tables. Run after build_data.py (reads site/data.js for place names). Exits non-zero on a failed check."""
import os, re, sys, json, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from geo import rects, uimap, CITY_PARENT, world_to_px, zone_to_world, walkzone
import questie_forever as qf
HERE = os.path.dirname(os.path.abspath(__file__)); SITE = os.path.join(HERE, "..", "site")
AO = "/Applications/World of Warcraft/_forever_/Interface/AddOns"
FAIL = []
def check(ok, msg):
    print(("ok   " if ok else "FAIL ") + msg)
    if not ok: FAIL.append(msg)

db = qf.load(); NPC, OBJ, QUEST = db["Npc"], db["Object"], db["Quest"]
src = open(f"{AO}/QuestieDB/support/Forever/Zones/areaIdToUiMapId.lua", encoding="utf-8").read()
area_ui = {}
for block in ("areaIdToUiMapId = [[", "areaIdToUiMapIdOverride = [["):   # override applied last, wins
    body = src.split(block, 1)[1].split("]]", 1)[0]
    for a, u in re.findall(r"\[(\d+)\]\s*=\s*(\d+)", body): area_ui[int(a)] = int(u)
check(len(area_ui) > 900, f"{len(area_ui)} areaId -> uiMap rows")
data = json.loads(open(os.path.join(SITE, "data.js")).read()[len("window.WOWDATA="):-1])

def pts_of(rec):
    """World points for a Questie record: [(uiMap, wx, wy)] for spawns on our two continents."""
    out = []
    for area, rows in qf.spawns_of(rec).items():
        ui = area_ui.get(area)
        if ui not in rects: continue
        for p in rows or []:
            if not p or p[0] is None or p[0] < 0: continue
            wx, wy = zone_to_world(ui, p[0], p[1]); out.append((ui, wx, wy))
    return out
def pt(ui, wx, wy):
    m = rects[ui]["map"]; px, py = world_to_px(m, wx, wy)
    return dict(z=walkzone(ui), m=m, x=round(wx, 1), y=round(wy, 1), px=px, py=py)
def fac(f): return {"A": "A", "H": "H", "AH": "AH"}.get(f or "AH", "AH")

# ---------------- services ----------------
CLASSES = ["Warrior", "Paladin", "Hunter", "Rogue", "Priest", "Shaman", "Mage", "Warlock", "Druid"]
PROFS = ["Alchemy", "Blacksmithing", "Enchanting", "Engineering", "Herbalism", "Leatherworking", "Mining", "Skinning",
         "Tailoring", "Cooking", "First Aid", "Fishing"]
VEND = {"Food & Drink": "vendor:food", "Reagent Vendor": "vendor:reagent", "Reagents": "vendor:reagent", "General Goods": "vendor:general",
        "General Supplies": "vendor:general", "Trade Supplies": "vendor:trade", "Trade Goods": "vendor:trade", "Fishing Supplies": "vendor:fishing",
        "Bowyer": "vendor:ammo", "Gunsmith": "vendor:ammo", "Arrow Merchant": "vendor:ammo", "Bullet Merchant": "vendor:ammo"}
services = []
for nid, n in NPC.items():
    f = n.get("npcFlags") or 0; sub = n.get("subName") or ""
    cats = []
    if f & 128: cats.append("inn")
    if f & 256: cats.append("bank")
    if f & 4096: cats.append("auction")
    if f & 8192: cats.append("stable")
    if f & 16384: cats.append("repair")
    if sub == "Weapon Master": cats.append("weaponmaster")
    m = re.fullmatch(r"(\w+) Trainer", sub)
    if m and m[1] in CLASSES and f & 16: cats.append("trainer:" + m[1])
    PERSON = {"Alchemist": "Alchemy", "Blacksmith": "Blacksmithing", "Enchanter": "Enchanting", "Engineer": "Engineering",
              "Leatherworker": "Leatherworking", "Tailor": "Tailoring", "Herbalist": "Herbalism", "Miner": "Mining",
              "Skinner": "Skinning", "Cook": "Cooking", "Fisherman": "Fishing"}
    m2 = re.fullmatch(r"(?:Journeyman|Expert|Artisan|Master) (\w+)", sub)
    for pr in PROFS:
        if (sub == f"{pr} Trainer" or (m2 and PERSON.get(m2[1]) == pr)) and f & 16: cats.append("prof:" + pr)
    if sub in VEND: cats.append(VEND[sub])
    if not cats: continue
    for ui, wx, wy in pts_of(n)[:1]:   # a service NPC stands in one place; first spawn
        for c in cats: services.append(dict(c=c, n=n.get("name"), s=sub, f=fac(n.get("friendlyToFaction")), id=nid, **pt(ui, wx, wy)))
for oid, o in OBJ.items():
    if o.get("name") == "Mailbox":
        for ui, wx, wy in pts_of(o): services.append(dict(c="mail", n="Mailbox", s="", f="AH", id=-oid, **pt(ui, wx, wy)))
cnt = {}
for s in services: cnt[s["c"]] = cnt.get(s["c"], 0) + 1
print("services:", dict(sorted(cnt.items())))
for c, lo in (("inn", 40), ("bank", 10), ("auction", 3), ("mail", 40), ("repair", 60), ("trainer:Warrior", 8)) + tuple(("prof:" + p, 3) for p in PROFS):
    check(cnt.get(c, 0) >= lo, f"{cnt.get(c,0)} {c} (expect >= {lo})")

# ---------------- quest hubs ----------------
ALLI, HORDE = 1 | 4 | 8 | 64, 2 | 16 | 32 | 128
def race_fac(mask):
    if not mask: return "AH"
    return ("A" if mask & ALLI else "") + ("H" if mask & HORDE else "")
# quest XP at full value: Forever's QuestieDB QuestXP table, {questId] = {level, xp}}
QXP = {int(a): int(x) for a, _, x in re.findall(r"\[(\d+)\]\s*=\s*\{(\d+),\s*(\d+)\}", open(f"{AO}/QuestieDB/support/Forever/QuestXP/xpDB-classic.lua", encoding="utf-8").read())}
check(len(QXP) > 3000, f"{len(QXP)} quests with XP values")
starters = {}   # (kind, id) -> [quest ids]
qinfo = {}
skipped = dict(cls=0, skill=0, lvl=0, item=0, nostart=0)
for qid, q in QUEST.items():
    name = q.get("name") or ""
    if not name or name.startswith(("<", "[", "zz")) or "DEPRECATED" in name.upper() or "UNUSED" in name.upper(): continue
    if q.get("requiredClasses"): skipped["cls"] += 1; continue
    if q.get("requiredSkill"): skipped["skill"] += 1; continue
    lvl = q.get("questLevel") or 0
    if lvl <= 0 or lvl > 60: skipped["lvl"] += 1; continue
    sb = q.get("startedBy") or {}
    if isinstance(sb, list): sb = {i + 1: v for i, v in enumerate(sb) if v}
    got = False
    for kind, ids in sb.items():
        if int(kind) not in (1, 2) or not ids: continue
        for i in ids: starters.setdefault((int(kind), i), []).append(qid); got = True
    if not got: skipped["nostart" if not sb.get(3) else "item"] += 1; continue
    pre = [p for p in (q.get("preQuestSingle") or []) + (q.get("preQuestGroup") or []) if isinstance(p, int)]
    qinfo[qid] = dict(n=name, l=lvl, r=q.get("requiredLevel") or 1, rf=race_fac(q.get("requiredRaces") or 0), xp=QXP.get(qid, 0), pre=pre)
print("quests kept:", len(qinfo), "skipped:", skipped)
spots = []   # (uiWalk, wx, wy, map, qid, fac)
for (kind, i), qids in starters.items():
    rec = NPC.get(i) if kind == 1 else OBJ.get(i)
    if not rec: continue
    nf = fac(rec.get("friendlyToFaction")) if kind == 1 else "AH"
    for ui, wx, wy in pts_of(rec)[:3]:
        for qid in qids:
            if qid not in qinfo: continue
            f = "".join(c for c in "AH" if c in qinfo[qid]["rf"] and c in nf)
            if f: spots.append((walkzone(ui), wx, wy, rects[ui]["map"], qid, f))
# cluster quest givers into hubs: single-link within 120 yd, same zone
R = 120.0
by_zone = {}
for i, s in enumerate(spots): by_zone.setdefault(s[0], []).append(i)
parent = list(range(len(spots)))
def find(i):
    while parent[i] != i: parent[i] = parent[parent[i]]; i = parent[i]
    return i
for z, idx in by_zone.items():
    cell = {}
    for i in idx: cell.setdefault((int(spots[i][1] // R), int(spots[i][2] // R)), []).append(i)
    for (cx, cy), members in cell.items():
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for j in cell.get((cx + dx, cy + dy), []):
                    for i in members:
                        if i < j and math.dist(spots[i][1:3], spots[j][1:3]) <= R: parent[find(i)] = find(j)
groups = {}
for i in range(len(spots)): groups.setdefault(find(i), []).append(i)
named = [p for p in data["places"] if p["kind"] in ("town", "poi", "flight")]
hubs = []
for g in groups.values():
    qs = {}
    for i in g:
        z, wx, wy, m, qid, f = spots[i]
        qs.setdefault(qid, set()).update(f)
    if len(qs) < 2: continue   # a lone quest giver is not a hub
    wx = sum(spots[i][1] for i in g) / len(g); wy = sum(spots[i][2] for i in g) / len(g); z = spots[g[0]][0]; m = spots[g[0]][3]
    near = min((p for p in named if p["map"] == m), key=lambda p: math.hypot(p["wx"] - wx, p["wy"] - wy))
    d = math.hypot(near["wx"] - wx, near["wy"] - wy)
    zn = uimap[z]["Name_lang"]
    if d < 350: name = near["name"]
    else:
        r = rects[z]; name = f"{zn} ({round((r['ymax'] - wy) / (r['ymax'] - r['ymin']) * 100)}, {round((r['xmax'] - wx) / (r['xmax'] - r['xmin']) * 100)})"
    px, py = world_to_px(m, wx, wy)
    hubs.append(dict(n=name, z=z, m=m, x=round(wx, 1), y=round(wy, 1), px=px, py=py,
                     q=sorted([[qid, qinfo[qid]["n"], qinfo[qid]["l"], qinfo[qid]["r"], "".join(sorted(f)), qinfo[qid]["xp"], qinfo[qid]["pre"]] for qid, f in qs.items()], key=lambda r: (r[2], r[1]))))
hubs.sort(key=lambda h: -len(h["q"]))
print("hubs:", len(hubs), "largest:", [(h["n"], len(h["q"])) for h in hubs[:6]])
check(len(hubs) > 150, f"{len(hubs)} quest hubs")
# Forever's new quests (ids >= 10000) are not in the classic XP table. Quest XP is set mainly by quest level, so each
# gets the median XP of known quests at its level, flagged estimated ([7] = 1). Quests below 10000 with no XP are
# holiday, repeatable or turn-in quests: XP 0, so the levelling plan skips them.
by_lvl = {}
for qid, qi in qinfo.items():
    if qi["xp"] > 0: by_lvl.setdefault(qi["l"], []).append(qi["xp"])
med = {l: sorted(v)[len(v) // 2] for l, v in by_lvl.items()}
est_n = 0
for h in hubs:
    for q in h["q"]:
        q.append(0)
        if q[5] == 0 and q[0] >= 10000 and q[2] in med: q[5] = med[q[2]]; q[7] = 1; est_n += 1
newq = [q for h in hubs for q in h["q"] if q[0] >= 10000]
check(all(q[5] > 0 for q in newq), f"every Forever-new hub quest has an XP value ({est_n} estimated from quest level)")
check(sum(1 for h in hubs for q in h["q"] if q[5] > 0 and not q[7]) > 2000, "over 2000 hub quests carry a measured XP value")
for want in ("Goldshire", "Razor Hill", "Lakeshire", "Gadgetzan"):
    check(any(h["n"].startswith(want) for h in hubs), f"hub named {want} found")

# ---------------- gathering ----------------
def lua_rows(path, var):
    s = open(path, encoding="utf-8").read().split(var + " = {", 1)[1].split("\n}", 1)[0]
    return [(int(a), b, int(c)) for a, b, c in re.findall(r'\{\s*(\d+),\s*"([^"]+)",\s*(\d+)\s*\}', s)]
herbs = lua_rows(f"{AO}/ForeverArtisan_Herbalism/Herbs.lua", "ns.HERBS")
ores = lua_rows(f"{AO}/ForeverArtisan_Mining/Nodes.lua", "ns.NODES")
check(len(herbs) >= 25 and len(ores) >= 12, f"{len(herbs)} herbs, {len(ores)} ore nodes in ForeverArtisan tables")
obj_by_name = {}
for oid, o in OBJ.items():
    n = (o.get("name") or "").replace("Ooze Covered ", "")
    obj_by_name.setdefault(n, []).append(o)
gather = []
for kind, rows in (("herb", herbs), ("ore", ores)):
    for _, name, skill in rows:
        pts = []
        seen = set()
        for o in obj_by_name.get(name, []):
            for ui, wx, wy in pts_of(o):
                k = (ui, round(wx / 5), round(wy / 5))
                if k in seen: continue
                seen.add(k); P = pt(ui, wx, wy); pts.append([P["px"], P["py"], P["z"], P["x"], P["y"]])
        gather.append(dict(k=kind, n=name, s=skill, pts=pts))
print("gathering:", [(g["n"], len(g["pts"])) for g in gather])
check(sum(1 for g in gather if len(g["pts"]) >= 20) >= 30, "at least 30 herb/ore types with >= 20 spawn points")

# ---------------- dungeons ----------------
# Forever's own dungeon table (entrances in Forever's coordinates) and the quests Questie files under each dungeon.
dsrc = open(f"{AO}/QuestieDB/support/Forever/Zones/dungeons.lua", encoding="utf-8").read()
dungeons = []
# entrance corrections Questie applies after the table ("dungeons[X][4] = {...}"): Forever placements, they win
fixes = {int(a): body for a, body in re.findall(r'^dungeons\[(\d+)\]\[4\]\s*=\s*\{((?:\s*\{[^}]*\},?)*)\s*\}', dsrc, re.M)}
# only instances this client has: Forever's own Map table (InstanceType 1 dungeon, 2 raid)
import csv as _csv
forever_maps = {r["MapName_lang"] for r in _csv.DictReader(open(os.path.join(HERE, "db2", "f_Map.csv"), encoding="utf-8")) if r["InstanceType"] in ("1", "2")}
MAP_ALIAS = {"The Deadmines": "Deadmines", "The Stockade": "Stormwind Stockade", "The Temple of Atal'Hakkar": "Sunken Temple",
             "Temple of Ahn'Qiraj": "Ahn'Qiraj Temple", "The Burning of Andorhal": "Burning of Andorhal"}
seen_rows = 0
for area, name, alts, parent, locs in re.findall(r'^\s*\[(\d+)\]\s*=\s*\{"([^"]+)",\s*(\{[^}]*\}|nil),\s*(\d+),\s*\{((?:\s*\{[^}]*\},?)*)\s*\}\s*\}', dsrc, re.M):
    seen_rows += 1
    if MAP_ALIAS.get(name, name) not in forever_maps: continue
    locs = fixes.get(int(area), locs)
    areas = {int(area)} | {int(x) for x in re.findall(r"\d+", alts)}
    ents = []
    for a2, x, y in re.findall(r"\{(\d+),\s*([\d.]+),\s*([\d.]+)\}", locs):
        ui = area_ui.get(int(a2))
        if ui in rects:
            wx, wy = zone_to_world(ui, float(x), float(y)); ents.append(pt(ui, wx, wy))
    if not ents: continue
    qs = []
    for qid, q in QUEST.items():
        if q.get("zoneOrSort") not in areas or not q.get("name"): continue
        if q.get("requiredClasses"): continue
        sb = q.get("startedBy") or {}
        if isinstance(sb, list): sb = {i + 1: v for i, v in enumerate(sb) if v}
        givers = []
        for kind in (1, 2):
            for i in sb.get(kind) or []:
                rec = NPC.get(i) if kind == 1 else OBJ.get(i)
                if not rec: continue
                for ui, wx, wy in pts_of(rec)[:1]:
                    givers.append(dict(n=rec.get("name"), f=fac(rec.get("friendlyToFaction")) if kind == 1 else "AH", **pt(ui, wx, wy)))
        rf = race_fac(q.get("requiredRaces") or 0)
        f = "".join(c for c in "AH" if c in rf and (not givers or any(c in g["f"] for g in givers)))
        if not f: continue
        pre = [p for p in (q.get("preQuestSingle") or []) + (q.get("preQuestGroup") or []) if p in QUEST]
        qs.append(dict(id=qid, n=q["name"], l=q.get("questLevel") or 0, r=q.get("requiredLevel") or 1, f=f, g=givers[:1],
                       item=bool(not givers and sb.get(3)), pre=[[p, QUEST[p].get("name")] for p in pre]))
    lv = sorted(x["l"] for x in qs if x["l"] > 0)
    dungeons.append(dict(n=name, area=int(area), e=ents, q=sorted(qs, key=lambda x: (x["l"], x["n"])), lo=lv[0] if lv else None, hi=lv[-1] if lv else None))
# one entry per dungeon name: Questie splits some (Dire Maul wings, old and new Scholomance) across area ids
merged = {}
for d in dungeons:
    m = merged.setdefault(d["n"], dict(n=d["n"], area=d["area"], e=[], q=[], lo=None, hi=None))
    for e in d["e"]:
        if all(math.hypot(e["x"] - o["x"], e["y"] - o["y"]) > 30 for o in m["e"]): m["e"].append(e)
    have = {q["id"] for q in m["q"]}; m["q"] += [q for q in d["q"] if q["id"] not in have]
for m in merged.values():
    m["q"].sort(key=lambda x: (x["l"], x["n"])); lv = [x["l"] for x in m["q"] if x["l"] > 0]
    m["lo"], m["hi"] = (min(lv), max(lv)) if lv else (None, None)
dungeons = list(merged.values())
check(seen_rows >= 80, f"parsed {seen_rows} rows of Questie's dungeon table (the whole table, all expansions)")
dungeons.sort(key=lambda d: (d["lo"] or 99, d["n"]))
print("dungeons:", [(d["n"], len(d["q"])) for d in dungeons])
check(len(dungeons) >= 25, f"{len(dungeons)} dungeons with an entrance on our two continents")
for must in ("Stratholme", "Blackrock Spire", "Molten Core", "Dire Maul", "Scholomance", "Onyxia's Lair"):
    check(any(d["n"] == must for d in dungeons), f"{must} present")
check(not any(d["n"] in ("Dragon Soul", "Firelands", "End Time", "Karazhan") for d in dungeons), "no instance this client lacks")
check(sum(1 for d in dungeons if d["n"] == "Dire Maul") == 1, "Dire Maul merged into one entry")
strat = next((d for d in dungeons if d["n"] == "Stratholme"), None)
check(strat is not None and len(strat["q"]) >= 5, f"Stratholme has its quests ({len(strat['q']) if strat else 0})")
dm = next((d for d in dungeons if d["n"] == "The Deadmines"), None)
check(dm is not None and any(q["n"] == "Red Silk Bandanas" for q in dm["q"]), "The Deadmines lists Red Silk Bandanas")
check(sum(len(d["q"]) for d in dungeons) > 150, f"{sum(len(d['q']) for d in dungeons)} dungeon quests")

out = dict(services=services, hubs=hubs, gather=gather, dungeons=dungeons)
open(os.path.join(SITE, "extras.js"), "w").write("window.WOWEXTRAS=" + json.dumps(out, separators=(",", ":"), ensure_ascii=False) + ";")
print("extras.js", os.path.getsize(os.path.join(SITE, "extras.js")) // 1024, "KB")
if FAIL: sys.exit("FAILED: " + "; ".join(FAIL))
