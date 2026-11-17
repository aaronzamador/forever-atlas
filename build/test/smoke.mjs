// Load the page headless, exercise every tab, screenshot. Exits non-zero on a failed check.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');
const out = process.argv[2] || '.';
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--allow-file-access-from-files'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1500, height: 950 });
const errs = []; pg.on('pageerror', e => errs.push(String(e))); pg.on('console', m => m.type() === 'error' && errs.push(m.text()));
await pg.goto('file://' + new URL('../../site/index.html', import.meta.url).pathname); await new Promise(r => setTimeout(r, 1200));
await pg.evaluate(() => { localStorage.clear(); }); await pg.reload(); await new Promise(r => setTimeout(r, 1200));
let fail = 0; const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) fail++; };
const wait = (ms) => new Promise(r => setTimeout(r, ms));
await pg.screenshot({ path: out + '/overview.png' });

// ---- Route ----
const run = (fac, a, bn, opts = {}) => pg.evaluate((fac, a, bn, opts) => {
  const A = window.Atlas; A.state.fac = fac;
  const f = (n) => A.P.find(p => (p.kind === 'flight' ? p.label : p.name).startsWith(n) && (p.kind !== 'flight' || p.fac.includes(fac)));
  const pa = f(a), pb = f(bn); if (!pa || !pb) return { err: 'missing ' + (!pa ? a : bn) };
  A.setEnd('A', A.placeEndpoint(pa)); A.setEnd('B', A.placeEndpoint(pb));
  const r = A.solve(A.state.A, A.state.B, opts);
  return r && { total: Math.round(r.total), legs: A.steps(r.legs).map(s => s.type + (s.mode ? ':' + s.mode : '') + '>' + (s.to.name || s.to.kind)) };
}, fac, a, bn, opts);
const cases = [
  ['A', 'Stormwind, Elwynn', 'Ironforge, Dun Morogh', r => r.legs.some(l => l.includes('tram') || l.startsWith('fly'))],
  ['A', 'Stormwind, Elwynn', 'Theramore, Dustwallow', r => r.legs.some(l => l.includes('transport:boat'))],
  ['H', 'Orgrimmar, Durotar', 'Undercity, Tirisfal', r => r.legs.some(l => l.includes('zeppelin'))],
  ['H', 'Thunder Bluff, Mulgore', 'Gadgetzan, Tanaris', r => r.legs.some(l => l.startsWith('fly'))],
  ['A', 'Darnassus', 'Booty Bay, Stranglethorn', r => r.legs.some(l => l.includes('boat'))],
  ['A', 'Stormwind, Elwynn', 'Farholde Keep', r => r.legs.some(l => l.startsWith('fly'))],
];
const base = {};
for (const [fac, a, bb, ok] of cases) {
  const r = await run(fac, a, bb);
  base[a + bb] = r && r.total;
  check(r && !r.err && ok(r), `${fac} ${a} -> ${bb}: ${r ? (r.err || (Math.round(r.total / 6) / 10) + ' min  ' + r.legs.join(' | ')) : 'NO ROUTE'}`);
}
// a chained flight is one fly step, priced by the fitted model (base + perStop per extra leg)
const chain = await pg.evaluate(() => { const A = window.Atlas, F = A.D.flight; const s = A.steps(A.solve(A.state.A, A.state.B).legs).find(s => s.type === 'fly'); const hops = s.legs.filter(l => l.type === 'fly'); const expect = hops.reduce((a, l) => a + l.flight.len, 0) / F.speed + F.base + F.perStop * (hops.length - 1); return { got: s.t, expect, hops: hops.length }; });
check(Math.abs(chain.got - chain.expect) < 0.01, `flight step time equals the fitted model (${chain.got.toFixed(1)} vs ${chain.expect.toFixed(1)} s, ${chain.hops} legs)`);
// unknown flight point changes the route: forget Lakeshire, Stormwind -> Farholde must not fly through it
const unk = await pg.evaluate(() => { const A = window.Atlas; const lk = A.P.find(p => p.kind === 'flight' && p.label.startsWith('Lakeshire')); A.state.unknown.add(lk.id); const r = A.solve(A.state.A, A.state.B); const via = r.legs.some(l => l.to && l.to.id === lk.id && l.to.kind !== 'crossing'); A.state.unknown.delete(lk.id); return { via, total: r.total }; });
check(!unk.via, `forgetting Lakeshire keeps the route out of Lakeshire's flight master (${Math.round(unk.total)} s)`);
// hearth: bound in Theramore, Stormwind -> Theramore should hearth
const hearth = await pg.evaluate(() => { const A = window.Atlas; const f = (n) => A.P.find(p => p.kind === 'flight' && p.label.startsWith(n) && p.fac.includes('A')); A.setEnd('A', A.placeEndpoint(f('Stormwind'))); A.setEnd('B', A.placeEndpoint(f('Theramore'))); const sel = document.getElementById('hearth'); const o = [...sel.options].find(o => o.textContent.startsWith('Theramore')); if (!o) return { err: 'no Theramore inn' }; sel.value = o.value; sel.dispatchEvent(new Event('change')); const r = A.solve(A.state.A, A.state.B, { hearth: true }); const used = r.legs.some(l => l.type === 'hearth'); sel.value = ''; sel.dispatchEvent(new Event('change')); return { used, total: r.total }; });
check(hearth.used && hearth.total < 120, `hearth bound at Theramore is used to reach Theramore (${hearth.err || Math.round(hearth.total) + ' s'})`);
await pg.evaluate(() => { const A = window.Atlas; A.state.fac = 'A'; A.route(); });
await wait(600); await pg.screenshot({ path: out + '/route.png' });
const ways = await pg.evaluate(() => document.querySelectorAll('#result textarea')[1]?.value || '');
check(/^\/way #\d+ \d+\.\d \d+\.\d /m.test(ways), 'TomTom lines produced: ' + ways.split('\n')[0]);

// page route code -> addon parser: every waypoint arrives intact
const code = await pg.evaluate(() => { const A = window.Atlas; const f = (n) => A.P.find(p => p.kind === 'flight' && p.label.startsWith(n) && p.fac.includes('A')); A.state.fac = 'A';
  A.setEnd('A', A.placeEndpoint(f('Stormwind'))); A.setEnd('B', A.placeEndpoint(f('Theramore'))); const S = A.steps(A.solve(A.state.A, A.state.B).legs); return { code: A.routeCode(S), ways: A.tomtom(S) }; });
{
  const { execFileSync } = await import('node:child_process'); const os = await import('node:os'); const fs = await import('node:fs'); const path = await import('node:path');
  const root = new URL('../../', import.meta.url).pathname, f = path.join(os.tmpdir(), 'fa_route.txt');
  let ok = true; try { execFileSync('lua', [path.join(root, 'build/test/addon_test.lua'), 'route', f, code.code], { cwd: root, stdio: ['ignore', 'ignore', 'ignore'] }); } catch (e) { ok = false; }
  const lines = ok ? fs.readFileSync(f, 'utf8').trim().split('\n').slice(1) : [];
  const match = lines.length === code.ways.length && lines.every((l, i) => { const [m, x, y] = l.split(' '); const w = code.ways[i].split(' '); return w[1] === '#' + m && Math.abs(+w[2] - x * 100) < 0.051 && Math.abs(+w[3] - y * 100) < 0.051; });
  check(ok && match, `route code Stormwind -> Theramore: addon read ${lines.length} of ${code.ways.length} waypoints, same maps and coordinates as the /way lines`);
}

// ---- Errands ----
const err = await pg.evaluate(async () => {
  const A = window.Atlas; A.state.fac = 'A';
  const gold = A.P.find(p => p.name === 'Goldshire'); A.setEnd('A', A.placeEndpoint(gold));
  A.setTab('errands'); window.AtlasErrands.set([{ c: 'bank' }, { c: 'auction' }, { c: 'trainer:Warrior' }, { c: 'mail' }], 'start');
  await new Promise(r => setTimeout(r, 50));
  return { total: document.querySelector('#eres .total')?.textContent, stops: [...document.querySelectorAll('#eres > div > .row b')].map(b => b.textContent) };
});
check(err.total && err.stops.length >= 4, `errands Goldshire: bank, AH, warrior trainer, mail, back: ${err.total} via ${err.stops.join(' → ')}`);
await wait(600); await pg.screenshot({ path: out + '/errands.png' });

// ---- Level ----
const lv = await pg.evaluate(async () => { const A = window.Atlas; A.state.level = 12; A.setTab('level'); await new Promise(r => setTimeout(r, 50)); return [...document.querySelectorAll('#level li[data-i]')].slice(0, 5).map(li => li.innerText.replace(/\s+/g, ' ')); });
check(lv.length >= 5, 'level 12 Alliance hubs: ' + lv.join(' || '));
await wait(600); await pg.screenshot({ path: out + '/level.png' });
const lp = await pg.evaluate(() => { const A = window.Atlas; A.state.fac = 'A'; A.state.level = 10; A.setEnd('A', A.placeEndpoint(A.P.find(p => p.name === 'Goldshire'))); const t0 = performance.now(); const P = window.AtlasLevel.plan(20, 5); return { reached: P.reached, steps: P.steps.length, t: P.t, ms: performance.now() - t0, first: P.steps.slice(0, 5).map(s => `${s.h.n} (${s.qs.length}q, L${s.from}->${s.to})`) }; });
check(lp.reached >= 20 && lp.steps > 3, `levelling plan 10 -> 20 from Goldshire: ${lp.steps} hubs, ${Math.round(lp.t / 3600 * 10) / 10} h, ${Math.round(lp.ms)} ms; ${lp.first.join(' → ')}`);

// ---- Gather ----
const ga = await pg.evaluate(async () => { const A = window.Atlas; A.setTab('gather'); await new Promise(r => setTimeout(r, 50)); const li = document.querySelector('#gather li[data-z]'); li.click(); await new Promise(r => setTimeout(r, 50)); return { zone: li.innerText.split('\n')[0], loop: window.AtlasGather.lastLoop, txt: document.querySelector('#gloop')?.innerText.replace(/\s+/g, ' ') }; });
check(ga.loop && ga.loop.stops > 5, 'gathering at skill 1: best zone ' + ga.zone + ', ' + (ga.txt || '').slice(0, 160));
await wait(800); await pg.screenshot({ path: out + '/gather.png' });

// ---- Find ----
for (const [name, expect] of [['Mageroyal', 'o'], ['Refreshing Spring Water', 'v'], ['Minor Healing Potion', 'r']]) {
  const f = await pg.evaluate(async (name) => {
    const A = window.Atlas; A.state.fac = 'A'; const gold = A.P.find(p => p.name === 'Goldshire'); A.setEnd('A', A.placeEndpoint(gold));
    A.setTab('find'); const id = +Object.entries(window.WOWITEMS.items).find(([, e]) => e.n === name)[0]; window.AtlasFind.show(id);
    await new Promise(r => setTimeout(r, 50));
    return { best: document.querySelector('#fres .hint')?.innerText, kinds: Object.keys(window.WOWITEMS.items[id]), route: document.querySelector('#froute .total')?.textContent || '' };
  }, name);
  check(f.kinds.includes(expect) && (expect === 'r' ? /crafted/.test(f.best) : /Best bet/.test(f.best)), `find ${name}: ${f.best} [sources ${f.kinds.join(',')}] route ${f.route}`);
}
await wait(600); await pg.screenshot({ path: out + '/find.png' });

// ---- Dungeons ----
const dg = await pg.evaluate(async () => {
  const A = window.Atlas; A.state.fac = 'A'; A.state.level = 18; const f = A.P.find(p => p.kind === 'flight' && p.label.startsWith('Stormwind'));
  A.setEnd('A', A.placeEndpoint(f)); A.setTab('dungeons'); window.AtlasDungeons.select('The Deadmines'); await new Promise(r => setTimeout(r, 50));
  return { quests: [...document.querySelectorAll('#dres input[data-q]')].map(c => c.checked), last: window.AtlasDungeons.last, total: document.querySelector('#dres .total')?.textContent };
});
check(dg.quests.length >= 3 && dg.last && dg.last.stops >= 1, `Deadmines at level 18 from Stormwind: ${dg.quests.filter(Boolean).length}/${dg.quests.length} quests ticked, pickup run ${dg.total} via ${dg.last && dg.last.stops} givers`);
await wait(700); await pg.screenshot({ path: out + '/dungeons.png' });

// ---- Character file ----
const sv = `ForeverAtlasDB = {\n["chars"] = {\n["Testchar - Realm"] = {\n["faction"] = "Horde",\n["class"] = "SHAMAN",\n["level"] = 27,\n["bind"] = "Crossroads",\n["known"] = "23,25,22",\n["seenMaps"] = "1414",\n["time"] = 1763400000,\n},\n},\n}\n`;
const ch = await pg.evaluate((sv) => { const A = window.Atlas; const msg = A.applyCharacter(sv); const fps = A.P.filter(p => p.kind === 'flight' && p.fac.includes('H') && p.map === 1); const known = fps.filter(p => !A.state.unknown.has(p.id)).map(p => p.name); return { msg, fac: A.state.fac, lvl: A.state.level, known, hearth: document.getElementById('hearth').selectedOptions[0].textContent }; }, sv);
check(ch.fac === 'H' && ch.lvl === 27 && ch.known.length === 3, `character file: ${ch.msg} Known in Kalimdor: ${ch.known.join(', ')}; hearth: ${ch.hearth}`);
// addon -> SavedVariables -> page, for both flight-map APIs the addon supports
const { execFileSync } = await import('node:child_process');
const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
const root = new URL('../../', import.meta.url).pathname;
for (const mode of ['continent', 'zones']) {
  const f = path.join(os.tmpdir(), `fa_sv_${mode}.lua`);
  execFileSync('lua', [path.join(root, 'build/test/addon_test.lua'), mode, f], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
  const r = await pg.evaluate((sv) => { const A = window.Atlas; A.state.unknown.clear(); const msg = A.applyCharacter(sv); const ek = A.P.filter(p => p.kind === 'flight' && p.fac.includes('A') && p.map === 0); return { msg, known: ek.filter(p => !A.state.unknown.has(p.id)).map(p => p.label), fac: A.state.fac, hearth: document.getElementById('hearth').selectedOptions[0].textContent }; }, fs.readFileSync(f, 'utf8'));
  const want = 2;   // Stormwind and Ironforge known, Lakeshire undiscovered (see addon_test.lua)
  check(r.fac === 'A' && r.known.length === want && r.hearth.startsWith('Goldshire'), `addon (${mode} API) -> page: ${r.known.length} EK flight points known [${r.known.join('; ')}], hearth ${r.hearth}`);
}
check(errs.length === 0, 'no page errors ' + errs.join(' | '));
await b.close(); process.exit(fail ? 1 : 0);
