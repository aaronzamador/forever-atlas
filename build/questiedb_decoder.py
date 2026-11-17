"""Decoder for Questie's baked database (QuestieDB_*.toc stores), vendored from the tbc-guide project
(build/extract/common.py cbor_loads, build/extract/questiedb.py). Storage format, from QuestieDB/src/read/baked.lua:
  ## X-<Entity>-IDS: zlib+base64 CBOR list of ids (chunked as ~N~ + -IDS-1..N)
  ## X-<Entity>-<id>-S: base64 CBOR scalar row {fieldIndex: value, p: presence bitmask of table fields}
  ## X-<Entity>-<id>-<field>: base64 CBOR table field (chunked as ~N~ + -<field>-1..N)"""
import base64, re, struct, zlib
TOC = None   # set by the caller


class _R:
    __slots__ = ("b", "i")

    def __init__(self, b):
        self.b = b
        self.i = 0


def _arg(r, ai):
    if ai < 24:
        return ai
    if ai == 24:
        v = r.b[r.i]
        r.i += 1
        return v
    n = {25: 2, 26: 4, 27: 8}.get(ai)
    if n is None:
        raise ValueError("indefinite/unsupported CBOR arg %d" % ai)
    v = int.from_bytes(r.b[r.i:r.i + n], "big")
    r.i += n
    return v


def _item(r):
    ib = r.b[r.i]
    r.i += 1
    mt, ai = ib >> 5, ib & 31
    if mt == 0:
        return _arg(r, ai)
    if mt == 1:
        return -1 - _arg(r, ai)
    if mt == 2:
        n = _arg(r, ai)
        v = r.b[r.i:r.i + n]
        r.i += n
        return v.decode("utf-8", "replace")
    if mt == 3:
        n = _arg(r, ai)
        v = r.b[r.i:r.i + n]
        r.i += n
        return v.decode("utf-8", "replace")
    if mt == 4:
        return [_item(r) for _ in range(_arg(r, ai))]
    if mt == 5:
        n = _arg(r, ai)
        d = {}
        for _ in range(n):
            k = _item(r)
            d[k] = _item(r)
        return d
    if mt == 6:
        _arg(r, ai)
        return _item(r)
    if mt == 7:
        if ai == 20:
            return False
        if ai == 21:
            return True
        if ai in (22, 23):
            return None
        if ai == 25:
            h = struct.unpack(">e", r.b[r.i:r.i + 2])[0]
            r.i += 2
            return h
        if ai == 26:
            v = struct.unpack(">f", r.b[r.i:r.i + 4])[0]
            r.i += 4
            return v
        if ai == 27:
            v = struct.unpack(">d", r.b[r.i:r.i + 8])[0]
            r.i += 8
            return v
    raise ValueError("bad CBOR byte %x at %d" % (ib, r.i))


def cbor_loads(b):
    r = _R(b)
    v = _item(r)
    if r.i != len(b):
        raise ValueError("trailing CBOR bytes: %d of %d" % (r.i, len(b)))
    return v


QUEST = dict(name=1, startedBy=2, finishedBy=3, requiredLevel=4, questLevel=5, requiredRaces=6, requiredClasses=7,
             objectivesText=8, triggerEnd=9, objectives=10, sourceItemId=11, preQuestGroup=12, preQuestSingle=13,
             childQuests=14, inGroupWith=15, exclusiveTo=16, zoneOrSort=17, requiredSkill=18, requiredMinRep=19,
             requiredMaxRep=20, requiredSourceItems=21, nextQuestInChain=22, questFlags=23, specialFlags=24,
             parentQuest=25, reputationReward=26, breadcrumbForQuestId=27, breadcrumbs=28, extraObjectives=29,
             requiredSpell=30, requiredSpecialization=31, requiredMaxLevel=32, availableUntilCompleted=33,
             availableStartingWith=34, requiredRanks=35, disabledByQuest=36)
NPC = dict(name=1, minLevel=4, maxLevel=5, rank=6, spawns=7, waypoints=8, zoneID=9, questStarts=10, questEnds=11,
           factionID=12, friendlyToFaction=13, subName=14, npcFlags=15)
ITEM = dict(name=1, npcDrops=2, objectDrops=3, itemDrops=4, startQuest=5, questRewards=6, flags=7, foodType=8,
            itemLevel=9, requiredLevel=10, ammoType=11, **{"class": 12}, subClass=13, vendors=14, relatedQuests=15,
            teachesSpell=16)
OBJECT = dict(name=1, questStarts=2, questEnds=3, spawns=4, zoneID=5, factionID=6, waypoints=7)
SCHEMA = {"Quest": QUEST, "Npc": NPC, "Item": ITEM, "Object": OBJECT}


def _read_store():
    store = {}
    pat = re.compile(r"^## X-(Quest|Npc|Item|Object)-([^:]+): (.*)$")
    with open(TOC, encoding="utf-8", errors="replace") as f:
        for line in f:
            if not line.startswith("## X-"):
                continue
            m = pat.match(line.rstrip("\r\n"))
            if m:
                store[(m[1], m[2])] = m[3]
    return store


def _stored(store, ent, key):
    v = store.get((ent, key))
    if v is None:
        return None
    if v.startswith("~"):
        m = re.match(r"^~(\d+)~$", v)
        if m:
            parts = []
            for i in range(1, int(m[1]) + 1):
                part = store.get((ent, "%s-%d" % (key, i)))
                if part is None:
                    raise ValueError("truncated chunk %s %s part %d" % (ent, key, i))
                parts.append(part)
            return "".join(parts)
    return v


def decode_all():
    store = _read_store()
    out = {}
    stats = {}
    for ent, schema in SCHEMA.items():
        ids = cbor_loads(zlib.decompress(base64.b64decode(_stored(store, ent, "IDS"))))
        rows = {}
        rev = {v: k for k, v in schema.items()}
        miss = 0
        for i in ids:
            s = _stored(store, ent, "%d-S" % i)
            if s is None:
                miss += 1
                continue
            row = cbor_loads(base64.b64decode(s))
            if isinstance(row, list):  # a dense Lua table serialises as a CBOR array (1-based)
                row = {n + 1: v for n, v in enumerate(row)}
            rec = {}
            p = row.get("p", 0) if isinstance(row, dict) else 0
            for k, v in row.items():
                if k == "p":
                    continue
                if k in rev:
                    rec[rev[k]] = v
            for f, name in rev.items():
                if p and (p >> (f - 1)) & 1:
                    tv = _stored(store, ent, "%d-%d" % (i, f))
                    if tv is not None:
                        rec[name] = cbor_loads(base64.b64decode(tv))
            rows[i] = rec
        out[ent] = rows
        stats[ent] = dict(ids=len(ids), rows=len(rows), missingScalar=miss)
    return out, stats


def spawns_of(rec):
    """spawns as {areaId:int -> [[x,y],...]}; a dense Lua table arrives as a list (1-based keys)."""
    v = rec.get("spawns")
    if not v:
        return {}
    if isinstance(v, list):
        v = {i + 1: r for i, r in enumerate(v) if r}
    return {int(k): r for k, r in v.items() if r}
