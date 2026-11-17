/* Dungeons tab: pick a dungeon, see the quests for it you can pick up outside, and get the fastest run that
   collects them and ends at the entrance. Quests are those Questie files under the dungeon (Forever's QuestieDB);
   entrances are Forever's own placements from the same database. */
(function () {
  const A = window.Atlas, { X, Z, esc, fmt, state, store } = A;
  const MAX_GIVERS = 9;   // stops in one pickup run; the exact order search grows as 2^n
  const root = document.getElementById("dungeons");
  const layer = L.layerGroup().addTo(A.map);
  let cur = store.get("dungeon", null), picked = null;
  const median = (d) => { const l = d.q.map((q) => q.l).filter((x) => x > 0).sort((a, b) => a - b); return l.length ? l[Math.floor(l.length / 2)] : 99; };
  const list = () => [...X.dungeons].sort((a, b) => median(a) - median(b) || a.n.localeCompare(b.n));
  const mine = (d) => d.q.filter((q) => q.f.includes(state.fac));
  // a quest you can take now: level requirement met, a giver outside, and no earlier quest needed
  const takeable = (q) => q.r <= state.level && q.g.length && !q.pre.length;

  function render(body) {
    const L_ = state.level;
    root.innerHTML = `<div class="row"><select id="dsel" style="flex:1"><option value="">Pick a dungeon…</option>${list().map((d) => {
      const n = mine(d).length, m = median(d);
      return `<option value="${esc(d.n)}" ${d.n === cur ? "selected" : ""}>${esc(d.n)}${m < 99 ? ` (quests ~${m})` : ""}${n ? ` · ${n} quest${n > 1 ? "s" : ""}` : ""}</option>`;
    }).join("")}</select></div>
      <p class="hint">Your level: <b style="color:var(--ink)">${L_}</b> (set it on the Level tab or load your character). Ticked quests are the ones you can take now; untick any you've done.</p>
      <div id="dres">${body || ""}</div>`;
    root.querySelector("#dsel").addEventListener("change", (e) => { cur = e.target.value || null; store.set("dungeon", cur); picked = null; draw(); });
  }
  function draw() {
    layer.clearLayers();
    if (state.tab !== "dungeons") return;
    const d = X.dungeons.find((x) => x.n === cur);
    if (!d) return render();
    const qs = mine(d);
    if (!picked) picked = new Set(qs.filter(takeable).map((q) => q.id));
    for (const e of d.e) L.marker(A.ll(e.px, e.py), { icon: L.divIcon({ className: "", html: `<div class="stop-pin" style="background:#c084fc">☠</div>`, iconSize: [22, 22], iconAnchor: [11, 11] }) }).bindTooltip(`<b>${esc(d.n)}</b> entrance`).addTo(layer);
    const lvl = (q) => `<span class="lv" style="background:${q.l > state.level + 4 ? "#ff3b3b" : q.l > state.level + 2 ? "#ff8c2a" : q.l >= state.level - 2 ? "#ffe14a" : "#4cd964"}">${q.l}</span>`;
    const why = (q) => !q.g.length ? (q.item ? "starts from an item you find" : "no quest giver on record") : q.r > state.level ? `needs level ${q.r}` : q.pre.length ? `needs ${q.pre.map((p) => esc(p[1])).join(" / ")} first` : "";
    const rows = qs.map((q) => `<li><input type="checkbox" data-q="${q.id}" ${picked.has(q.id) ? "checked" : ""} ${q.g.length ? "" : "disabled"}>${lvl(q)}<span class="grow">${esc(q.n)}<br><small class="hint">${q.g.length ? esc(q.g[0].n) + " · " + esc(Z[q.g[0].z].name) : ""}${why(q) ? (q.g.length ? " · " : "") + why(q) : ""}</small></span></li>`).join("");
    // pickup run: one stop per giver, ending at the entrance
    const givers = new Map();
    for (const q of qs) if (picked.has(q.id) && q.g.length) { const g = q.g[0], k = `${g.x}:${g.y}`; (givers.get(k) || givers.set(k, { g, qs: [] }).get(k)).qs.push(q); }
    let runHtml = "";
    if (!state.A) runHtml = `<p class="hint">Set your start on the Route tab (or click the map) to plan the pickup run.</p>`;
    else if (!givers.size) runHtml = d.e.length ? `<p class="hint">No quests ticked: here is the way to the entrance.</p>` : "";
    let stops = [...givers.values()];
    const startTree = state.A ? A.tree(state.A, { hearth: true }) : null;
    if (startTree && stops.length > MAX_GIVERS) {
      stops.sort((a, b) => startTree.costTo(A.rowEndpoint(a.g, a.g.n)) - startTree.costTo(A.rowEndpoint(b.g, b.g.n)));
      runHtml += `<p class="hint">${stops.length} quest givers: planning the ${MAX_GIVERS} nearest.</p>`; stops = stops.slice(0, MAX_GIVERS);
    }
    if (startTree) {
      let best = null;
      for (const e of d.e) {
        const end = A.rowEndpoint(e, `${d.n} entrance`);
        const R = stops.length ? A.planTrip(state.A, stops.map((s) => [{ ep: A.rowEndpoint(s.g, s.g.n), s }]), end, startTree) : (() => { const p = startTree.pathTo(end); return p && { total: p.total, order: [], flat: [], legs: [{ S: A.steps(p.legs), t: p.total }] }; })();
        if (R && (!best || R.total < best.total)) best = R;
      }
      if (best) {
        const bounds = []; for (const l of best.legs) A.drawSteps(layer, l.S, bounds);
        best.order.forEach((a, i) => { const g = best.flat[a].s.g; L.marker(A.ll(g.px, g.py), { icon: L.divIcon({ className: "", html: `<div class="stop-pin">${i + 1}</div>`, iconSize: [22, 22], iconAnchor: [11, 11] }), zIndexOffset: 900 }).bindTooltip(`<b>${esc(g.n)}</b><br><small>${best.flat[a].s.qs.map((q) => esc(q.n)).join("<br>")}</small>`).addTo(layer); });
        runHtml += `<label class="f">Pickup run, ending at the entrance</label><div class="total">${fmt(best.total)}</div>
          ${best.legs.map((l, i) => `<div style="margin-top:8px"><div class="row"><span class="num-badge">${i < best.order.length ? i + 1 : "☠"}</span><b>${i < best.order.length ? esc(best.flat[best.order[i]].s.g.n) : esc(d.n) + " entrance"}</b><span class="t">${fmt(l.t)}</span></div>
            <div class="hint" style="margin-left:30px">${i < best.order.length ? best.flat[best.order[i]].s.qs.map((q) => esc(q.n)).join(" · ") : ""}</div><div style="margin-left:30px">${A.stepsHtml(l.S)}</div></div>`).join("")}
          ${A.waysHtml(best.legs.flatMap((l) => l.S))}`;
        if (bounds.length) A.map.fitBounds(L.latLngBounds(bounds).pad(0.15), { maxZoom: 2.5 });
        window.AtlasDungeons.last = { total: best.total, stops: best.order.length };
      }
    }
    render(`<label class="f">${esc(d.n)} quests (${qs.length})</label>${qs.length ? `<ul class="list">${rows}</ul>` : `<p class="hint">No quests filed under this dungeon for ${state.fac === "A" ? "Alliance" : "Horde"}.</p>`}${runHtml}`);
    root.querySelectorAll("input[data-q]").forEach((cb) => cb.addEventListener("change", () => { cb.checked ? picked.add(+cb.dataset.q) : picked.delete(+cb.dataset.q); draw(); }));
  }
  A.clickHandlers.dungeons = (ep) => { if (ep) { A.setEnd("A", ep); draw(); } };
  A.on("settings", () => { picked = null; draw(); }); A.on("tab", draw);
  window.AtlasDungeons = { draw, select: (n) => { cur = n; picked = null; store.set("dungeon", n); draw(); } };
})();
