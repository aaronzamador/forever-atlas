"""Decode Forever's baked QuestieDB (QuestieDB_Forever.toc) with the vendored decoder (build/questiedb_decoder.py).
Caches to build/cache/questie.pickle. No faction fixes are applied; callers filter by race mask and friendlyToFaction."""
import os, sys, pickle
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import questiedb_decoder as questiedb  # noqa: E402
questiedb.TOC = "/Applications/World of Warcraft/_forever_/Interface/AddOns/QuestieDB/QuestieDB_Forever.toc"
CACHE = os.path.join(HERE, "cache", "questie.pickle")
def load():
    if os.path.exists(CACHE) and os.path.getmtime(CACHE) > os.path.getmtime(questiedb.TOC):
        return pickle.load(open(CACHE, "rb"))
    db, stats = questiedb.decode_all()
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    pickle.dump(db, open(CACHE, "wb"))
    print("decoded", stats)
    return db
spawns_of = questiedb.spawns_of
if __name__ == "__main__":
    db = load()
    print({k: len(v) for k, v in db.items()})
