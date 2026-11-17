-- Forever Atlas: records what the Forever Atlas page needs to route for THIS character.
-- Writes ForeverAtlasDB.chars["Name - Realm"] = { faction, class, level, bind, known, undiscovered, knownNames, seenMaps, time }.
-- known/undiscovered/seenMaps are comma separated ids and knownNames is pipe separated, so the page needs no Lua parser.
--
-- Flight points come from C_TaxiMap.GetTaxiNodesForMap, which reports isUndiscovered for every node "without
-- considering the current flight master" (Blizzard_APIDocumentationGenerated/TaxiMapDocumentation.lua, build
-- 1.60.1). Blizzard's own world map calls it with no flight master open (FlightPointDataProvider.lua), so no
-- flight map has to be opened and no flight-map state has to be interpreted.
local _, ns = ...
ns = ns or {}
local f = CreateFrame("Frame")
local CONTINENTS = { 1414, 1415 }   -- Kalimdor, Eastern Kingdoms
local lastCount = nil

local function charKey()
  local name, realm = UnitName("player"), GetRealmName()
  return (name or "?") .. " - " .. (realm or "?")
end

local function rec()
  ForeverAtlasDB = ForeverAtlasDB or {}
  ForeverAtlasDB.chars = ForeverAtlasDB.chars or {}
  local k = charKey()
  ForeverAtlasDB.chars[k] = ForeverAtlasDB.chars[k] or {}
  return ForeverAtlasDB.chars[k]
end

local function basics(level)
  local r = rec()
  r.faction = UnitFactionGroup("player")
  local _, cls = UnitClass("player")
  r.class = cls
  r.level = level or UnitLevel("player")
  if GetBindLocation then r.bind = GetBindLocation() end
  r.time = time()
end

local function say(msg) print("|cffe8b24aForever Atlas|r: " .. msg) end

-- nodes for one continent: the continent map itself if the client shows taxi nodes there, otherwise its zones
local function nodesFor(cont)
  local out = {}
  local function take(mapID)
    if C_TaxiMap.ShouldMapShowTaxiNodes and not C_TaxiMap.ShouldMapShowTaxiNodes(mapID) then return false end
    local ok, nodes = pcall(C_TaxiMap.GetTaxiNodesForMap, mapID)
    if not ok or type(nodes) ~= "table" then return false end
    for _, n in ipairs(nodes) do if n.nodeID then out[n.nodeID] = n end end
    return true
  end
  if not take(cont) and C_Map and C_Map.GetMapChildrenInfo then
    local kids = C_Map.GetMapChildrenInfo(cont) or {}
    for _, k in ipairs(kids) do take(k.mapID) end
  end
  return out
end

