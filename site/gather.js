/* Gather tab: where the herbs or ore for your skill grow, which zones have the most, and a loop through
   a zone's spawn points. Spawn points come from Forever's Questie database; skill levels from ForeverArtisan.
   A spawn point is a place a node CAN appear: only some are up at any moment. */
(function () {
  const A = window.Atlas, { X, Z, esc, fmt, state, store } = A;
  const root = document.getElementById("gather");
  const layer = L.layerGroup().addTo(A.map), loopLayer = L.layerGroup().addTo(A.map);
  const PAL = ["#ff5f5f", "#ffd84a", "#5fd0ff", "#7dff8a", "#ff8af0", "#ffa94a", "#b48aff", "#4affd2", "#ffffff", "#c8ff4a", "#ff4aa0", "#4a8aff"];
  const CELL = 90;           // yards: spawn points closer than this are one stop on the loop
  const GATHER_S = 5;        // seconds per node: dismount, cast, loot, remount (estimate)
  let kind = store.get("gKind", "herb");
  const skill = () => store.get("gSkill_" + kind, 1);
  let picked = new Set(store.get("gPicked_" + kind, null) || []);
  let loopZone = null;
  let loopSize = store.get("gLoop", "tight");   // tight: the densest patch; zone: every spawn point in the zone
  const TIGHT_R = 650;                          // yards: radius of the "tight" patch

  const types = () => X.gather.filter((g) => g.k === kind && g.pts.length);
  // classic colours: orange always gives a skill-up, yellow usually, green sometimes, grey never
  const colourWord = (req, s) => (s < req ? "red" : s < req + 25 ? "orange" : s < req + 50 ? "yellow" : s < req + 100 ? "green" : "grey");
  const WORD_COL = { red: "#ff3b3b", orange: "#ff8c2a", yellow: "#ffe14a", green: "#4cd964", grey: "#9a9a9a" };
  function defaults() { const s = skill(); picked = new Set(types().filter((g) => ["orange", "yellow"].includes(colourWord(g.s, s))).map((g) => g.n)); }
  if (!store.get("gPicked_" + kind, null)) defaults();

  function draw() {
    layer.clearLayers(); loopLayer.clearLayers();
    if (state.tab !== "gather") return;
    const s = skill(), T = types(), sel = T.filter((g) => picked.has(g.n));
    const colOf = {}; sel.forEach((g, i) => (colOf[g.n] = PAL[i % PAL.length]));
    const perZone = {};
    for (const g of sel) for (const p of g.pts) {
      L.circleMarker(A.ll(p[0], p[1]), { radius: 2.6, weight: 0.8, color: "#120e09", fillColor: colOf[g.n], fillOpacity: 0.95, interactive: false }).addTo(layer);
      const z = (perZone[p[2]] = perZone[p[2]] || { n: 0, by: {} }); z.n++; z.by[g.n] = (z.by[g.n] || 0) + 1;
    }
    const zones = Object.entries(perZone).sort((a, b) => b[1].n - a[1].n).slice(0, 10);
    root.innerHTML = `
      <div class="row"><div class="seg" id="gk"><button data-v="herb">Herbalism</button><button data-v="ore">Mining</button></div>
        <label class="f" style="margin:0">Skill</label><input class="num" id="gs" type="number" min="1" max="300" value="${s}"></div>
      <label class="f">What to gather</label>
      <div class="fpgrid" style="max-height:180px">${T.map((g) => `<label><input type="checkbox" data-n="${esc(g.n)}" ${picked.has(g.n) ? "checked" : ""}>
        <span class="lv" style="background:${WORD_COL[colourWord(g.s, s)]}">${g.s}</span><span style="color:${colOf[g.n] || "inherit"}">${esc(g.n)}</span> <small class="hint">${g.pts.length}</small></label>`).join("")}</div>
      <div class="row" style="margin-top:4px"><button class="link" id="gdef">pick the ones that give skill-ups</button></div>
      <p class="hint">The badge is the skill a node needs, coloured by how likely it is to give you a skill-up. Dots on the map are spawn points: places a node can appear. Only some are up at once.</p>
      <label class="f">Best zones</label>
      <ul class="list">${zones.map(([z, v]) => `<li class="click" data-z="${z}"><span class="grow">${esc(Z[z].name)}<br><small class="hint">${Object.entries(v.by).sort((a, b) => b[1] - a[1]).map(([n, c]) => `${esc(n)} ${c}`).join(" · ")}</small></span><span class="t">${v.n}</span></li>`).join("") || `<li class="hint">Pick something to gather.</li>`}</ul>
      <div id="gloop"></div>`;
    root.querySelectorAll("#gk button").forEach((b) => b.classList.toggle("on", b.dataset.v === kind));
    root.querySelector("#gk").addEventListener("click", (e) => { const v = e.target.dataset.v; if (!v || v === kind) return; kind = v; store.set("gKind", kind); picked = new Set(store.get("gPicked_" + kind, null) || []); if (!store.get("gPicked_" + kind, null)) defaults(); loopZone = null; draw(); });
    root.querySelector("#gs").addEventListener("change", (e) => { store.set("gSkill_" + kind, Math.max(1, Math.min(300, +e.target.value || 1))); defaults(); store.set("gPicked_" + kind, [...picked]); draw(); });
    root.querySelector("#gdef").addEventListener("click", () => { defaults(); store.set("gPicked_" + kind, [...picked]); draw(); });
    root.querySelectorAll("input[data-n]").forEach((cb) => cb.addEventListener("change", () => { cb.checked ? picked.add(cb.dataset.n) : picked.delete(cb.dataset.n); store.set("gPicked_" + kind, [...picked]); draw(); }));
    root.querySelectorAll("li[data-z]").forEach((li) => li.addEventListener("click", () => { loopZone = li.dataset.z; showLoop(sel); }));
    if (loopZone) showLoop(sel);
  }

  // loop: merge nearby spawn points into stops, nearest-neighbour tour, then 2-opt until no swap helps
  function showLoop(sel) {
    loopLayer.clearLayers();
    const z = loopZone, pts = [];
    for (const g of sel) for (const p of g.pts) if (String(p[2]) === z) pts.push(p);
    if (pts.length < 3) return;
    if (loopSize === "tight") {
      // centre the patch on the spawn point with the most others within TIGHT_R
      let bc = null, bn = -1;
      for (const c of pts) { let n = 0; for (const q of pts) if (Math.hypot(q[3] - c[3], q[4] - c[4]) <= TIGHT_R) n++; if (n > bn) { bn = n; bc = c; } }
      const keep = pts.filter((q) => Math.hypot(q[3] - bc[3], q[4] - bc[4]) <= TIGHT_R);
      pts.length = 0; pts.push(...keep);
      if (pts.length < 3) return;
    }
    const cells = new Map();
    for (const p of pts) { const k = Math.round(p[3] / CELL) + ":" + Math.round(p[4] / CELL); const c = cells.get(k) || { x: 0, y: 0, px: 0, py: 0, n: 0 }; c.x += p[3]; c.y += p[4]; c.px += p[0]; c.py += p[1]; c.n++; cells.set(k, c); }
    const S = [...cells.values()].map((c) => ({ x: c.x / c.n, y: c.y / c.n, px: c.px / c.n, py: c.py / c.n, n: c.n }));
    const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const tour = [0], left = new Set(S.map((_, i) => i).slice(1));
    while (left.size) { const last = S[tour[tour.length - 1]]; let bi = -1, bd = Infinity; for (const i of left) { const dd = d(last, S[i]); if (dd < bd) { bd = dd; bi = i; } } tour.push(bi); left.delete(bi); }
    let improved = true, guard = 0;
    while (improved && guard++ < 50) {
      improved = false;
      for (let i = 0; i < tour.length - 1; i++) for (let j = i + 2; j < tour.length; j++) {
        const a = S[tour[i]], b = S[tour[i + 1]], c = S[tour[j]], e = S[tour[(j + 1) % tour.length]];
        if (d(a, c) + d(b, e) < d(a, b) + d(c, e) - 0.01) { tour.splice(i + 1, j - i, ...tour.slice(i + 1, j + 1).reverse()); improved = true; }
      }
    }
    const ring = [...tour, tour[0]].map((i) => S[i]);
    let len = 0; for (let i = 0; i < ring.length - 1; i++) len += d(ring[i], ring[i + 1]);
    const ride = (len * A.WALK_DETOUR) / state.speed;
    L.polyline(ring.map((s) => A.ll(s.px, s.py)), { color: "#120e09", weight: 6, opacity: 0.6, interactive: false }).addTo(loopLayer);
    L.polyline(ring.map((s) => A.ll(s.px, s.py)), { color: "#7dff9a", weight: 3, dashArray: "6 6" }).addTo(loopLayer);
    A.map.fitBounds(L.latLngBounds(ring.map((s) => A.ll(s.px, s.py))).pad(0.15));
    // the stop nearest your start is where the loop begins
    let entry = S[tour[0]];
    if (state.A) { const tr = A.tree(state.A, { hearth: true }); let bc = Infinity; for (const s of S) { const ep = { name: "", px: s.px, py: s.py, map: Z[z].map, wx: s.x, wy: s.y, zone: z }; const c = tr.costTo(ep); if (c < bc) { bc = c; entry = s; entry.c = c; } } }
    const el = root.querySelector("#gloop");
    el.innerHTML = `<label class="f">Loop in ${esc(Z[z].name)}</label>
      <div class="seg" id="glsize" style="margin-bottom:6px"><button data-v="tight" class="${loopSize === "tight" ? "on" : ""}">Densest patch</button><button data-v="zone" class="${loopSize === "zone" ? "on" : ""}">Whole zone</button></div>
      <div class="total">${fmt(ride)}</div>
      <div class="hint">${Math.round(len).toLocaleString()} yd past ${S.length} spots (${pts.length} spawn points) at your ground speed, not counting stops to gather. If a third of the spawns are up, that's about ${Math.round(pts.length / 3)} nodes a lap, or ${Math.round((pts.length / 3) * 3600 / (ride + (pts.length / 3) * GATHER_S))} an hour with ${GATHER_S} s per node. The loop is straight lines, so it doesn't know about cliffs.</div>
      ${state.A ? `<div class="row" style="margin-top:6px"><span class="hint">Nearest spot to your start: ${entry.c != null ? fmt(entry.c) : "?"} away.</span><button class="btn" id="ggo">Route me there</button></div>` : `<p class="hint">Set a start on the Route tab to be routed to the loop.</p>`}`;
    el.querySelector("#glsize").addEventListener("click", (e) => { if (e.target.dataset.v) { loopSize = e.target.dataset.v; store.set("gLoop", loopSize); showLoop(sel); } });
    const go = el.querySelector("#ggo");
    if (go) go.addEventListener("click", () => { A.setEnd("B", { name: `${Z[z].name} gathering loop`, px: entry.px, py: entry.py, map: Z[z].map, wx: entry.x, wy: entry.y, zone: z }); A.setTab("route"); });
    window.AtlasGather.lastLoop = { zone: z, len, stops: S.length, spawns: pts.length };
  }
  A.on("settings", draw); A.on("tab", draw);
  window.AtlasGather = { draw };
})();
