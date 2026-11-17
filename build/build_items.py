"""Build site/items.js for the Find tab: every item with a known source, and where each source is.
Sources: Forever's QuestieDB (vendors, mob drops, objects such as chests and herb/ore nodes, quest rewards,
containers) and its wowhead drop rates for quest items; AtlasLootClassic's drop rates; ForeverArtisan's recipes
recorded on the Forever beta (crafted items, with reagents and the skill to learn them). Run after build_data.py.
Exits non-zero on a failed check."""
import os, re, sys, json, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from geo import rects, world_to_px, zone_to_world, walkzone
import questie_forever as qf
HERE = os.path.dirname(os.path.abspath(__file__)); SITE = os.path.join(HERE, "..", "site")
AO = "/Applications/World of Warcraft/_forever_/Interface/AddOns"
FAIL = []
def check(ok, msg):
    print(("ok   " if ok else "FAIL ") + msg)
    if not ok: FAIL.append(msg)
db = qf.load(); NPC, OBJ, QUEST, ITEM = db["Npc"], db["Object"], db["Quest"], db["Item"]
src = open(f"{AO}/QuestieDB/support/Forever/Zones/areaIdToUiMapId.lua", encoding="utf-8").read()
area_ui = {}
for block in ("areaIdToUiMapId = [[", "areaIdToUiMapIdOverride = [["):
    body = src.split(block, 1)[1].split("]]", 1)[0]
    for a, u in re.findall(r"\[(\d+)\]\s*=\s*(\d+)", body): area_ui[int(a)] = int(u)
MAX_PTS = 24      # spawn points kept per NPC/object (an even sample when there are more)
MAX_SRC = 40      # sources kept per item per kind (best drop rate first)

def pts_of(rec):
    out = []
    for area, rows in qf.spawns_of(rec).items():
        ui = area_ui.get(area)
        if ui not in rects: continue
        for p in rows or []:
            if not p or p[0] is None or p[0] < 0: continue
            wx, wy = zone_to_world(ui, p[0], p[1]); m = rects[ui]["map"]; px, py = world_to_px(m, wx, wy)
            out.append([round(px, 1), round(py, 1), walkzone(ui), round(wx), round(wy)])
    if len(out) > MAX_PTS:
        step = len(out) / MAX_PTS; out = [out[int(i * step)] for i in range(MAX_PTS)]
    return out
def ids(v):
    if not v: return []
    if isinstance(v, dict): v = list(v.values())
    return [x for x in v if isinstance(x, int)]

# drop rates: npc -> item -> percent
rates = {}
dr = open(f"{AO}/AtlasLootClassic_DungeonsAndRaids/droprate.lua", encoding="utf-8").read()
for npc, body in re.findall(r"\[(\d+)\]\s*=\s*\{([^{}]*)\}", dr.split("DropRateData = {", 1)[1]):
    for it, r in re.findall(r"\[(\d+)\]\s*=\s*([\d.]+)", body): rates.setdefault(int(npc), {})[int(it)] = float(r)
qd = open(f"{AO}/QuestieDB/support/Forever/DropTables/classicItemDrops.lua", encoding="utf-8").read()
for it, body in re.findall(r"\[(\d+)\]\s*=\s*\{[^\n]*\n((?:\s*\[\d+\]\s*=\s*[\d.]+,?\n)+)", qd):
    for npc, r in re.findall(r"\[(\d+)\]\s*=\s*([\d.]+)", body): rates.setdefault(int(npc), {}).setdefault(int(it), float(r))
print("drop rates for", sum(len(v) for v in rates.values()), "npc-item pairs")
check(sum(len(v) for v in rates.values()) > 5000, "drop-rate tables parsed")

# recipes
recipes = {}   # item -> [[prof, recipe name, learn-at skill, [[reagent id, count]...]]]
for prof in ("Alchemy", "Blacksmithing", "Cooking", "Enchanting", "Engineering", "FirstAid", "Leatherworking", "Tailoring"):
    s = open(f"{AO}/ForeverArtisan_{prof}/SeedRecipes.lua", encoding="utf-8").read()
    for row in re.findall(r'^\s*\{"((?:[^"\\]|\\.)*)",(\d+),(\d+),(\d+),(\d+|nil),\{([\d,]*)\},\{[^}]*\},(\d+|nil),', s, re.M):
        name, spell, item, makes, gray, reag, train = row
        r = [int(x) for x in reag.split(",") if x]
        recipes.setdefault(int(item), []).append([prof.replace("FirstAid", "First Aid"), name, int(train) if train != "nil" else None, [[r[i], r[i + 1]] for i in range(0, len(r), 2)]])
print("recipes:", sum(len(v) for v in recipes.values()))
check(sum(len(v) for v in recipes.values()) > 1500, "ForeverArtisan recipes parsed")

