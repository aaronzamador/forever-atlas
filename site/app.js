/* Forever Atlas core: map, settings, router, Route tab.  Data: data.js and extras.js (built by build/*.py).
   Feature tabs (errands.js, level.js, gather.js) use window.Atlas. */
(function () {
  const D = window.WOWDATA, X = window.WOWEXTRAS;
  const W = 1002, H = 668;
  const P = D.places, Z = D.zones;
  const FL = D.flight;              // fitted flight model: seconds = length/speed + base + perStop*(legs-1)
  const WALK_DETOUR = 1.2;          // roads and terrain make real paths longer than the straight line
  const TRANSPORT = {               // look only; each leg's time (average wait + ride) comes from data.js
    boat: { verb: "Take the boat", col: "--boat", ic: "⛵" },
    zeppelin: { verb: "Take the zeppelin", col: "--zep", ic: "🎈" },
    tram: { verb: "Take the Deeprun Tram", col: "--tram", ic: "🚋" },
  };
  const HEARTH_T = 10 + 20;         // 10 s cast + loading screen
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const fmt = (s) => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60; return h ? `${h}h ${String(m).padStart(2, "0")}m` : m ? `${m}m ${String(r).padStart(2, "0")}s` : `${r}s`; };

  const store = {
    get(k, d) { try { const v = localStorage.getItem("fa." + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("fa." + k, JSON.stringify(v)); } catch (e) {} },
  };
  const state = {
    fac: store.get("fac", "A"), speed: store.get("speed", 11.2), hearthKey: store.get("hearthKey", ""),
    unknown: new Set(store.get("unknown", [])), level: store.get("level", 10), cls: store.get("cls", ""),
    char: store.get("char", null), A: null, B: null, tab: store.get("tab", "route"),
  };
  let hearthPlace = null;           // resolved inn {name, px, py, map, wx, wy, zone} or null
  const listeners = { settings: [], tab: [] };
  const on = (ev, f) => listeners[ev].push(f);
  const emit = (ev) => listeners[ev].forEach((f) => f());

  // ---------- map ----------
  const map = L.map("map", { crs: L.CRS.Simple, minZoom: -1.5, maxZoom: 4, zoomSnap: 0.25, zoomDelta: 0.5, attributionControl: false, preferCanvas: true });
  const ll = (x, y) => L.latLng(-y, x);
  const toPx = (latlng) => [latlng.lng, -latlng.lat];
  const contOf = (x) => (x >= 0 && x <= W ? 1414 : x >= D.conts[1415].off && x <= D.conts[1415].off + W ? 1415 : null);
  for (const c of ["1414", "1415"]) { const o = D.conts[c].off; L.imageOverlay("img/" + c + ".jpg", [ll(o, H), ll(o + W, 0)]).addTo(map); }
  map.fitBounds([ll(0, H), ll(D.conts[1415].off + W, 0)]);
  map.setMaxBounds([ll(-400, H + 300), ll(D.conts[1415].off + W + 400, -300)]);
  const zoneIds = Object.keys(Z);
  const boxLL = (b) => [ll(b[0], b[3]), ll(b[2], b[1])];
  // The classic continent art has no land where Riverglades sits (Forever added it off the east coast),
  // so its own zone map is always drawn there, feathered. Mount Hyjal and Shen'dralas lie on land the
  // continent art already shows, so they get zone art only when zoomed in, like every other zone.
  const EXTENDS_LAND = new Set(["2548"]);
  for (const id of zoneIds) if (EXTENDS_LAND.has(id)) L.imageOverlay("img/" + id + ".jpg", boxLL(Z[id].box), { className: "zoneart", opacity: 0.92 }).addTo(map);
  function zoneAt(x, y, cities) {
    let best = 0.5, bz = null;
    for (const id of zoneIds) {
      const z = Z[id];
      if (z.city && !cities) continue;
      if ((contOf(x) === 1414 ? 1 : 0) !== z.map) continue;
      const b = z.box, u = (x - b[0]) / (b[2] - b[0]), v = (y - b[1]) / (b[3] - b[1]);
      const d = Math.max(Math.abs(u - 0.5), Math.abs(v - 0.5)) * (z.city ? 0.6 : 1);
      if (d < best) { best = d; bz = id; }
    }
    return bz;
  }
  let zoneArt = null, zoneArtId = null;
  function updateZoneArt() {
    const zm = map.getZoom(), [x, y] = toPx(map.getCenter());
    const id = zm >= 1 ? zoneAt(x, y, zm >= 2.5) : null;
    if (id === zoneArtId) return;
    if (zoneArt) { const old = zoneArt; old.setOpacity(0); setTimeout(() => map.removeLayer(old), 400); }
    zoneArt = null; zoneArtId = id;
    if (!id || EXTENDS_LAND.has(id)) return;
    zoneArt = L.imageOverlay("img/" + id + ".jpg", boxLL(Z[id].box), { className: "zoneart", opacity: 0 }).addTo(map);
    zoneArt.bringToFront();
    setTimeout(() => zoneArt && zoneArt.setOpacity(1), 30);
  }
  map.on("moveend zoomend", updateZoneArt);
  const labels = L.layerGroup();
  for (const id of zoneIds) {
    const z = Z[id]; if (z.city) continue; const b = z.box;
    L.marker(ll((b[0] + b[2]) / 2, (b[1] + b[3]) / 2), { interactive: false, icon: L.divIcon({ className: "zl" + (z.new ? " new" : ""), html: z.name + (z.new ? " ✦" : ""), iconSize: null }) }).addTo(labels);
  }
  const syncLabels = () => (map.getZoom() >= -0.25 ? labels.addTo(map) : labels.remove());
  map.on("zoomend", syncLabels);
  const zoneCoords = (zone, px, py) => { const b = Z[zone].box; return [((px - b[0]) / (b[2] - b[0])) * 100, ((py - b[1]) / (b[3] - b[1])) * 100]; };

  // ---------- markers ----------
  const STYLE = {
    flight: { r: 6, color: "#ffcf4a", z: -1 }, dock: { r: 6, color: "#5fc3ff", z: -1 },
    dungeon: { r: 6, color: "#c084fc", z: 0 }, raid: { r: 7, color: "#f472b6", z: 0 },
    town: { r: 4, color: "#f3e6c4", z: 0.5 }, poi: { r: 3, color: "#d6c49a", z: 1.75 },
  };
  const KIND_WORD = { flight: "Flight master", dock: "Transport", dungeon: "Dungeon", raid: "Raid", town: "Town", poi: "Place" };
  const markerLayer = L.layerGroup().addTo(map);
  const facOK = (f) => f.includes(state.fac);
  const showMarkers = () => state.tab === "route" || state.tab === "errands";
  function drawMarkers() {
    markerLayer.clearLayers();
    if (!showMarkers()) return;
    const zm = map.getZoom();
    for (const p of P) {
      const s = STYLE[p.kind]; if (!s || zm < s.z) continue;
      if ((p.kind === "flight" || p.kind === "dock") && !facOK(p.fac)) continue;
      const unk = p.kind === "flight" && state.unknown.has(p.id);
      const m = L.circleMarker(ll(p.px, p.py), { radius: s.r, color: "#120e09", weight: 2, fillColor: unk ? "#6b6250" : s.color, fillOpacity: 1 });
      m.bindTooltip(`<b>${esc(p.kind === "flight" ? p.label : p.name)}</b><br><small>${KIND_WORD[p.kind]} · ${esc(Z[p.zone].name)}${unk ? " · you don't have this one" : ""}</small>`, { direction: "top", offset: [0, -6] });
      m.on("click", (e) => { L.DomEvent.stop(e); placePopup(p); });
      m.addTo(markerLayer);
    }
  }
  map.on("zoomend", drawMarkers);
  function placePopup(p) {
    const ep = placeEndpoint(p);
    const el = document.createElement("div");
    el.innerHTML = `<b>${esc(ep.name)}</b><br><small>${KIND_WORD[p.kind]} · ${esc(Z[p.zone].name)}</small>
      <div class="row"><button class="btn" data-a="A">Start here</button><button class="btn" data-a="B">Go here</button></div>
      ${p.kind === "flight" ? `<label style="display:block;margin-top:6px"><input type="checkbox" data-a="known" ${state.unknown.has(p.id) ? "" : "checked"}> I have this flight point</label>` : ""}`;
    el.addEventListener("click", (e) => {
      const a = e.target.dataset.a; if (!a) return;
      if (a === "A" || a === "B") { setEnd(a, ep); setTab("route"); map.closePopup(); }
      if (a === "known") setKnown(p.id, e.target.checked);
    });
    L.popup({ offset: [0, -4] }).setLatLng(ll(p.px, p.py)).setContent(el).openOn(map);
  }

  // ---------- endpoints ----------
  function pxToWorld(x, y) {
    const c = contOf(x); if (!c) return null;
    const C = D.conts[c], [xmin, ymin, xmax, ymax] = C.rect, u = (x - C.off) / W, v = y / H;
    return { map: C.map, wx: xmax - v * (xmax - xmin), wy: ymax - u * (ymax - ymin) };
  }
  const placeEndpoint = (p) => ({ name: p.kind === "flight" ? p.label : p.name, px: p.px, py: p.py, map: p.map, wx: p.wx, wy: p.wy, zone: String(p.zone) });
  // extras rows (services, hubs) carry z/m/x/y
  const rowEndpoint = (r, name) => ({ name, px: r.px, py: r.py, map: r.m, wx: r.x, wy: r.y, zone: String(r.z) });
  function pointEndpoint(x, y) {
    const w = pxToWorld(x, y); if (!w) return null;
    const zone = zoneAt(x, y, false); if (!zone) return null;
    let best = 1e9, near = null;
    for (const p of P) if (p.map === w.map && ["town", "poi", "flight", "dungeon", "raid"].includes(p.kind)) {
      const d = Math.hypot(p.wx - w.wx, p.wy - w.wy); if (d < best) { best = d; near = p; }
    }
    const [zx, zy] = zoneCoords(zone, x, y);
    const name = near && best < 250 ? `Near ${near.name}` : `${Z[zone].name} (${Math.round(zx)}, ${Math.round(zy)})`;
    return { name, px: x, py: y, ...w, zone };
  }
  const pins = {};
  const pinIcon = (c) => L.divIcon({ className: "", html: `<div class="ep-pin" style="background:${c}"></div>`, iconSize: [18, 18], iconAnchor: [9, 22] });
  function setEnd(which, ep) {
    state[which] = ep;
    const inp = document.getElementById("q" + which); if (inp) inp.value = ep ? ep.name : "";
    if (pins[which]) { map.removeLayer(pins[which]); pins[which] = null; }
    if (ep) {
      pins[which] = L.marker(ll(ep.px, ep.py), { icon: pinIcon(which === "A" ? "#4ade80" : "#f87171"), draggable: true, zIndexOffset: 1000 }).addTo(map);
      pins[which].on("dragend", (e) => { const [x, y] = toPx(e.target.getLatLng()); const np = pointEndpoint(x, y); setEnd(which, np || state[which]); emit("settings"); });
    }
  }
  const clickHandlers = {};   // tab -> fn(endpoint, event); a tab may take over map clicks
  map.on("click", (e) => {
    const [x, y] = toPx(e.latlng);
    const ep = pointEndpoint(x, y);
    if (clickHandlers[state.tab]) return clickHandlers[state.tab](ep, e);
    if (!ep) { flash("That spot isn't in any zone. Click on land."); return; }
    if (e.originalEvent.shiftKey || !state.A) setEnd("A", ep); else setEnd("B", ep);
    route();
  });

  // ---------- routing ----------
  const yd = (a, b) => (a.map === b.map ? Math.hypot(a.wx - b.wx, a.wy - b.wy) : Infinity);
  const walkT = (d) => (d * WALK_DETOUR) / state.speed;
  const flightsFrom = {}; for (const f of D.flights) (flightsFrom[f.a] = flightsFrom[f.a] || []).push(f);
  const transFrom = {};
  for (const t of D.transports) (transFrom[t.a] = transFrom[t.a] || []).push(t);   // directed: one-way loops stay one-way
  const graphs = {};
  // Flight points are two nodes: "ground" (walkable, in a zone) and "air" (in flight). Take-off costs
  // base - perStop, each leg length/speed + perStop, landing 0, so a chained flight totals
  // length/speed + base + perStop*(legs-1): the model fitted to recorded flights.
  function graph(fly) {
    const key = [state.fac, fly, state.speed, [...state.unknown].sort().join(",")].join("|");
    if (graphs[key]) return graphs[key];
    const nodes = [], zoneMembers = {}, ground = {}, air = {};
    const add = (n, inZones) => { n.i = nodes.length; nodes.push(n); if (inZones) for (const z of [n.zone, n.zone2]) if (z != null) (zoneMembers[z] = zoneMembers[z] || []).push(n.i); return n.i; };
    for (const p of P) {
      if (!["flight", "dock", "crossing"].includes(p.kind) || !p.fac.includes(state.fac)) continue;
      if (p.kind === "flight" && (!fly || state.unknown.has(p.id))) continue;
      const base = { ...p, zone: String(p.zone), zone2: p.zone2 != null ? String(p.zone2) : null, place: p };
      ground[p.id] = add(base, true);
      if (p.kind === "flight") air[p.id] = add({ ...base, kind: "air" }, false);
    }
    const adj = nodes.map(() => []);
    for (const n of nodes) {
      const u = n.i;
      if (n.kind !== "air") for (const z of [n.zone, n.zone2]) if (z != null) for (const v of zoneMembers[z]) {
        if (v === u) continue; const d = yd(n, nodes[v]); if (!isFinite(d)) continue;
        adj[u].push({ v, c: walkT(d), type: "walk", yards: d });
      }
      if (n.kind === "flight") { adj[u].push({ v: air[n.id], c: Math.max(0, FL.base - FL.perStop), type: "takeoff" }); adj[air[n.id]].push({ v: u, c: 0, type: "land" }); }
      if (n.kind === "air") for (const f of flightsFrom[n.id] || []) { const v = air[f.b]; if (v != null) adj[u].push({ v, c: f.len / FL.speed + FL.perStop, type: "fly", flight: f }); }
      if (n.kind === "dock") for (const tr of transFrom[n.id] || []) {
        if (!tr.fac.includes(state.fac)) continue; const v = ground[tr.b]; if (v == null) continue;
        adj[u].push({ v, c: tr.t, type: "transport", mode: tr.mode, tr });
      }
    }
    for (const k in graphs) delete graphs[k];
    return (graphs[key] = { nodes, zoneMembers, adj });
  }
  /* Single-source shortest times from endpoint src. opts: {fly (default true), hearth (use the hearthstone from src)}.
     Returns {costTo(ep), pathTo(ep) -> {total, legs}} */
  function tree(src, opts = {}) {
    const g = graph(opts.fly !== false), n = g.nodes.length;
    const dist = new Float64Array(n).fill(Infinity), prev = new Array(n).fill(null), done = new Uint8Array(n);
    const hearth = opts.hearth && hearthPlace ? { ...hearthPlace, kind: "hearth" } : null;
    const seed = (from, extra, viaHearth) => { for (const v of g.zoneMembers[from.zone] || []) {
      const d = yd(from, g.nodes[v]); if (!isFinite(d)) continue; const c = extra + walkT(d);
      if (c < dist[v]) { dist[v] = c; prev[v] = { u: -1, type: "walk", yards: d, viaHearth }; }
    } };
    seed(src, 0, false);
    if (hearth) seed(hearth, HEARTH_T, true);
    const heap = [];
    const push = (d, v) => { heap.push([d, v]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    for (let v = 0; v < n; v++) if (isFinite(dist[v])) push(dist[v], v);
    while (heap.length) {
      const [d, u] = pop(); if (done[u] || d > dist[u]) continue; done[u] = 1;
      for (const e of g.adj[u]) { const nd = d + e.c; if (nd < dist[e.v]) { dist[e.v] = nd; prev[e.v] = { u, ...e }; push(nd, e.v); } }
    }
    function best(ep) {
      let r = { c: Infinity, v: null, how: null };
      if (ep.zone === src.zone && ep.map === src.map) r = { c: walkT(yd(src, ep)), v: null, how: "direct" };
      if (hearth && ep.zone === hearth.zone) { const c = HEARTH_T + walkT(yd(hearth, ep)); if (c < r.c) r = { c, v: null, how: "hearth" }; }
      for (const v of g.zoneMembers[ep.zone] || []) {
        if (!isFinite(dist[v])) continue; const c = dist[v] + walkT(yd(g.nodes[v], ep));
        if (c < r.c) r = { c, v, how: "graph" };
      }
      return r;
    }
    const S = { ...src, kind: "start" };
    return {
      costTo: (ep) => best(ep).c,
      pathTo(ep) {
        const b = best(ep); if (!isFinite(b.c)) return null;
        const E = { ...ep, kind: "end" };
        if (b.how === "direct") return { total: b.c, legs: [{ type: "walk", from: S, to: E, t: b.c, yards: yd(src, ep) }] };
        if (b.how === "hearth") return { total: b.c, legs: [{ type: "hearth", from: S, to: hearth, t: HEARTH_T }, { type: "walk", from: hearth, to: E, t: b.c - HEARTH_T, yards: yd(hearth, ep) }] };
        const legs = [];
        const lastYd = yd(g.nodes[b.v], ep);
        legs.push({ type: "walk", from: g.nodes[b.v], to: E, t: walkT(lastYd), yards: lastYd });
        for (let v = b.v; ; v = prev[v].u) {
          const e = prev[v];
          if (e.u === -1) {
            const from = e.viaHearth ? hearth : S;
            legs.unshift({ ...e, from, to: g.nodes[v], t: dist[v] - (e.viaHearth ? HEARTH_T : 0) });
            if (e.viaHearth) legs.unshift({ type: "hearth", from: S, to: hearth, t: HEARTH_T });
            break;
          }
          legs.unshift({ ...e, from: g.nodes[e.u], to: g.nodes[v], t: dist[v] - dist[e.u] });
        }
        return { total: b.c, legs };
      },
    };
  }
  const solve = (A, B, opts = {}) => tree(A, opts).pathTo(B);

  // merge legs into steps a person would follow: walks together, take-off..landing as one flight
  const group = (t) => (t === "takeoff" || t === "fly" || t === "land" ? "fly" : t);
  function steps(legs) {
    const out = [];
    for (const l of legs) {
      const g = group(l.type), last = out[out.length - 1];
      if (last && last.type === g && (g === "walk" || g === "fly")) { last.legs.push(l); last.t += l.t; last.to = l.to; continue; }
      out.push({ type: g, mode: l.mode, legs: [l], t: l.t, from: l.from, to: l.to });
    }
    return out.filter((s) => !(s.type === "walk" && s.t < 1));
  }
  function stepInfo(s) {
    if (s.type === "walk") {
      const yds = s.legs.reduce((a, l) => a + (l.yards || 0), 0);
      const crossings = s.legs.map((l) => l.to).filter((n) => n.kind === "crossing");
      const via = crossings.length ? ` <small>via ${crossings.map((c) => esc(c.label !== "zone border" ? c.label : c.name)).join(", ")}${crossings.some((c) => c.approx) ? " (border approximate)" : ""}</small>` : "";
      const verb = state.speed > 7 ? "Ride" : "Run";
      const n = s.to;
      const dest = n.kind === "end" ? esc(n.name) : n.kind === "flight" ? `the flight master at ${esc(n.name)}` : n.kind === "dock" ? `the ${n.mode} dock (${esc(Z[n.zone].name)})` : esc(n.label || n.name);
      const shortDest = n.kind === "dock" ? `the ${n.mode} (${Z[n.zone].name})` : n.kind === "flight" ? `${n.name} flight master` : n.name;
      return { ic: state.speed > 7 ? "🐎" : "🥾", col: "--walk", html: `${verb} to ${dest}${via}<br><small>${Math.round(yds).toLocaleString()} yd straight-line</small>`, short: `${verb} to ${shortDest}` };
    }
    if (s.type === "fly") {
      const hops = s.legs.filter((l) => l.type === "fly");
      const stops = [hops[0].from, ...hops.map((l) => l.to)].map((n) => esc(n.name));
      return { ic: "🦅", col: "--fly", html: `Fly ${stops.join(" → ")}${hops.length > 1 ? `<br><small>${hops.length} legs, one ticket</small>` : ""}`, short: `Fly to ${s.to.name}` };
    }
    if (s.type === "transport") {
      const T = TRANSPORT[s.mode], tr = s.legs[0].tr;
      const note = tr.est ? (tr.mode === "tram" ? "estimate" : `estimated: boat speed isn't in game data`) : "departs every " + fmt(tr.cycle) + " (measured)";
      return { ic: T.ic, col: T.col, html: `${T.verb} (${esc(tr.route)}) to the ${esc(Z[s.to.zone].name)} side<br><small>includes the average wait · ${note}</small>`, short: `${tr.route} to ${Z[s.to.zone].name}` };
    }
    if (s.type === "hearth") return { ic: "🏠", col: "--hearth", html: `Hearth to ${esc(s.to.name)}`, short: `Hearth to ${s.to.name}` };
  }
  const legLine = (l) => (l.type === "fly" ? l.flight.pts.map(([x, y]) => ll(x, y)) : l.type === "takeoff" || l.type === "land" ? [] : [ll(l.from.px, l.from.py), ll(l.to.px, l.to.py)]);
  function drawSteps(layer, S, bounds) {
    for (const s of S) {
      const info = stepInfo(s), col = css(info.col);
      for (const l of s.legs) {
        const pts = legLine(l); if (pts.length < 2) continue;
        if (bounds) pts.forEach((p) => bounds.push(p));
        const dash = l.type === "walk" ? "2 7" : l.type === "hearth" || l.type === "transport" ? "8 8" : null;
        L.polyline(pts, { color: "#120e09", weight: 7, opacity: 0.6, interactive: false }).addTo(layer);
        L.polyline(pts, { color: col, weight: 4, dashArray: dash, lineCap: "round" }).bindTooltip(esc(info.short || ""), { sticky: true }).addTo(layer);
      }
    }
  }
  function stepsHtml(S) {
    return `<ol class="steps">${S.map((s, k) => { const i = stepInfo(s); return `<li data-k="${k}"><span class="ic" style="background:${css(i.col)}">${i.ic}</span><span>${i.html}</span><span class="t">${s.type === "transport" && s.legs[0].tr.est ? "≈" : ""}${fmt(s.t)}</span></li>`; }).join("")}</ol>`;
  }
  function wireSteps(root, S) {
    root.querySelectorAll("ol.steps li").forEach((li) => li.addEventListener("click", () => {
      const b = []; for (const l of S[+li.dataset.k].legs) legLine(l).forEach((p) => b.push(p));
      if (b.length) map.fitBounds(L.latLngBounds(b).pad(0.3), { maxZoom: 3 });
    }));
  }
  // One waypoint per step destination, in that zone's own map coordinates. Both the TomTom /way lines and the
  // addon's route code are printed from this one list.
  function waypoints(S) {
    return S.map((s) => {
      const n = s.to; if (!n || n.px == null || s.type === "hearth") return null;
      const zone = n.zone && Z[n.zone] ? n.zone : zoneAt(n.px, n.py, false); if (!zone) return null;
      const [x, y] = zoneCoords(zone, n.px, n.py);
      return { zone, x: x.toFixed(1), y: y.toFixed(1), title: (stepInfo(s).short || n.name).replace(/[\r\n;,|]/g, " ") };
    }).filter(Boolean);
  }
  const tomtom = (S) => waypoints(S).map((w) => `/way #${w.zone} ${w.x} ${w.y} ${w.title}`);
  const routeCode = (S) => "FA1;" + waypoints(S).map((w) => `${w.zone},${w.x},${w.y},${w.title}`).join(";");
  function waysHtml(S) {
    const ways = tomtom(S);
    return `<details style="margin-top:8px"><summary class="hint" style="cursor:pointer">Send to the game (${ways.length} waypoints)</summary>
      <p class="hint">With the Forever Atlas addon: type <b>/fatlas route</b> in game, paste this, press Enter. It sets one TomTom waypoint at a time and moves to the next when you arrive.</p>
      <textarea class="code" readonly style="height:60px">${esc(routeCode(S))}</textarea><button class="btn" data-copy>Copy</button>
      <p class="hint" style="margin-top:8px">Without the addon: paste each of these lines into chat.</p><textarea class="code" readonly>${esc(ways.join("\n"))}</textarea>
      <button class="btn" data-copy>Copy</button></details>`;
  }
  document.addEventListener("click", (e) => {
    if (!e.target.matches("[data-copy]")) return;
    const ta = e.target.previousElementSibling; ta.select();
    const done = () => (e.target.textContent = "Copied");
    try { navigator.clipboard.writeText(ta.value).then(done, () => { document.execCommand("copy"); done(); }); } catch (err) { document.execCommand("copy"); done(); }
  });

  // ---------- Route tab ----------
  const routeLayer = L.layerGroup().addTo(map);
  function route() {
    routeLayer.clearLayers();
    const R = document.getElementById("result");
    if (state.tab !== "route") return;
    if (!state.A || !state.B) { R.innerHTML = `<span class="hint">${state.A ? "Now click where you want to go." : "Click the map to set a start, then click again for the destination."} Shift-click sets the start. Drag the pins to adjust. Click a marker for options.</span>`; return; }
    const best = solve(state.A, state.B, { hearth: true });
    if (!best) { R.innerHTML = `<span class="hint">No route found between these two points for ${state.fac === "A" ? "Alliance" : "Horde"}.</span>`; return; }
    const noFly = solve(state.A, state.B, { fly: false });
    const S = steps(best.legs), bounds = [];
    drawSteps(routeLayer, S, bounds);
    R.innerHTML = `<div class="total">${fmt(best.total)}</div>
      <div class="hint">${esc(state.A.name)} → ${esc(state.B.name)}</div>${stepsHtml(S)}
      <div class="alt">${noFly ? `No flying at all: ${fmt(noFly.total)}${noFly.total > best.total + 1 ? ` (flying saves ${fmt(noFly.total - best.total)})` : ""}.` : "Can't get there without flying."}
      Walking time is the straight line ×${WALK_DETOUR}. Flight times come from a model fitted to recorded flights (about ±7%). Boat and zeppelin times marked ≈ are estimates.</div>${waysHtml(S)}`;
    wireSteps(R, S);
    if (bounds.length) map.fitBounds(L.latLngBounds(bounds).pad(0.15), { maxZoom: 2.5 });
  }
  function flash(msg) { const R = document.getElementById("result"); if (R) R.innerHTML = `<span class="hint">${esc(msg)}</span>`; }

  // ---------- settings ----------
  function seg(id, key, parse) {
    const el = document.getElementById(id);
    const sync = () => el.querySelectorAll("button").forEach((b) => b.classList.toggle("on", String(parse(b.dataset.v)) === String(state[key])));
    el.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { state[key] = parse(b.dataset.v); store.set(key, state[key]); sync(); settingsChanged(); }));
    sync(); return sync;
  }
  const syncFac = seg("fac", "fac", String); seg("spd", "speed", Number);
  let innById = {};
  function fillHearth() {
    const sel = document.getElementById("hearth");
    const named = P.filter((p) => ["town", "flight", "poi"].includes(p.kind));
    // a hearthstone binds at an inn; list each inn under its nearest named place
    const opts = X.services.filter((s) => s.c === "inn" && facOK(s.f)).map((s) => {
      let best = 1e9, near = null; for (const p of named) if (p.map === s.m) { const d = Math.hypot(p.wx - s.x, p.wy - s.y); if (d < best) { best = d; near = p; } }
      const place = near && best < 600 ? near.name : Z[s.z].name;
      return { key: "inn" + s.id, place, label: `${place} — ${Z[s.z].name}`, s };
    }).sort((a, b) => a.label.localeCompare(b.label));
    const seen = new Set(), uniq = opts.filter((o) => !seen.has(o.label) && seen.add(o.label));
    innById = Object.fromEntries(uniq.map((o) => [o.key, o]));
    sel.innerHTML = `<option value="">No hearthstone (on cooldown)</option>` + uniq.map((o) => `<option value="${o.key}">${esc(o.label)}</option>`).join("");
    if (!innById[state.hearthKey]) state.hearthKey = "";
    sel.value = state.hearthKey;
    const o = innById[state.hearthKey];
    hearthPlace = o ? { name: o.place, px: o.s.px, py: o.s.py, map: o.s.m, wx: o.s.x, wy: o.s.y, zone: String(o.s.z) } : null;
  }
  document.getElementById("hearth").addEventListener("change", (e) => { state.hearthKey = e.target.value; store.set("hearthKey", state.hearthKey); settingsChanged(); });
  function settingsChanged() { fillHearth(); drawMarkers(); fpCount(); renderFp(); emit("settings"); }
  on("settings", route);

  // known flight points
  function setKnown(id, known) { known ? state.unknown.delete(id) : state.unknown.add(id); store.set("unknown", [...state.unknown]); settingsChanged(); }
  const myFps = () => P.filter((p) => p.kind === "flight" && facOK(p.fac));
  function fpCount() { const all = myFps(), k = all.filter((p) => !state.unknown.has(p.id)).length; document.getElementById("fpcount").textContent = `Flight points: ${k} of ${all.length} known${state.char ? ` (from ${state.char.name})` : ""}`; }
  function renderFp() {
    const el = document.getElementById("fppanel"); if (el.hidden) return;
    const fps = myFps().sort((a, b) => a.label.localeCompare(b.label));
    el.innerHTML = `<div class="row" style="margin-top:6px"><button class="btn" data-all="1">All known</button><button class="btn" data-all="0">None</button></div>
      <div class="fpgrid">${fps.map((p) => `<label><input type="checkbox" data-id="${p.id}" ${state.unknown.has(p.id) ? "" : "checked"}> ${esc(p.label)}</label>`).join("")}</div>`;
  }
  document.getElementById("fpedit").addEventListener("click", () => { const el = document.getElementById("fppanel"); el.hidden = !el.hidden; renderFp(); });
  document.getElementById("fppanel").addEventListener("change", (e) => { if (e.target.dataset.id) setKnown(+e.target.dataset.id, e.target.checked); });
  document.getElementById("fppanel").addEventListener("click", (e) => {
    const a = e.target.dataset.all; if (a == null) return;
    for (const p of myFps()) a === "1" ? state.unknown.delete(p.id) : state.unknown.add(p.id);
    store.set("unknown", [...state.unknown]); settingsChanged();
  });

  // ---------- tabs ----------
  function setTab(t) {
    state.tab = t; store.set("tab", t);
    document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.t === t));
    document.querySelectorAll("section[data-tab]").forEach((s) => (s.hidden = s.dataset.tab !== t));
    drawMarkers(); emit("tab"); route();
  }
  document.getElementById("tabs").addEventListener("click", (e) => { const t = e.target.dataset.t; if (t) setTab(t); });

  // search box helper, reused by tabs: items() -> [{label, sub, ep}]
  function suggest(inp, ul, items, choose) {
    let list = [], sel = 0;
    const render = () => { ul.innerHTML = list.map((r, i) => `<li class="${i === sel ? "on" : ""}" data-i="${i}">${esc(r.label)} <small>${esc(r.sub)}</small></li>`).join(""); ul.hidden = !list.length; };
    inp.addEventListener("input", () => {
      const q = inp.value.trim().toLowerCase(); sel = 0;
      if (q.length < 2) { list = []; render(); return; }
      const score = (r) => { const n = r.label.toLowerCase(); return n.startsWith(q) ? 0 : n.includes(q) ? 1 : r.sub.toLowerCase().includes(q) ? 2 : 9; };
      list = items().map((r) => [score(r), r]).filter((x) => x[0] < 9).sort((a, b) => a[0] - b[0]).slice(0, 14).map((x) => x[1]); render();
    });
    inp.addEventListener("keydown", (e) => {
      if (ul.hidden) return;
      if (e.key === "ArrowDown") { sel = Math.min(list.length - 1, sel + 1); render(); e.preventDefault(); }
      if (e.key === "ArrowUp") { sel = Math.max(0, sel - 1); render(); e.preventDefault(); }
      if (e.key === "Enter" && list[sel]) { choose(list[sel]); list = []; render(); }
      if (e.key === "Escape") { list = []; render(); }
    });
    ul.addEventListener("mousedown", (e) => { const li = e.target.closest("li"); if (li) { e.preventDefault(); choose(list[+li.dataset.i]); list = []; render(); } });
    inp.addEventListener("blur", () => setTimeout(() => { list = []; render(); }, 150));
  }
  const SVC_WORD = (c) => ({ inn: "Innkeeper", bank: "Banker", auction: "Auctioneer", stable: "Stable master", repair: "Repairs", mail: "Mailbox", weaponmaster: "Weapon master" }[c]
    || (c.startsWith("trainer:") ? c.slice(8) + " trainer" : c.startsWith("prof:") ? c.slice(5) + " trainer"
      : c.startsWith("vendor:") ? { food: "Food & drink", reagent: "Reagents", general: "General goods", trade: "Trade supplies", fishing: "Fishing supplies", ammo: "Ammo" }[c.slice(7)] : c));
  const placeItems = () => [
    ...P.filter((p) => ["flight", "town", "poi", "dungeon", "raid", "dock"].includes(p.kind) && (p.kind !== "flight" || facOK(p.fac))).map((p) => ({ label: p.kind === "flight" ? p.label : p.name, sub: `${KIND_WORD[p.kind]} · ${Z[p.zone].name}`, ep: placeEndpoint(p) })),
    ...X.services.filter((s) => s.c !== "mail" && facOK(s.f)).map((s) => ({ label: s.n, sub: `${SVC_WORD(s.c)} · ${Z[s.z].name}`, ep: rowEndpoint(s, s.n) })),
  ];
  for (const w of ["A", "B"]) suggest(document.getElementById("q" + w), document.getElementById("s" + w), placeItems, (r) => { setEnd(w, r.ep); route(); });
  document.getElementById("swap").addEventListener("click", () => { const a = state.A, b = state.B; setEnd("A", b); setEnd("B", a); route(); });
  document.getElementById("clear").addEventListener("click", () => { setEnd("A", null); setEnd("B", null); route(); });

  // ---------- character file written by the ForeverAtlas addon (addon/ForeverAtlas) ----------
  const CLASS_NAMES = { WARRIOR: "Warrior", PALADIN: "Paladin", HUNTER: "Hunter", ROGUE: "Rogue", PRIEST: "Priest", SHAMAN: "Shaman", MAGE: "Mage", WARLOCK: "Warlock", DRUID: "Druid" };
  function applyCharacter(text) {
    // ForeverAtlasDB = { ["chars"] = { ["Name - Realm"] = { ["faction"] = "Alliance", ["class"] = "WARRIOR", ["level"] = 23,
    //   ["bind"] = "Goldshire", ["known"] = "2,4,5", ["seenMaps"] = "1415", ["time"] = 1763400000, }, }, }
    const chars = [];
    const re = /\["([^"]+)"\]\s*=\s*\{([^{}]*)\}/g; let m;
    while ((m = re.exec(text))) {
      const body = m[2], f = (k) => { const r = new RegExp(`\\["${k}"\\]\\s*=\\s*(?:"([^"]*)"|(-?[\\d.]+))`).exec(body); return r ? (r[1] != null ? r[1] : +r[2]) : null; };
      if (f("faction") == null) continue;
      chars.push({ name: m[1], faction: f("faction"), cls: f("class"), level: f("level"), bind: f("bind"), known: f("known"), knownNames: f("knownNames"), seen: f("seenMaps"), time: f("time") || 0 });
    }
    if (!chars.length) return "That file has no ForeverAtlas characters in it. Pick WTF/Account/<your account>/SavedVariables/ForeverAtlas.lua.";
    chars.sort((a, b) => b.time - a.time);
    const c = chars[0];
    state.fac = c.faction === "Horde" ? "H" : "A"; store.set("fac", state.fac);
    if (c.level) { state.level = c.level; store.set("level", c.level); }
    if (c.cls && CLASS_NAMES[c.cls]) { state.cls = CLASS_NAMES[c.cls]; store.set("cls", state.cls); }
    let fpNote = "";
    const seen = new Set(String(c.seen || "").split(",").filter(Boolean).map(Number));
    if (seen.size) {
      // the addon only knows the flight maps it has seen; a continent it never saw stays as it was
      // ids when the client gave them (modern flight-map API), otherwise names, which are TaxiNodes' own names
      const known = new Set(String(c.known || "").split(",").filter(Boolean).map(Number));
      const names = new Set(String(c.knownNames || "").split("|").filter(Boolean).map((n) => n.toLowerCase()));
      const contUi = { 0: 1415, 1: 1414 };
      for (const p of P) if (p.kind === "flight" && p.fac.includes(state.fac) && seen.has(contUi[p.map])) {
        if (known.has(p.taxi) || names.has(p.label.toLowerCase())) state.unknown.delete(p.id); else state.unknown.add(p.id);
      }
      store.set("unknown", [...state.unknown]);
      if (seen.size < 2) fpNote = " The addon could read only one continent's flight points; the other keeps what you set by hand.";
    } else fpNote = " The addon hasn't recorded flight points yet: in game, open the world map once, type /fatlas, then /reload.";
    if (c.bind) {
      fillHearth();
      const o = Object.values(innById).find((o) => o.place.toLowerCase() === String(c.bind).toLowerCase()) || Object.values(innById).find((o) => o.label.toLowerCase().includes(String(c.bind).toLowerCase()));
      if (o) { state.hearthKey = o.key; store.set("hearthKey", o.key); } else fpNote += ` Hearth "${c.bind}" isn't an inn I know, so it isn't set.`;
    }
    state.char = { name: c.name, level: c.level, cls: state.cls }; store.set("char", state.char);
    syncFac(); settingsChanged();
    return `Loaded ${c.name}: level ${c.level} ${state.cls || ""} (${c.faction})${c.bind ? `, hearth at ${c.bind}` : ""}.${fpNote}`;
  }
  // build/sync_character.py copies the SavedVariables file into site/character.js; apply it when it is newer
  if (window.FA_CHARACTER && window.FA_CHARACTER_TIME && window.FA_CHARACTER_TIME !== store.get("charTime", 0)) {
    store.set("charTime", window.FA_CHARACTER_TIME);
    setTimeout(() => { const msg = applyCharacter(window.FA_CHARACTER); flash(msg); }, 0);
  }
  document.getElementById("charload").addEventListener("click", () => document.getElementById("charfile").click());
  document.getElementById("charfile").addEventListener("change", (e) => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader(); r.onload = () => { const msg = applyCharacter(String(r.result)); setTab("route"); flash(msg); }; r.readAsText(f);
  });

  document.getElementById("about").innerHTML = `Map art, flight points and flight paths come from WoW Forever's own game data (${esc(D.built)}). Flight times come from a model fitted to ${D.flightN} recorded flights. Quests, trainers, services, herbs and ore come from Forever's Questie database. Boat and zeppelin routes are Forever's own transport paths; the tram, dungeons and zone borders come from Leatrix Maps. ✦ marks new Forever zones, whose borders are approximate.`;

  window.Atlas = { D, X, P, Z, map, ll, toPx, state, store, on, emit, esc, fmt, css, tree, solve, steps, stepInfo, stepsHtml, wireSteps, drawSteps, tomtom, routeCode, waysHtml,
    setEnd, route, setTab, pointEndpoint, placeEndpoint, rowEndpoint, zoneAt, zoneCoords, suggest, placeItems, SVC_WORD, facOK, clickHandlers, applyCharacter, WALK_DETOUR };
  fillHearth(); fpCount(); syncLabels();
  setTimeout(() => setTab(state.tab), 0);
})();
