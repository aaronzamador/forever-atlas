/* Find tab: where do I get an item. Every known source (vendors, mob drops, gathering nodes and chests, quest
   rewards, crafting, containers) ranked by time from your start, with a route to the one you pick.
   Data: items.js (build/build_items.py). */
(function () {
  const A = window.Atlas, I = window.WOWITEMS, { Z, esc, fmt, state, store } = A;
  const GATHER = new Set(window.WOWEXTRAS.gather.map((g) => g.n));   // herb and ore node names
  const KILL_S = 20;   // seconds per kill when estimating farm time for a drop (an assumption, shown on the page)
  const root = document.getElementById("find");
  const layer = L.layerGroup().addTo(A.map), routeLayer = L.layerGroup().addTo(A.map);
  const COL = { v: "#4cd964", d: "#ff5f5f", o: "#5fd0ff", q: "#ffe14a" };
  const WORD = { v: "Buy", d: "Drop", o: "Gather / loot", q: "Quest reward" };
  const itemList = Object.entries(I.items).map(([id, e]) => ({ id: +id, label: e.n, sub: [e.v && "sold", e.d && "drops", e.o && "gathered/looted", e.q && "quest reward", e.r && "crafted", e.c && "in a container"].filter(Boolean).join(", "), ep: null }));
  let current = store.get("findItem", null), picked = null;
  const nameOf = (id) => (I.items[id] ? I.items[id].n : I.names[id] || "item " + id);
  const ptEp = (p, name) => ({ name, px: p[0], py: p[1], map: A.Z[p[2]].map, wx: p[3], wy: p[4], zone: String(p[2]) });

  function rows(e, tr) {
    const out = [];
    const best = (pts, name) => { let bc = Infinity, bp = pts[0]; if (tr) for (const p of pts) { const c = tr.costTo(ptEp(p, name)); if (c < bc) { bc = c; bp = p; } } return { t: tr ? bc : null, p: bp }; };
    for (const n of e.v || []) { const N = I.npcs[n]; if (!N || (N[3] && !N[3].includes(state.fac))) continue; const b = best(N[6], N[0]); out.push({ k: "v", name: N[0], sub: `${N[7] ? "Darkmoon Faire, only when it's in town" : N[5] || "Vendor"} · ${Z[b.p[2]].name}`, t: b.t, p: b.p, all: N[6], event: !!N[7] }); }
    for (const [n, rate] of e.d || []) {
      const N = I.npcs[n]; if (!N) continue; const b = best(N[6], N[0]);
      const lv = N[1] ? (N[1] === N[2] ? `level ${N[1]}` : `levels ${N[1]}–${N[2]}`) : "";
      const farm = rate ? (100 / rate) * KILL_S : null;
      out.push({ k: "d", name: N[0], sub: `${lv}${N[4] ? " elite" : ""} · ${Z[b.p[2]].name}${rate ? ` · ${rate < 1 ? rate.toFixed(2) : rate.toFixed(1)}% drop` : " · drop rate unknown"}`, t: b.t, farm, p: b.p, all: N[6] });
    }
    for (const n of e.o || []) {
      const O = I.objs[n]; if (!O) continue; const b = best(O[1], O[0]);
      const node = GATHER.has(O[0].replace(/^Ooze Covered /, ""));   // a herb or ore node always yields; a chest is random loot
      out.push({ k: "o", name: O[0], sub: `${node ? "gathering node" : "random loot, not guaranteed"} · ${O[1].length} spawn point${O[1].length > 1 ? "s" : ""} shown · ${Z[b.p[2]].name}`, t: b.t, p: b.p, all: O[1], chance: !node });
    }
    for (const n of e.q || []) {
      const Q = I.quests[n]; if (!Q) continue;
      const st = Q[3] && (Q[3][0] === "n" ? I.npcs[Q[3][1]] : I.objs[Q[3][1]]);
      if (st && Q[3][0] === "n" && st[3] && !st[3].includes(state.fac)) continue;
      const pts = st ? (Q[3][0] === "n" ? st[6] : st[1]) : null, b = pts ? best(pts, st[0]) : { t: null, p: null };
      out.push({ k: "q", name: Q[0], sub: `level ${Q[1]} quest${st ? ` from ${st[0]} · ${Z[b.p[2]].name}` : ""}`, t: b.t, p: b.p, all: pts || [] });
    }
    return out;
  }
  function show(id) {
    layer.clearLayers(); routeLayer.clearLayers();
    current = id; store.set("findItem", id);
    const e = I.items[id]; if (!e) return render();
    const tr = state.A ? A.tree(state.A, { hearth: true }) : null;
    const R = rows(e, tr);
    // the full cost of a source: travel, plus farming time for a drop (if the rate is known). A quest reward's
    // time is only the way to its quest giver, and an event vendor may not be there: neither can be the best bet.
    // Only a source with a predictable yield can be the best bet: a vendor that's always there, a gathering node,
    // or a mob whose drop rate is known (farm time added). Chests and unknown-rate drops are listed, never best.
    const total = (r) => (r.t == null || r.k === "q" || r.event || r.chance ? Infinity : r.t + (r.k === "d" ? (r.farm ?? Infinity) : 0));
    const ranked = [...R].sort((a, b) => total(a) - total(b) || (a.t ?? 1e9) - (b.t ?? 1e9));
    for (const r of R) for (const p of r.all) L.circleMarker(A.ll(p[0], p[1]), { radius: 4, color: "#120e09", weight: 1, fillColor: COL[r.k], fillOpacity: 0.9 }).bindTooltip(`<b>${esc(r.name)}</b><br><small>${WORD[r.k]}</small>`).addTo(layer);
    const best = ranked.find((r) => isFinite(total(r)));
    const recipeHtml = (e.r || []).map((r) => `<li><span class="grow"><b>${esc(r[0])}</b>: ${esc(r[1])}${r[2] ? ` <small class="hint">(learn at skill ${r[2]})</small>` : ""}<br><small class="hint">Needs ${r[3].map(([i, c]) => `${c}× <button class="link" data-item="${i}">${esc(nameOf(i))}</button>`).join(", ")}</small></span></li>`).join("");
    const contHtml = (e.c || []).map((i) => `<button class="link" data-item="${i}">${esc(nameOf(i))}</button>`).join(", ");
    const group = (k) => { const g = ranked.filter((r) => r.k === k); if (!g.length) return ""; return `<label class="f">${WORD[k]} (${g.length})</label><ul class="list">${g.slice(0, 12).map((r) => `<li class="click" data-r="${R.indexOf(r)}"><span class="lv" style="background:${COL[r.k]}">&nbsp;</span><span class="grow">${esc(r.name)}<br><small class="hint">${esc(r.sub)}</small></span><span class="t">${r.t != null && isFinite(r.t) ? fmt(r.t) : ""}${r.k === "d" && r.farm ? `<br><small class="hint">+${fmt(r.farm)} farm</small>` : ""}</span></li>`).join("")}</ul>`; };
    render(`<div class="total" style="font-size:20px">${esc(e.n)}</div>
      ${best ? `<div class="hint">Best bet: <b style="color:var(--ink)">${WORD[best.k].toLowerCase()} — ${esc(best.name)}</b>, ${fmt(total(best))}${best.k === "d" ? ` including about ${Math.round(best.farm / KILL_S)} kills at ${KILL_S} s each` : " away"}.</div>` : state.A ? `<div class="hint">${R.length || e.r || e.c ? `Nothing to buy, gather or farm at a known rate, so there's no best bet. ${e.r ? "It can be crafted. " : ""}The other sources are below.` : `No source for ${state.fac === "A" ? "Alliance" : "Horde"}.`}</div>` : `<div class="hint">Set a start on the Route tab to rank these by time.</div>`}
      ${group("v")}
      ${recipeHtml ? `<label class="f">Craft</label><ul class="list">${recipeHtml}</ul>` : ""}
      ${group("o")}${group("d")}${group("q")}
      ${contHtml ? `<label class="f">Found inside</label><div class="hint">${contHtml}</div>` : ""}
      ${!R.length && !recipeHtml && !contHtml ? `<p class="hint">No source on record.</p>` : ""}
      <div id="froute"></div>`);
    root.querySelectorAll("li[data-r]").forEach((li) => li.addEventListener("click", () => routeTo(R[+li.dataset.r])));
    if (best && best.p) routeTo(best, true); else if (R.length) A.map.fitBounds(L.latLngBounds(R.flatMap((r) => r.all.map((p) => A.ll(p[0], p[1])))).pad(0.1));
  }
  function routeTo(r, quiet) {
    routeLayer.clearLayers();
    if (!r.p) return;
    const ep = ptEp(r.p, r.name);
    L.circleMarker(A.ll(r.p[0], r.p[1]), { radius: 8, color: "#fff", weight: 2, fillColor: COL[r.k], fillOpacity: 1 }).addTo(routeLayer);
    const el = root.querySelector("#froute");
    if (!state.A) { A.map.setView(A.ll(r.p[0], r.p[1]), 2); el.innerHTML = ""; return; }
    const p = A.solve(state.A, ep, { hearth: true }); if (!p) return;
    const S = A.steps(p.legs), b = [];
    A.drawSteps(routeLayer, S, b);
    el.innerHTML = `<label class="f">Route to ${esc(r.name)}</label><div class="total">${fmt(p.total)}</div>${A.stepsHtml(S)}
      <div class="row" style="margin-top:6px"><button class="btn" id="fgo">Open on the Route tab</button></div>${A.waysHtml(S)}`;
    A.wireSteps(el, S);
    el.querySelector("#fgo").addEventListener("click", () => { A.setEnd("B", ep); A.setTab("route"); });
    if (b.length) A.map.fitBounds(L.latLngBounds(b).pad(0.15), { maxZoom: 2.5 });
    if (!quiet) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  function render(body) {
    root.innerHTML = `<div class="ep sugg"><input id="fq" placeholder="Item name, e.g. Mageroyal, Linen Cloth…" autocomplete="off"><ul id="fs" hidden></ul></div>
      <p class="hint">${state.A ? `Times are from your start: <b style="color:var(--ink)">${esc(state.A.name)}</b>.` : "Set a start on the Route tab (or click the map) to rank sources by time."} Drop sources add farming time at ${KILL_S} s a kill. Mobs that drop common loot like cloth to any humanoid aren't listed: no data file has them.</p>
      <div id="fres">${body || ""}</div>`;
    A.suggest(root.querySelector("#fq"), root.querySelector("#fs"), () => itemList, (r) => show(r.id));
    root.querySelectorAll("[data-item]").forEach((b) => b.addEventListener("click", () => show(+b.dataset.item)));
  }
  function draw() { layer.clearLayers(); routeLayer.clearLayers(); if (state.tab !== "find") return; current ? show(current) : render(); }
  A.clickHandlers.find = (ep) => { if (ep) { A.setEnd("A", ep); draw(); } };
  A.on("settings", draw); A.on("tab", draw);
  window.AtlasFind = { show, rows };
})();