npcs, objs, quests, items = {}, {}, {}, {}
def use_npc(i):
    if i in npcs: return npcs[i] is not None
    n = NPC.get(i); P = pts_of(n) if n else []
    # [7] = 1 for an NPC that is only sometimes there: faction template 1555 is the Darkmoon Faire
    npcs[i] = [n.get("name"), n.get("minLevel") or 0, n.get("maxLevel") or 0, n.get("friendlyToFaction") or "", n.get("rank") or 0, n.get("subName") or "", P,
               1 if n.get("factionID") == 1555 else 0] if n and P else None
    return npcs[i] is not None
def use_obj(i):
    if i in objs: return objs[i] is not None
    o = OBJ.get(i); P = pts_of(o) if o else []
    objs[i] = [o.get("name"), P] if o and P else None
    return objs[i] is not None
def use_quest(i):
    if i in quests: return quests[i] is not None
    q = QUEST.get(i)
    if not q: quests[i] = None; return False
    sb = q.get("startedBy") or {}
    if isinstance(sb, list): sb = {k + 1: v for k, v in enumerate(sb) if v}
    starter = next((("n", s) for s in ids(sb.get(1)) if use_npc(s)), None) or next((("o", s) for s in ids(sb.get(2)) if use_obj(s)), None)
    quests[i] = [q.get("name"), q.get("questLevel") or 0, q.get("requiredLevel") or 0, starter]
    return True
for iid, it in ITEM.items():
    name = it.get("name")
    if not name: continue
    e = {}
    v = [n for n in ids(it.get("vendors")) if use_npc(n)]
    if v: e["v"] = v[:MAX_SRC]
    d = [[n, rates.get(n, {}).get(iid)] for n in ids(it.get("npcDrops")) if use_npc(n)]
    for npc, r in rates.items():   # drop-rate tables can name mobs Questie does not list for this item
        if iid in r and npc not in {x[0] for x in d} and use_npc(npc): d.append([npc, r[iid]])
    d.sort(key=lambda x: -(x[1] or 0))
    if d: e["d"] = d[:MAX_SRC]
    o = [n for n in ids(it.get("objectDrops")) if use_obj(n)]
    if o: e["o"] = o[:MAX_SRC]
    qr = [n for n in ids(it.get("questRewards")) if use_quest(n)]
    if qr: e["q"] = qr[:MAX_SRC]
    c = [n for n in ids(it.get("itemDrops")) if ITEM.get(n, {}).get("name")]
    if c: e["c"] = c[:MAX_SRC]
    if iid in recipes: e["r"] = recipes[iid]
    if e: e["n"] = name; items[iid] = e
for iid, rs in recipes.items():   # crafted items Questie has no row for
    if iid not in items:
        nm = ITEM.get(iid, {}).get("name")
        if nm: items[iid] = {"n": nm, "r": rs}
# names for reagents and containers that have no source of their own
names = {i: ITEM[i]["name"] for e in items.values() for i in [*(x[0] for r in e.get("r", []) for x in r[3]), *e.get("c", [])] if i in ITEM and ITEM[i].get("name")}
out = dict(items=items, npcs={k: v for k, v in npcs.items() if v}, objs={k: v for k, v in objs.items() if v}, quests={k: v for k, v in quests.items() if v}, names=names)
txt = "window.WOWITEMS=" + json.dumps(out, separators=(",", ":"), ensure_ascii=False) + ";"
open(os.path.join(SITE, "items.js"), "w").write(txt)
print(f"items {len(items)}, npcs {len(out['npcs'])}, objects {len(out['objs'])}, quests {len(out['quests'])}; items.js {len(txt)//1024} KB")
def has(name, kind):
    e = next((e for e in items.values() if e["n"] == name), None); return bool(e and e.get(kind))
check(has("Mageroyal", "o"), "Mageroyal: gathered from herb nodes")
check(has("Copper Ore", "o"), "Copper Ore: mined from veins")
check(has("Minor Healing Potion", "r"), "Minor Healing Potion: crafted (Alchemy)")
check(has("Bolt of Linen Cloth", "r"), "Bolt of Linen Cloth: crafted (Tailoring)")
check(has("Refreshing Spring Water", "v"), "Refreshing Spring Water: sold by vendors")
check(any(x[1] for e in items.values() for x in e.get("d", [])), "some drops carry a rate")
lhara = next((v for v in npcs.values() if v and v[0] == "Lhara"), None)
check(lhara is not None and lhara[7] == 1, "Darkmoon Faire vendor Lhara is marked as sometimes-there")
check(len(items) > 8000, f"{len(items)} items with a source")
if FAIL: sys.exit("FAILED: " + "; ".join(FAIL))
