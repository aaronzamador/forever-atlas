-- Runs addon/ForeverAtlas against a stub of the game API, fires its events, ASSERTS what it recorded,
-- and writes the SavedVariables file the way the client does (for the page test).
-- Usage: lua addon_test.lua <continent|zones|none|missing> [out.lua]     exits non-zero on a failed assertion.
-- Stub rules taken from Blizzard's own code for build 1.60.1 (~/.cache/wow-ui-forever):
--   GetTaxiNodesForMap is only called on a map that passes ShouldMapShowTaxiNodes (FlightPointDataProvider.lua:11-15),
--   and both the new and the old taxi APIs exist on the client, so the old one is present and must NOT be used.
local mode, out = arg[1], arg[2]
local handlers, frame, printed = {}, nil, {}
function CreateFrame() frame = { RegisterEvent = function(self, e) handlers[e] = true end, SetScript = function(self, k, fn) self.fn = fn end }; return frame end
function UnitName() return "Testchar" end
function GetRealmName() return "Realm" end
function UnitFactionGroup() return "Alliance", "Alliance" end
function UnitClass() return "Warrior", "WARRIOR", 1 end
local level = 23
function UnitLevel() return level end
function GetBindLocation() return "Goldshire" end
function time() return 1763400000 end
function print(...) local s = table.concat({ ... }, " "); printed[#printed + 1] = s; io.stderr:write(s, "\n") end
SlashCmdList = {}
-- old taxi API present on the client; the addon must not depend on it
function NumTaxiNodes() error("old taxi API used") end
function TaxiNodeGetType() error("old taxi API used") end
local N = function(id, name, und) return { nodeID = id, name = name, isUndiscovered = und, faction = 0 } end
local byMap = {
  [1415] = { N(2, "Stormwind, Elwynn", false), N(6, "Ironforge, Dun Morogh", false), N(5, "Lakeshire, Redridge", true) },
  [1414] = { N(26, "Auberdine, Darkshore", false), N(28, "Astranaar, Ashenvale", true) },
  [1429] = { N(2, "Stormwind, Elwynn", false) }, [1433] = { N(5, "Lakeshire, Redridge", true) }, [1426] = { N(6, "Ironforge, Dun Morogh", false) },
  [1439] = { N(26, "Auberdine, Darkshore", false) }, [1440] = { N(28, "Astranaar, Ashenvale", true) },
}
local children = { [1415] = { { mapID = 1429 }, { mapID = 1433 }, { mapID = 1426 } }, [1414] = { { mapID = 1439 }, { mapID = 1440 } } }
local function gate(m)
  if mode == "continent" then return m == 1414 or m == 1415 end
  if mode == "zones" then return m ~= 1414 and m ~= 1415 end
  return false
end
C_Map = { GetMapChildrenInfo = function(m) return children[m] or {} end }
C_TaxiMap = {
  GetAllTaxiNodes = function() error("flight-master-only API used") end,
  ShouldMapShowTaxiNodes = function(m) assert(type(m) == "number", "map id not a number"); return gate(m) end,
}
if mode ~= "missing" then
  -- on a refused map the real call's behaviour is unknown; returning an empty list (no error) is the case that
  -- would silently hide the zone fallback, so model that and count the violation
  C_TaxiMap.GetTaxiNodesForMap = function(m)
    if not gate(m) then gateViolations = (gateViolations or 0) + 1; return {} end
    return byMap[m] or {}
  end
end

local ns = {}
local chunk = assert(loadfile((arg[0]:gsub("build/test/addon_test.lua$", "")) .. "addon/ForeverAtlas/ForeverAtlas.lua"))
chunk("ForeverAtlas", ns)

if mode == "route" then
  -- TomTom stub shaped like the installed one (TomTom/core/waypoints.lua, distance.lua): AddWaypoint(m, x, y, opts) with
  -- x, y in 0-1, returning the uid table; callbacks.distance[range](event, uid, range, dist, lastdist)
  local added, removed = {}, {}
  TomTom = {
    DefaultCallbacks = function(self, opts) return { minimap = {}, world = {}, distance = { [opts.arrivaldistance] = function() end } } end,
    AddWaypoint = function(self, m, x, y, opts)
      assert(type(m) == "number" and x >= 0 and x <= 1 and y >= 0 and y <= 1, "AddWaypoint wants map, x 0-1, y 0-1")
      local uid = { m, x, y, title = opts.title, cb = opts.callbacks }; added[#added + 1] = uid; return uid end,
    RemoveWaypoint = function(self, uid) assert(type(uid) == "table", "RemoveWaypoint wants the uid table"); removed[#removed + 1] = uid end,
  }
  local code = arg[3] or "FA1;1429,32.5,50.1,Ride to the Stormwind flight master;1426,55.5,47.7,Fly to Ironforge;1426,60.0,40.0,Walk to the bank"
  local fails = 0
  local function check(ok, msg) io.stderr:write((ok and "ok   " or "FAIL ") .. msg .. "\n"); if not ok then fails = fails + 1 end end
  local r = ns.ParseRoute(code)
  check(r and #r >= 2, "parse: " .. tostring(r and #r) .. " steps")
  check(ns.ParseRoute("hello") == nil and ns.ParseRoute("FA1;1429,abc") == nil and ns.ParseRoute("XYZ;1429,32.5,50.1,well formed but not ours") == nil, "bad codes refused, including a well-formed one without the FA1; prefix")
  check(ns.StartRoute(code) == true and #added == 1, "start sets exactly one waypoint")
  check(added[1][1] == r[1].map and math.abs(added[1][2] - r[1].x) < 1e-9, "first waypoint is step 1, coordinates converted to 0-1")
  local cb = added[1].cb.distance[25]
  check(type(cb) == "function", "an arrival callback at 25 yd")
  cb("distance", added[1], 25, 20, 30)
  check(#added == 2 and removed[1] == added[1], "arriving removes step 1 and sets step 2")
  for i = 2, #r do added[#added].cb.distance[25]("distance", added[#added], 25, 10, 30) end
  check(#added == #r and #removed == #r, "walking every step sets each waypoint once and clears them all (" .. #added .. " set, " .. #removed .. " cleared)")
  if arg[2] then io.open(arg[2], "w"):write(#r .. "\n"); for _, s in ipairs(r) do io.open(arg[2], "a"):write(string.format("%d %.4f %.4f %s\n", s.map, s.x, s.y, s.title)) end end
  TomTom = nil
  check(ns.StartRoute(code) == false, "no TomTom: refuses and says so")
  os.exit(fails == 0 and 0 or 1)
end
local levelAtEvent
for _, e in ipairs({ "PLAYER_ENTERING_WORLD", "TAXIMAP_OPENED", "PLAYER_LEVEL_UP", "PLAYER_LOGOUT" }) do
  assert(handlers[e], "not registered: " .. e)
  if e == "PLAYER_LEVEL_UP" then
    frame.fn(frame, e, 24)   -- the payload is the new level while UnitLevel still says 23
    levelAtEvent = ForeverAtlasDB.chars["Testchar - Realm"].level
    level = 24               -- the client catches up afterwards
  else frame.fn(frame, e) end
end
SlashCmdList.FOREVERATLAS("")

local fails = 0
local function check(ok, msg) if not ok then fails = fails + 1; io.stderr:write("FAIL " .. msg .. "\n") else io.stderr:write("ok   " .. msg .. "\n") end end
local r = ForeverAtlasDB and ForeverAtlasDB.chars and ForeverAtlasDB.chars["Testchar - Realm"]
check(r ~= nil, mode .. ": character record written")
check(not gateViolations, mode .. ": GetTaxiNodesForMap only called on maps ShouldMapShowTaxiNodes allows (" .. tostring(gateViolations or 0) .. " violations)")
r = r or {}
check(r.faction == "Alliance" and r.class == "WARRIOR" and r.bind == "Goldshire", mode .. ": faction, class, bind")
check(levelAtEvent == 24, mode .. ": level taken from the PLAYER_LEVEL_UP payload, not the stale UnitLevel (got " .. tostring(levelAtEvent) .. ")")
if mode == "continent" or mode == "zones" then
  check(r.known == "2,6,26", mode .. ": known = discovered nodes only (got " .. tostring(r.known) .. ")")
  check(r.undiscovered == "5,28", mode .. ": undiscovered recorded separately (got " .. tostring(r.undiscovered) .. ")")
  check(r.seenMaps == "1414,1415", mode .. ": both continents seen (got " .. tostring(r.seenMaps) .. ")")
  check(r.knownNames == "Auberdine, Darkshore|Ironforge, Dun Morogh|Stormwind, Elwynn", mode .. ": names of known nodes (got " .. tostring(r.knownNames) .. ")")
else
  check(r.known == nil and r.seenMaps == nil, mode .. ": nothing recorded when nothing could be read")
  local said = false; for _, s in ipairs(printed) do if s:find("flight points", 1, true) or s:find("GetTaxiNodesForMap", 1, true) then said = true end end
  check(said, mode .. ": tells the player why nothing was recorded")
end

if out then
  local function ser(v, ind)
    if type(v) == "table" then
      local keys = {} for k in pairs(v) do keys[#keys + 1] = k end table.sort(keys, function(a, b) return tostring(a) < tostring(b) end)
      local s = "{\n" for _, k in ipairs(keys) do s = s .. ind .. "\t[" .. string.format("%q", k) .. "] = " .. ser(v[k], ind .. "\t") .. ",\n" end
      return s .. ind .. "}"
    elseif type(v) == "string" then return string.format("%q", v) else return tostring(v) end
  end
  local fh = assert(io.open(out, "w")); fh:write("\nForeverAtlasDB = " .. ser(ForeverAtlasDB, "") .. "\n"); fh:close()
end
os.exit(fails == 0 and 0 or 1)
