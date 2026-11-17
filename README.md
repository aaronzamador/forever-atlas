# Forever Atlas

**Live:** https://aaronzamador.github.io/forever-atlas/

A clickable map of WoW Forever with four tools. Open `site/index.html` in a browser. It works offline.

- **Route:** the fastest way from A to B, using walking or riding, flight paths, boats, zeppelins, the tram and your hearthstone. Gives TomTom waypoints.
- **Errands:** a list of stops (bank, auction house, your class trainer, a mailbox and so on). It picks which NPC of each kind to visit and the order that makes the whole trip fastest.
- **Level:** quest hubs ranked by how many quests are worth doing at your level, with travel time from where you are.
- **Gather:** where your herbs or ore spawn, the best zones for your skill, and a loop through the densest patch.
- **Find:** where to get an item (vendors, gathering, mob drops with rates, crafting and its reagents, quest rewards), with the best bet and a route to it.
- **Dungeons:** the quests for a dungeon you can pick up outside, and the fastest pickup run ending at the entrance.
- **Level → Levelling plan:** hub by hub from your level to a target, using Questie's XP per quest.
- **Send to the game:** every route has a code. In game, `/fatlas route`, paste, Enter: the addon sets one TomTom waypoint at a time and moves on as you arrive (`/fatlas next`, `back`, `stop`).

## Using your own character
1. Copy `addon/ForeverAtlas` into `/Applications/World of Warcraft/_forever_/Interface/AddOns/`. Restart the game, because a new addon folder needs a full restart.
2. Log in. The addon reads your known flight points from the game's own map data, so there's nothing to open. Then `/reload` or log out, which is when the game writes the file. `/fatlas` shows what it has recorded.
3. Run `python3 build/sync_character.py` and reload the page. It picks up your faction, level, class, hearth and known flight points.
   (Or use "load my character" on the page and pick `WTF/Account/<account>/SavedVariables/ForeverAtlas.lua`.)

## Rebuild and test
- Map art: `python3 build/fetch_art.py` (Forever `wowf` tiles from wago.tools, cached in build/tiles).
- Route data: `python3 build/build_data.py` writes site/data.js and fits the flight-time model.
- Errands, levelling, gathering and dungeon data: `python3 build/build_extras.py` writes site/extras.js (run after build_data).
- Item sources: `python3 build/build_items.py` writes site/items.js (run after build_data).
- Addon: `lua build/test/addon_test.lua <continent|zones|none|missing|route>` runs it against a stub of the game API and asserts what it records and does.
- Test: `node build/test/smoke.mjs <screenshot dir>` drives every tab headless, including addon → SavedVariables → page. All of these exit non-zero on a failed check.

## Sources
- Forever's own DB2 tables (wago.tools, product `wowf`, in build/db2): map rectangles and art, flight points, flight paths and the path each one flies, towns.
- Forever's Questie database (`QuestieDB_Forever.toc`, read-only): quests, NPC services and trainers, herb and ore spawn points. It's decoded by tbc-guide's decoder.
- ForeverArtisan herb and ore skill tables.
- Leatrix Maps (Anniversary install, read-only): dungeons, boats, zeppelins, the tram and zone-border crossings.
- Leatrix Plus recorded flight times (858 flights): the flight model is fitted to these. It's checked on held-out halves: median error 7%, 90th percentile about 18%.

## Known limits
- Walking is a straight line ×1.2 inside a zone. Between zones it uses Leatrix's recorded border crossings. It doesn't know about cliffs inside a zone. Gathering loops are straight lines too.
- Riverglades, Mount Hyjal and Shen'dralas are new in Forever and have no recorded crossings, so their borders are approximate. Zephras Isle and the Darkspear Islands are separate maps and aren't covered.
- Boats and zeppelins come from Forever's own transport paths, including its new routes: Stormwind Harbour, the Southshore loop, and Steamwheedle ↔ Powderfuse. Which routes still run comes from method.gg's Forever list. Two departure cycles are measured, from warcraft.wiki.gg. The rest assume a boat speed of 30 yd/s, which isn't in the game data, and are marked ≈. The tram time is an estimate. The Zephras Isle boats aren't covered.
- Find: Questie lists mob drops mainly for quest-related items, so common loot like cloth has no mob sources. Drop rates come from AtlasLoot and Questie and cover about half the drops. Farm time assumes 20 s a kill. Chests and Darkmoon Faire vendors are listed but never the best bet.
- Levelling plan: counts quest XP only (not kills), assumes a time per quest you set, and uses the classic XP-per-level table (Forever's isn't in the game data). 418 of Forever's new quests have XP estimated from their quest level.
- Quest hubs leave out class quests, profession quests and quests started by items. The quest data is Questie's and hasn't been checked against Forever in game.
- How many gathering spawn points are up at once is unknown. The "a third" figure is an assumption, and the page says so.
- The addon uses `C_TaxiMap.GetTaxiNodesForMap` and its `isUndiscovered` flag, the same call Blizzard's world map uses on this build. It has been run against a stub, not yet in game. If the continent map refuses taxi nodes, it reads each zone instead; whether that's needed on Forever is unknown.