local function recordTaxi()
  if not (C_TaxiMap and C_TaxiMap.GetTaxiNodesForMap) then
    say("this client has no C_TaxiMap.GetTaxiNodesForMap, so flight points cannot be recorded.")
    return
  end
  local r = rec()
  local known, undiscovered, names, seen = {}, {}, {}, {}
  for _, cont in ipairs(CONTINENTS) do
    local any = false
    for id, n in pairs(nodesFor(cont)) do
      any = true
      if n.isUndiscovered then
        undiscovered[#undiscovered + 1] = id
      else
        known[#known + 1] = id
        if n.name then names[#names + 1] = (string.gsub(n.name, "|", "/")) end
      end
    end
    if any then seen[#seen + 1] = cont end
  end
  table.sort(known); table.sort(undiscovered); table.sort(names)
  -- a continent that returned nothing keeps what was recorded for it before
  if #seen == 0 then
    say("found no flight points on either continent. Open the world map once, then type /fatlas.")
    return
  end
  r.known = table.concat(known, ",")
  r.undiscovered = table.concat(undiscovered, ",")
  r.knownNames = table.concat(names, "|")
  r.seenMaps = table.concat(seen, ",")
  r.time = time()
  if lastCount ~= #known then
    lastCount = #known
    say(string.format("%d flight points known, %d not found yet.", #known, #undiscovered))
  end
end

f:RegisterEvent("PLAYER_ENTERING_WORLD")
f:RegisterEvent("PLAYER_LEVEL_UP")
f:RegisterEvent("HEARTHSTONE_BOUND")
f:RegisterEvent("TAXIMAP_OPENED")
f:RegisterEvent("TAXI_NODE_STATUS_CHANGED")
f:RegisterEvent("PLAYER_LOGOUT")
f:SetScript("OnEvent", function(self, event, arg1)
  if event == "PLAYER_LEVEL_UP" then
    basics(arg1)   -- the payload is the new level; UnitLevel can still return the old one here
    return
  end
  basics()
  if event ~= "HEARTHSTONE_BOUND" then recordTaxi() end
end)

---------------------------------------------------------------- routes from the page
-- The page's "Send to game" code: FA1;map,x,y,title;map,x,y,title;...  (x and y 0-100 on that uiMap)
-- One TomTom waypoint at a time; arriving within ARRIVE yards of it sets the next one.
local ARRIVE = 25
local route, step, wp = nil, 0, nil

function ns.ParseRoute(code)
  code = (code or ""):gsub("^%s+", ""):gsub("%s+$", "")
  if code:sub(1, 4) ~= "FA1;" then return nil, "that isn't a Forever Atlas route code (it should start with FA1;)" end
  local out = {}
  for part in string.gmatch(code:sub(5), "[^;]+") do
    local m, x, y, title = string.match(part, "^(%d+),([%d.]+),([%d.]+),(.*)$")
    if not m then return nil, "part " .. (#out + 1) .. " of the code is damaged" end
    out[#out + 1] = { map = tonumber(m), x = tonumber(x) / 100, y = tonumber(y) / 100, title = title }
  end
  if #out == 0 then return nil, "the code has no steps" end
  return out
end

local function clearWaypoint()
  if wp and TomTom and TomTom.RemoveWaypoint then TomTom:RemoveWaypoint(wp) end
  wp = nil
end

function ns.SetStep(i)
  clearWaypoint()
  if not route then return end
  if i > #route then
    say("route done.")
    route, step = nil, 0
    return
  end
  step = i
  local s = route[i]
  local cb = TomTom:DefaultCallbacks({ cleardistance = 0, arrivaldistance = 10 })
  cb.distance = cb.distance or {}
  cb.distance[ARRIVE] = function() ns.SetStep(step + 1) end
  wp = TomTom:AddWaypoint(s.map, s.x, s.y, { title = string.format("%d/%d %s", i, #route, s.title), callbacks = cb, persistent = false, crazy = true, silent = true })
  say(string.format("step %d of %d: %s", i, #route, s.title))
end

function ns.StartRoute(code)
  if not (TomTom and TomTom.AddWaypoint) then say("TomTom isn't loaded, so the route can't be shown.") return false end
  local r, err = ns.ParseRoute(code)
  if not r then say(err) return false end
  route = r
  ns.SetStep(1)
  return true
end

local box
local function pasteBox()
  if not box then
    box = CreateFrame("Frame", "ForeverAtlasPaste", UIParent, "BackdropTemplate")
    box:SetSize(420, 74); box:SetPoint("CENTER"); box:SetFrameStrata("DIALOG")
    box:SetBackdrop({ bgFile = "Interface\\Tooltips\\UI-Tooltip-Background", edgeFile = "Interface\\Tooltips\\UI-Tooltip-Border", edgeSize = 12, insets = { left = 3, right = 3, top = 3, bottom = 3 } })
    box:SetBackdropColor(0, 0, 0, 0.9)
    local label = box:CreateFontString(nil, "OVERLAY", "GameFontNormal")
    label:SetPoint("TOPLEFT", 10, -10); label:SetText("Paste the route code from Forever Atlas, then press Enter")
    local e = CreateFrame("EditBox", nil, box, "InputBoxTemplate")
    e:SetSize(390, 24); e:SetPoint("BOTTOM", 0, 12); e:SetAutoFocus(true); e:SetMaxLetters(0)
    e:SetScript("OnEnterPressed", function(self) local ok = ns.StartRoute(self:GetText()); self:SetText(""); if ok then box:Hide() end end)
    e:SetScript("OnEscapePressed", function(self) self:SetText(""); box:Hide() end)
    box.edit = e
  end
  box:Show(); box.edit:SetFocus()
end

SLASH_FOREVERATLAS1 = "/fatlas"
SlashCmdList.FOREVERATLAS = function(msg)
  local cmd = string.lower((msg or ""):match("^%s*(%S*)") or "")
  if cmd == "route" then pasteBox() return end
  if cmd == "next" then if route then ns.SetStep(step + 1) else say("no route running.") end return end
  if cmd == "back" then if route and step > 1 then ns.SetStep(step - 1) else say("no earlier step.") end return end
  if cmd == "stop" then clearWaypoint(); route, step = nil, 0; say("route stopped.") return end
  basics()
  lastCount = nil
  recordTaxi()
  local r = rec()
  say(string.format("%s, level %s %s, hearth %s. Saved when you /reload or log out.", charKey(), tostring(r.level), tostring(r.class), tostring(r.bind)))
  say("/fatlas route to paste a route from the page; /fatlas next, back, stop to step through it.")
end
