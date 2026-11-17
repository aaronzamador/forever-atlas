/* Level tab: quest hubs that suit your level, sized by how many quests there are worth doing now,
   with travel time from your start. Quests come from Forever's Questie database (class and profession
   quests and quests started by items are left out). */
(function () {
  const A = window.Atlas, { X, Z, esc, fmt, state, store } = A;
  const root = document.getElementById("level");
  const layer = L.layerGroup().addTo(A.map);
  let sortBy = store.get("levelSort", "count");

  // classic quest colours: grey gives no XP, red is too hard
  const greyBelow = (L_) => (L_ <= 5 ? 0 : L_ <= 39 ? L_ - Math.floor(L_ / 10) - 5 : L_ - Math.floor(L_ / 5) - 1);
  function colour(ql, L_) {
    const d = ql - L_;
    if (d >= 5) return "#ff3b3b"; if (d >= 3) return "#ff8c2a"; if (d >= -2) return "#ffe14a"; if (ql > greyBelow(L_)) return "#4cd964"; return "#9a9a9a";
  }
  const worth = (q, L_) => q[2] > greyBelow(L_) && q[2] <= L_ + 3 && q[3] <= L_ && q[4].includes(state.fac);

  function scored() {
    const L_ = state.level;
    return X.hubs.map((h) => {
      const qs = h.q.filter((q) => worth(q, L_));
      return { h, qs, n: qs.length };
    }).filter((r) => r.n > 0);
  }
  function popup(r) {
    const L_ = state.level, el = document.createElement("div");
    const all = r.h.q.filter((q) => q[4].includes(state.fac));
    el.innerHTML = `<b>${esc(r.h.n)}</b><br><small>${esc(Z[r.h.z].name)} · ${r.n} quest${r.n === 1 ? "" : "s"} worth doing at level ${L_} (of ${all.length} here)</small>
      <ul class="pq">${all.map((q) => `<li style="opacity:${worth(q, L_) ? 1 : 0.5}"><span class="lv" style="background:${colour(q[2], L_)}">${q[2]}</span>${esc(q[1])}${q[3] > L_ ? ` <small>(needs ${q[3]})</small>` : ""}</li>`).join("")}</ul>
      <div class="row"><button class="btn" data-go>Route here</button></div>`;
    el.querySelector("[data-go]").addEventListener("click", () => { A.setEnd("B", A.rowEndpoint(r.h, r.h.n)); A.setTab("route"); A.map.closePopup(); });
    L.popup({ maxWidth: 320 }).setLatLng(A.ll(r.h.px, r.h.py)).setContent(el).openOn(A.map);
  }
  function draw() {
    layer.clearLayers();
    if (state.tab !== "level") return;
    const L_ = state.level, rows = scored();
    const tr = state.A ? A.tree(state.A, { hearth: true }) : null;
    for (const r of rows) r.t = tr ? tr.costTo(A.rowEndpoint(r.h, r.h.n)) : null;
    for (const r of rows) {
      const avg = r.qs.reduce((a, q) => a + q[2], 0) / r.n;
      L.circleMarker(A.ll(r.h.px, r.h.py), { radius: 3 + Math.sqrt(r.n) * 2.2, color: "#120e09", weight: 1.5, fillColor: colour(Math.round(avg), L_), fillOpacity: 0.85 })
        .bindTooltip(`<b>${esc(r.h.n)}</b><br><small>${r.n} quests · ${esc(Z[r.h.z].name)}${r.t != null && isFinite(r.t) ? " · " + fmt(r.t) + " away" : ""}</small>`)
        .on("click", (e) => { L.DomEvent.stop(e); popup(r); }).addTo(layer);
    }
    // zone totals
    const zones = {}; for (const r of rows) zones[r.h.z] = (zones[r.h.z] || 0) + r.n;
    const topZones = Object.entries(zones).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const list = [...rows].sort((a, b) => (sortBy === "near" && tr ? a.t - b.t : b.n - a.n || a.t - b.t)).slice(0, 15);
    root.innerHTML = `
      <div class="row"><label class="f" style="margin:0">Your level</label><input class="num" id="lvl" type="number" min="1" max="60" value="${L_}">
        <div class="seg" id="lsort"><button data-v="count">Most quests</button><button data-v="near">Nearest</button></div></div>
      <p class="hint">A quest counts if it still gives XP at your level, is no more than 3 levels above you, and you meet its level requirement. Dot size is how many there are. Colour is their average difficulty.${state.A ? "" : " Set a start on the Route tab to see travel times."}</p>
      <label class="f">Best zones at level ${L_}</label>
      <div class="hint">${topZones.map(([z, n]) => `${esc(Z[z].name)} <b style="color:var(--ink)">${n}</b>`).join(" · ") || "None found."}</div>
      <label class="f">Quest hubs</label>
      <ul class="list">${list.map((r, i) => `<li class="click" data-i="${rows.indexOf(r)}"><span class="lv" style="background:${colour(Math.round(r.qs.reduce((a, q) => a + q[2], 0) / r.n), L_)}">${r.n}</span>
        <span class="grow">${esc(r.h.n)}<br><small class="hint">${esc(Z[r.h.z].name)} · levels ${Math.min(...r.qs.map((q) => q[2]))}–${Math.max(...r.qs.map((q) => q[2]))}</small></span>
        <span class="t">${r.t != null && isFinite(r.t) ? fmt(r.t) : ""}</span></li>`).join("")}</ul><div id="lplan" style="margin-top:12px"></div>`;
    planUI();
    root.querySelectorAll("#lsort button").forEach((b) => b.classList.toggle("on", b.dataset.v === sortBy));
    root.querySelector("#lvl").addEventListener("change", (e) => { const v = Math.max(1, Math.min(60, +e.target.value || 1)); state.level = v; store.set("level", v); draw(); });
    root.querySelector("#lsort").addEventListener("click", (e) => { if (e.target.dataset.v) { sortBy = e.target.dataset.v; store.set("levelSort", sortBy); draw(); } });
    root.querySelectorAll("li[data-i]").forEach((li) => li.addEventListener("click", () => { const r = rows[+li.dataset.i]; A.map.setView(A.ll(r.h.px, r.h.py), Math.max(A.map.getZoom(), 2)); popup(r); }));
  }
  // ---------- levelling plan ----------
  // XP to go from level L to L+1. NOT in Forever's client data: the classic table, from recall (flagged on the page).
  const XP_TO_NEXT = [0, 400, 900, 1400, 2100, 2800, 3600, 4500, 5400, 6500, 7600, 8800, 10100, 11400, 12900, 14400, 16000, 17700, 19400, 21300, 23200,
    25200, 27300, 29400, 31700, 34000, 36400, 38900, 41400, 44300, 47400, 50800, 54500, 58600, 62800, 67100, 71600, 76100, 80800, 85700, 90700,
    95800, 101000, 106300, 111800, 117500, 123200, 129100, 135100, 141200, 147500, 153900, 160400, 167100, 173900, 180800, 187900, 195000, 202300, 209800];
  // Questie's own XP rule for this client (Questie/Database/QuestXP/QuestieXP.lua getAdjustedXP)
  function adjXP(xp, ql, L_) {
    let m = 2 * (ql - L_) + 20; m = Math.max(1, Math.min(10, m)); xp = (xp * m) / 10;
    return xp <= 100 ? 5 * Math.floor((xp + 2) / 5) : xp <= 500 ? 10 * Math.floor((xp + 5) / 10) : xp <= 1000 ? 25 * Math.floor((xp + 12) / 25) : 50 * Math.floor((xp + 25) / 50);
  }
  const planLayer = L.layerGroup().addTo(A.map);
  const plannable = new Map(); for (const h of X.hubs) for (const q of h.q) if (q[5] > 0) plannable.set(q[0], q[2]);   // quest id -> level
  function plan(target, questMin, maxSteps = 60) {
    if (!state.A) return null;
    const QS = questMin * 60;
    let pos = state.A, L_ = state.level, xp = 0, t = 0;
    const done = new Set(), steps = [];
    // a prerequisite is met when the plan did it, when it is below the level the plan starts at (taken as done
    // already), or when no hub offers it (item-started, class or other quests the plan cannot schedule)
    const startL = L_;
    const preMet = (p) => done.has(p) || !plannable.has(p) || plannable.get(p) < startL;
    while (L_ < target && steps.length < maxSteps) {
      const tr = A.tree(pos, { hearth: false });
      let best = null;
      for (const h of X.hubs) {
        const qs = h.q.filter((q) => !done.has(q[0]) && q[4].includes(state.fac) && q[5] > 0 && q[3] <= L_ && q[2] > greyBelow(L_) && q[2] <= L_ + 3 && q[6].every(preMet));
        if (!qs.length) continue;
        const gain = qs.reduce((a, q) => a + adjXP(q[5], q[2], L_), 0);
        const travel = tr.costTo(A.rowEndpoint(h, h.n)); if (!isFinite(travel)) continue;
        const time = travel + qs.length * QS, score = gain / time;
        if (!best || score > best.score) best = { h, qs, gain, travel, time, score };
      }
      if (!best) break;
      const from = L_;
      xp += best.gain; t += best.time; best.qs.forEach((q) => done.add(q[0]));
      while (L_ < 60 && xp >= XP_TO_NEXT[L_]) { xp -= XP_TO_NEXT[L_]; L_++; }
      steps.push({ ...best, from, to: L_, xpInto: xp, t });
      pos = A.rowEndpoint(best.h, best.h.n);
    }
    return { steps, reached: L_, t };
  }
  function drawPlan(P) {
    planLayer.clearLayers();
    if (!P || !P.steps.length) return;
    const pts = [A.ll(state.A.px, state.A.py), ...P.steps.map((s) => A.ll(s.h.px, s.h.py))];
    L.polyline(pts, { color: "#120e09", weight: 6, opacity: 0.5, interactive: false }).addTo(planLayer);
    L.polyline(pts, { color: "#ffe14a", weight: 3, dashArray: "5 7" }).addTo(planLayer);
    P.steps.forEach((s, i) => L.marker(A.ll(s.h.px, s.h.py), { icon: L.divIcon({ className: "", html: `<div class="stop-pin">${i + 1}</div>`, iconSize: [22, 22], iconAnchor: [11, 11] }), zIndexOffset: 900 })
      .bindTooltip(`<b>${i + 1}. ${esc(s.h.n)}</b><br><small>${s.qs.length} quests · level ${s.from} → ${s.to}</small>`).addTo(planLayer));
    A.map.fitBounds(L.latLngBounds(pts).pad(0.1));
  }
  function planUI() {
    const el = document.getElementById("lplan"); if (!el) return;
    const target = store.get("planTarget", Math.min(60, state.level + 10)), qm = store.get("planQuestMin", 5);
    el.innerHTML = `<label class="f">Levelling plan</label>
      <div class="row"><span class="hint">From ${state.level} to</span><input class="num" id="ptarget" type="number" min="2" max="60" value="${target}">
        <span class="hint">minutes per quest</span><input class="num" id="pqm" type="number" min="1" max="30" value="${qm}"><button class="btn primary" id="pgo">Plan</button></div>
      <div id="pout"></div>`;
    el.querySelector("#pgo").addEventListener("click", () => {
      const tg = Math.max(state.level + 1, Math.min(60, +el.querySelector("#ptarget").value || 60)), m = Math.max(1, +el.querySelector("#pqm").value || 5);
      store.set("planTarget", tg); store.set("planQuestMin", m);
      const out = el.querySelector("#pout");
      if (!state.A) { out.innerHTML = `<p class="hint">Set your start on the Route tab first.</p>`; return; }
      const t0 = performance.now(), P = plan(tg, m); drawPlan(P); window.AtlasLevel.lastPlan = P;
      out.innerHTML = `<div class="total">${P.reached >= tg ? "" : "Reaches level " + P.reached + ": "}${fmt(P.t)}</div>
        <p class="hint">Picks, at each step, the hub that gives the most XP per minute (travel + ${m} min a quest), using Questie's XP per quest and its rule for lower-level quests. It counts quest XP only, not kills, so real levelling is faster. XP needed per level is the classic table (Forever's isn't in the game data). ${P.steps.reduce((a, s) => a + s.qs.filter((q) => q[7]).length, 0)} quests use an XP estimated from their level. Planned in ${Math.round(performance.now() - t0)} ms.</p>
        <ul class="list">${P.steps.map((s, i) => `<li class="click" data-s="${i}"><span class="num-badge">${i + 1}</span><span class="grow">${esc(s.h.n)} <small class="hint">· ${esc(Z[s.h.z].name)}</small><br>
          <small class="hint">${s.qs.length} quests (${s.qs.slice(0, 4).map((q) => esc(q[1])).join(", ")}${s.qs.length > 4 ? "…" : ""}) · level ${s.from}${s.to > s.from ? " → " + s.to : ""} · ${fmt(s.travel)} travel</small></span><span class="t">${fmt(s.t)}</span></li>`).join("")}</ul>`;
      out.querySelectorAll("li[data-s]").forEach((li) => li.addEventListener("click", () => { const s = P.steps[+li.dataset.s]; A.map.setView(A.ll(s.h.px, s.h.py), Math.max(A.map.getZoom(), 2)); }));
    });
  }
  A.on("settings", draw); A.on("tab", () => { if (state.tab !== "level") planLayer.clearLayers(); draw(); });
  window.AtlasLevel = { draw, worth, greyBelow, plan, adjXP };
})();
