/* Errands tab: a list of stops (a kind of NPC, or a specific place). It chooses which NPC of each kind and
   the order that makes the whole trip fastest: exact search over orders (Held-Karp) and over the best few
   candidates of each kind. */
(function () {
  const A = window.Atlas, { X, Z, esc, fmt, state, store } = A;
  const MAX_STOPS = 7, K_START = 7, K_NEAR = 2;
  const root = document.getElementById("errands");
  const layer = L.layerGroup().addTo(A.map);
  let stops = store.get("errands", []);          // [{c: category} | {ep, label}]
  let finish = store.get("errandsFinish", "any"); // any | start | B

  const CLASSES = ["Warrior", "Paladin", "Hunter", "Rogue", "Priest", "Shaman", "Mage", "Warlock", "Druid"];
  const PROFS = ["Alchemy", "Blacksmithing", "Enchanting", "Engineering", "Herbalism", "Leatherworking", "Mining", "Skinning", "Tailoring", "Cooking", "First Aid", "Fishing"];
  function catOptions() {
    const cls = state.cls ? [state.cls, ...CLASSES.filter((c) => c !== state.cls)] : CLASSES;
    const og = (label, cs) => `<optgroup label="${label}">${cs.map((c) => `<option value="${c}">${esc(A.SVC_WORD(c))}</option>`).join("")}</optgroup>`;
    return `<option value="">Add a stop…</option>` +
      og("Services", ["bank", "auction", "mail", "inn", "repair", "stable", "weaponmaster"]) +
      og("Class trainer", cls.map((c) => "trainer:" + c)) +
      og("Profession trainer", PROFS.map((p) => "prof:" + p)) +
      og("Vendors", ["vendor:food", "vendor:reagent", "vendor:general", "vendor:trade", "vendor:ammo", "vendor:fishing"]);
  }
  const save = () => { store.set("errands", stops); store.set("errandsFinish", finish); };
  const label = (s) => s.c ? A.SVC_WORD(s.c) : s.label;

  function render(result) {
    const startTxt = state.A ? esc(state.A.name) : `<i>not set: click the map where you are</i>`;
    root.innerHTML = `
      <div class="hint">Start: <b style="color:var(--ink)">${startTxt}</b>. In this tab a map click moves the start.</div>
      <label class="f">Stops (${stops.length}/${MAX_STOPS}). The order is worked out for you.</label>
      <ul class="list">${stops.map((s, i) => `<li><span class="num-badge">${i + 1}</span><span class="grow">${esc(label(s))}</span><button class="x" data-del="${i}" title="Remove">✕</button></li>`).join("") || `<li class="hint">No stops yet.</li>`}</ul>
      <div class="row" style="margin-top:8px"><select id="ecat" style="flex:1">${catOptions()}</select></div>
      <div class="ep sugg" style="margin-top:6px"><input id="eq" placeholder="…or a specific NPC or place" autocomplete="off"><ul id="es" hidden></ul></div>
      <label class="f">Finish</label>
      <div class="seg" id="efin"><button data-v="any">Anywhere</button><button data-v="start">Back at start</button><button data-v="B" ${state.B ? "" : "disabled title='Set a To pin on the Route tab'"}>At the To pin</button></div>
      <div id="eres" style="margin-top:12px">${result || ""}</div>`;
    root.querySelectorAll("#efin button").forEach((b) => b.classList.toggle("on", b.dataset.v === finish));
    root.querySelector("#ecat").addEventListener("change", (e) => { if (e.target.value && stops.length < MAX_STOPS) { stops.push({ c: e.target.value }); save(); plan(); } });
    A.suggest(root.querySelector("#eq"), root.querySelector("#es"), A.placeItems, (r) => { if (stops.length < MAX_STOPS) { stops.push({ ep: r.ep, label: r.label }); save(); plan(); } });
  }
  root.addEventListener("click", (e) => {
    if (e.target.dataset.del != null) { stops.splice(+e.target.dataset.del, 1); save(); plan(); }
    if (e.target.closest("#efin") && e.target.dataset.v && !e.target.disabled) { finish = e.target.dataset.v; save(); plan(); }
  });

  function candidates(s, startTree) {
    if (s.ep) return [{ ep: s.ep, name: s.label, sub: Z[s.ep.zone].name }];
    return X.services.filter((v) => v.c === s.c && A.facOK(v.f)).map((v) => ({ ep: A.rowEndpoint(v, v.n), name: v.n, sub: `${v.s ? v.s + " · " : ""}${Z[v.z].name}`, row: v }));
  }

  /* Fastest trip from start through one candidate of every pool (pools: [[{ep, ...}, ...], ...]), in the best order,
     ending at endEp (or anywhere when null). Exact: Held-Karp over (stops visited, last candidate). */
  A.planTrip = function (start, pools, endEp, startTree) {
    startTree = startTree || A.tree(start, { hearth: true });
    const flat = []; pools.forEach((p, i) => p.forEach((c) => flat.push({ ...c, stop: i, c0: c.c0 ?? startTree.costTo(c.ep) })));
    const trees = flat.map((c) => A.tree(c.ep));
    const cost = flat.map((_, a) => flat.map((c, b) => (flat[a].stop === c.stop ? Infinity : trees[a].costTo(c.ep))));
    const endCost = flat.map((c, a) => (endEp ? trees[a].costTo(endEp) : 0));
    const n = pools.length, FULL = (1 << n) - 1, M = flat.length;
    const best = new Map(), from = new Map(), key = (mask, a) => mask * 4096 + a;
    flat.forEach((c, a) => best.set(key(1 << c.stop, a), c.c0));
    for (let mask = 1; mask <= FULL; mask++) for (let a = 0; a < M; a++) {
      const cur = best.get(key(mask, a)); if (cur == null || !(mask & (1 << flat[a].stop))) continue;
      for (let b = 0; b < M; b++) {
        const sb = 1 << flat[b].stop; if (mask & sb) continue;
        const nv = cur + cost[a][b], k = key(mask | sb, b);
        if (nv < (best.get(k) ?? Infinity)) { best.set(k, nv); from.set(k, a); }
      }
    }
    let bt = Infinity, ba = -1;
    for (let a = 0; a < M; a++) { const v = best.get(key(FULL, a)); if (v != null && v + endCost[a] < bt) { bt = v + endCost[a]; ba = a; } }
    if (ba < 0) return null;
    const order = []; for (let mask = FULL, a = ba; a != null && a >= 0; ) { order.unshift(a); const p = from.get(key(mask, a)); mask &= ~(1 << flat[a].stop); a = p; }
    const pts = [start, ...order.map((a) => flat[a].ep)]; if (endEp) pts.push(endEp);
    const legs = [];
    for (let i = 0; i < pts.length - 1; i++) { const p = (i === 0 ? startTree : trees[order[i - 1]]).pathTo(pts[i + 1]); legs.push({ S: A.steps(p.legs), t: p.total }); }
    return { total: bt, order, flat, legs };
  };
  function plan() {
    layer.clearLayers();
    if (state.tab !== "errands") return;
    if (!state.A) return render(`<span class="hint">Click the map where you are now.</span>`);
    if (!stops.length) return render(`<span class="hint">Add the places you need to visit.</span>`);
    if (finish === "B" && !state.B) finish = "any";
    const t0 = performance.now();
    const startTree = A.tree(state.A, { hearth: true });
    // candidate pools: cheapest few from the start, plus the few nearest to every other stop's best candidates
    const all = stops.map((s) => candidates(s).map((c) => ({ ...c, c0: startTree.costTo(c.ep) })).filter((c) => isFinite(c.c0)).sort((a, b) => a.c0 - b.c0));
    const empty = stops.findIndex((s, i) => !all[i].length);
    if (empty >= 0) return render(`<span class="hint">No ${esc(label(stops[empty]))} reachable for ${state.fac === "A" ? "Alliance" : "Horde"}.</span>`);
    const pools = all.map((list, i) => {
      const pick = new Set(list.slice(0, K_START));
      all.forEach((other, j) => { if (j === i) return; for (const o of other.slice(0, 3)) {
        list.filter((c) => c.ep.map === o.ep.map).sort((a, b) => Math.hypot(a.ep.wx - o.ep.wx, a.ep.wy - o.ep.wy) - Math.hypot(b.ep.wx - o.ep.wx, b.ep.wy - o.ep.wy)).slice(0, K_NEAR).forEach((c) => pick.add(c));
      } });
      return [...pick];
    });
    const R = A.planTrip(state.A, pools, finish === "start" ? state.A : finish === "B" ? state.B : null, startTree);
    if (!R) return render(`<span class="hint">Couldn't find a way to visit all of these.</span>`);
    const { order, legs, total: bt } = R, flat = R.flat, bounds = [];
    for (const l of legs) A.drawSteps(layer, l.S, bounds);
    order.forEach((a, i) => L.marker(A.ll(flat[a].ep.px, flat[a].ep.py), { icon: L.divIcon({ className: "", html: `<div class="stop-pin">${i + 1}</div>`, iconSize: [22, 22], iconAnchor: [11, 11] }), zIndexOffset: 900 })
      .bindTooltip(`<b>${esc(flat[a].name)}</b><br><small>${esc(label(stops[flat[a].stop]))} · ${esc(flat[a].sub)}</small>`).addTo(layer));
    const html = `<div class="total">${fmt(bt)}</div><div class="hint">${stops.length} stop${stops.length > 1 ? "s" : ""}, worked out in ${Math.round(performance.now() - t0)} ms</div>
      ${legs.map((L_, i) => `<div style="margin-top:10px"><div class="row"><span class="num-badge">${i < order.length ? i + 1 : "⌂"}</span>
        <b>${i < order.length ? esc(flat[order[i]].name) : finish === "start" ? "Back at start" : esc(state.B.name)}</b><span class="t">${fmt(L_.t)}</span></div>
        <div class="hint" style="margin-left:30px">${i < order.length ? esc(label(stops[flat[order[i]].stop])) + " · " + esc(flat[order[i]].sub) : ""}</div>
        <div style="margin-left:30px">${A.stepsHtml(L_.S)}</div></div>`).join("")}
      ${A.waysHtml(legs.flatMap((l) => l.S))}`;
    render(html);
    root.querySelectorAll("#eres > div").forEach((div, i) => legs[i] && A.wireSteps(div, legs[i].S));
    if (bounds.length) A.map.fitBounds(L.latLngBounds(bounds).pad(0.15), { maxZoom: 2.5 });
  }
  A.clickHandlers.errands = (ep) => { if (ep) { A.setEnd("A", ep); plan(); } };
  A.on("settings", plan); A.on("tab", plan);
  window.AtlasErrands = { plan, set: (s, f) => { stops = s; finish = f || "any"; save(); plan(); } };
})();
