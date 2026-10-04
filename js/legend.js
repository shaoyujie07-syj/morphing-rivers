/*
 * legend.js — T-11 图例（impl-spec §8、§4.3；D-52、D-57）
 *
 * 图例放在画布角落：默认收成一个小标签，点击展开为半透明面板；与画布上的线、站点、设施、标注重叠时自动换角落
 * （图例自己的顺序是左下、右下、左上、右上；作者 10-04 起与说明块、小地图一起选，取总代价最小的组合，见 arrange；
 * 四个角都压到东西时写 body[data-legend-overlap]）。
 * 作者 10-01：角落只在载入流域、切换视图时算一次；缩放、平移（以及展开收起图例、窗口变化）不重算，只按原角落重新贴边——
 * 位置突变比压住几根线更干扰，缩放是连续动作，来回几次角落就跳几次；压住的线从半透明面板下穿过。
 * 默认五项：监测站、河道与线宽含义、蓄水、堰、未监测支流存根；其余折叠在「更多符号」里。
 * 作者 10-01 修订（图例与画布逐项比对之后）：
 *   - 监测站三种状态并排，写明是同一维度（按所选参数）：● 测当前参数　○ 只测流量或水位　● 灰 不测当前参数；
 *     灰色实心是默认参数下画布上最多的外观，图例必须有。淡显的水质站 r 6 与淡显的流量站 r 5.25 只差 0.75 px，不区分；
 *   - 存根仍画一档，下面注明「粗细与河道相同，表示集水面积的量级」（存根与河道共用五档映射，三行线宽参照已覆盖）；
 *   - 流向 V 只画一种：白色，画在一段粗河道上（颜色变化只为可见性，不承载信息）；
 *   - 「上游有坝或堰的未监测支流」由「更多符号」提到默认项（唯一带警示性质的符号），示意图默认六项；
 *     地图上不画存根，地图视图仍为五项；
 *   - 地图上被站点压住的坝放大 1.5 倍，与图例尺寸不同：不改、不加说明（尺寸不承诺表示什么）。
 *   - 圆环加白边（作者 10-01 第二轮：白边是画布上真实存在的轮廓）；圆环符号下衬一段粗河道，白边在图例的白底上才看得见。
 *   - 「在卡片栈中」与「卡片已展开」合并为一项（作者 10-01 取消画布上的细环，两者同为 2.5 px 环加白边）。
 * 划界（作者 10-01）：图例解释符号，不解释交互反馈（悬停、选中光晕、路径高亮），也不解释自解释的东西（比例尺、指北针、地名）。
 * 常驻一句「线宽表示集水面积的量级，不表示比例」；V2 未实现（D-56），不出现「支流长度不按比例」。
 * 汇流比例符号属「可以」档、尚未实现，图例末尾暂不放开关（作者 09-24）。
 * 线宽参照 10 / 1 000 / 12 500 km²（D-57），数值按当前视图取示意图或地图（× 0.7）那一行；
 * 地图视图下图例只解释地图上看得到的元素（D-45）；切换在形变动画结束后进行（D-52）。
 *
 * 调试参数（只供自检截图）：&legend=open|more  &legendCorner=bl|br|tl|tr（强制角落，用于演示「重叠时换角落」前后）
 *
 * 作者标注：本文件由 Claude Code（M2 T-11，2026-09-24）编写，见 docs/plan.md §11。
 */
(function () {
  'use strict';
  const R = window.River;
  const T = R.T;
  const canvas = document.getElementById('canvas');
  const box = d3.select(canvas).append('div').attr('id', 'legend').attr('class', 'legend');
  // 验收修订 10-01：默认展开（作者第一次使用没找到图例）；用户选中对象后不自动收起，由用户按需收起
  const L = { open: true, more: false, view: null, corner: null, overlap: 0 };
  const REF = [10, 1000, 12500];                       // 线宽参照（D-57）
  const ORDER = ['bl', 'br', 'tl', 'tr'];
  const M = 8;                                         // 离画布边 8 px

  const sw = (w, h, body) => `<svg class="lg-sym" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
  // 栈内圆环（与 stack.js 的 drawRings 同一画法）：白边 r = 11 + 环宽/2 + 0.75、宽 1.5，只在环外；下衬粗河道
  const ringSym = w => sw(28, 28, `<line x1="0" y1="14" x2="28" y2="14" stroke="#4A6E8A" stroke-width="9.5"/>`
    + `<circle cx="14" cy="14" r="7.5" fill="#fff"/><circle class="st-wq" cx="14" cy="14" r="6"/>`
    + `<circle class="ring-halo" cx="14" cy="14" r="${11 + w / 2 + 0.75}" stroke-width="1.5"/><circle class="ring" cx="14" cy="14" r="11" stroke-width="${w}"/>`);
  const tri = (cx, cy, w, h, cls) => `<path class="${cls}" d="M${cx + h / 2},${cy}L${cx - h / 2},${cy - w / 2}L${cx - h / 2},${cy + w / 2}Z"/>`;
  const SYM = {
    wq: sw(16, 16, '<circle cx="8" cy="8" r="7.5" fill="#fff"/><circle class="st-wq" cx="8" cy="8" r="6"/>'),
    flow: sw(16, 16, '<circle cx="8" cy="8" r="7.5" fill="#fff"/><circle class="st-flow" cx="8" cy="8" r="5.25"/>'),
    faded: sw(16, 16, '<circle cx="8" cy="8" r="7.5" fill="#fff"/><g class="faded"><circle class="st-wq" cx="8" cy="8" r="6"/></g>'),   // 与画布同一条样式（.faded .st-wq）
    storage: sw(16, 16, tri(8, 8, 12, 14, 'fac-storage')),
    weir: sw(16, 16, tri(8, 8, 10, 12, 'fac-weir')),
    // 存根削角（作者 10-01）：与画布同一画法（尖长 max(3, 1.5 × 线宽)），尖朝河道 = 流入、尖朝外 = 流出。
    // 画 3.5 px 一档（尖长 5.25）：图例要示范「这个符号长什么样」，不是「最常见的尺寸」；1.5 px 上 3 px 的尖看不清。
    // 旁边已注明「粗细与河道相同」，画哪一档不重要，画清楚最要紧（作者 10-01）
    stub: sw(16, 16, '<path class="stub-body" data-w="3.5" d="M8,4.5L9.75,9.75L9.75,15L6.25,15L6.25,9.75Z"/><line x1="0" y1="0.5" x2="16" y2="0.5" stroke="#4A6E8A" stroke-width="1.5"/>'),
    outflow: sw(16, 16, '<line x1="0" y1="15.5" x2="16" y2="15.5" stroke="#4A6E8A" stroke-width="1.5"/><path class="stub-body" data-w="3.5" d="M8,0L9.75,5.25L9.75,11.5L6.25,11.5L6.25,5.25Z"/>'),
    outlet: sw(16, 16, '<path class="outlet-mark" d="M2,8L12,3.5L12,12.5Z"/>'),
    chev: sw(16, 16, '<line x1="0" y1="8" x2="16" y2="8" stroke="#4A6E8A" stroke-width="9.5"/><path class="flow-arrow on-thick" d="M10,4L6,8L10,12"/>'),   // 白色 V 画在粗河道上
    flag: sw(16, 16, '<path class="stub-body" data-w="3.5" d="M8,15.5L9.75,10.25L9.75,4L6.25,4L6.25,10.25Z"/><rect class="stub-flag" x="5.5" y="1.5" width="5" height="5"/>'),
    inStack: ringSym(2.5),
    outline: sw(16, 16, '<rect class="bg-outline" x="1" y="3" width="14" height="10" rx="2"/>'),
    water: sw(16, 16, '<path class="bg-water" d="M2,9C3,4 8,3 11,5C15,7 14,12 9,12C5,13 1,13 2,9Z"/>'),
    bgRiver: sw(16, 16, '<path class="bg-river" d="M1,12C5,11 7,6 15,4" stroke-width="1"/>'),
    town: sw(16, 16, '<circle class="town-dot" cx="8" cy="8" r="2.2"/>'),
  };
  const item = (sym, txt, title) => `<div class="lg-item"${title ? ` title="${title}"` : ''}>${sym}<span>${txt}</span></div>`;
  // 监测站：同一维度（按所选参数）的三种状态并排
  const stationItem = () => `<div class="lg-item lg-st"><div class="lg-rtitle">${T.lgStation}${T.lgStBy}</div><div class="lg-st3">${
    [[SYM.wq, T.lgWq], [SYM.flow, T.lgFlow], [SYM.faded, T.lgFaded]].map(([s, t]) => `<div class="lg-sc">${s}<span>${t}</span></div>`).join('')}</div></div>`;
  // 存根：画一档，下面注明粗细与河道相同
  const stubItem = () => `<div class="lg-item lg-stub">${SYM.stub}<span>${T.lgStub}<span class="lg-note">${T.lgStubW}</span></span></div>`;

  function widths(view) {
    const lw = R.state.d.basin.line_widths;
    const row = view === 'map' ? lw.map : lw.schematic;
    const cls = a => lw.bounds_km2.filter(b => a >= b).length;      // 分档：按导出的分界
    return REF.map(a => ({ a, w: row[cls(a)] }));
  }
  function riverItem(view) {
    const ws = widths(view);
    const lines = ws.map(x => `<div class="lg-w">${sw(40, 12, `<line class="piece" x1="2" y1="6" x2="38" y2="6" stroke-width="${x.w}"/>`)}<span>${
      x.a.toLocaleString('en-US')} km² · ${+x.w.toFixed(2)} px</span></div>`).join('');
    return `<div class="lg-item lg-river"><div class="lg-rtitle">${T.lgRiver}</div>${lines}</div>`;
  }
  function content(view) {
    const map = view === 'map';
    const dflt = [
      stationItem(),
      riverItem(view),
      item(SYM.storage, T.lgStorage),
      item(SYM.weir, T.lgWeir),
      ...(map ? [item(SYM.bgRiver, T.lgMapBg)] : [stubItem(), item(SYM.flag, T.lgFlagShort, T.lgFlag)]),
    ];
    const more = map
      ? [item(SYM.outline, T.lgMapOutline), item(SYM.water, T.lgMapWater), item(SYM.town, T.lgMapTown), item(SYM.outlet, T.lgOutlet),
        item(SYM.inStack, T.lgInStack)]
      : [item(SYM.outflow, T.lgOutflow), item(SYM.outlet, T.lgOutlet), item(SYM.chev, T.lgFlowDir),
        item(SYM.inStack, T.lgInStack)];
    return `<div class="lg-head"><b>${T.legend}</b><button class="lg-close" data-lg="close">${T.legendClose}</button></div>
      ${dflt.join('')}
      <button class="lg-more" data-lg="more">${L.more ? T.lgLess : T.lgMore} ${L.more ? '▴' : '▾'}</button>
      ${L.more ? `<div class="lg-morebox">${more.join('')}</div>` : ''}
      <label class="lg-toggle" title="${T.lgRatio}"><input type="checkbox" data-lg="ratio"${R.state.showRatio ? ' checked' : ''}> ${
        sw(16, 16, '<circle class="ratio-c" cx="8" cy="8" r="5.5"/><path class="ratio-p" d="M8,2.5A5.5,5.5 0 0 1 13.2,9.8L8,8Z"/>')} ${T.lgRatioShort}</label>`;
  }

  function render() {
    if (!R.state.d) return;
    const view = L.view || R.state.view;
    box.classed('open', L.open).classed('collapsed', !L.open);
    box.html(L.open ? content(view) : `<button class="lg-tag" data-lg="open">${T.legend} ▸</button>`);
    place();
  }

  // ------------------------------------------------------------ 选角落：与画布元素不重叠
  // 作者 10-01：选角落时优先避开站点——站点是可点击对象，被半透明面板盖住就点不到；线可以压（从面板下穿过）。
  // 存根与坝标记同为可点击的小符号，排在站点之后、线之前。障碍物分三档：0 站点、1 存根与坝标记、2 线与其他
  function obstacles() {
    const s = R.state, m = R.model && R.model();
    const segs = [], rects = [];
    if (m) {
      for (const Ln of m.lines) {
        if (Ln.type === 'bgriver') continue;
        const w = Ln.type === 'edge' ? R.pieceW(Ln.obj, m.t) : 2;
        const cat = Ln.type === 'stub' || Ln.type === 'outflow' ? 1 : 2;
        for (let i = 1; i < Ln.poly.length; i++) segs.push([Ln.poly[i - 1], Ln.poly[i], w / 2 + 2, cat]);
      }
      for (const p of m.pts) {
        const cat = p.type === 'station' ? 0 : (p.type === 'facility' || p.type === 'stub' || p.type === 'outflow') ? 1 : 2;
        rects.push([p.x - 9, p.y - 9, p.x + 9, p.y + 9, cat]);
      }
      if (m.map) for (const ring of s.d.background.outline_geo) {
        const q = ring.map(R.P);
        for (let i = 1; i < q.length; i++) segs.push([q[i - 1], q[i], 1, 2]);
      }
    }
    for (const b of s.labelBoxes || []) if (!m || !m.map) rects.push([...b.rect.slice(0, 4), 2]);
    if (m && m.map) for (const pos of (s.mapLabelPos || new Map()).values()) if (pos.rect) rects.push([...pos.rect.slice(0, 4), 2]);
    if (m && m.map) for (const pos of (s.townPos || new Map()).values()) if (pos.rect) rects.push([...pos.rect.slice(0, 4), 2]);   // 城镇标注也避开
    return { segs, rects };
  }
  const hitRect = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
  function segHitsRect(a, b, pad, r) {             // 线段（外扩 pad）与矩形是否相交
    const R_ = [r[0] - pad, r[1] - pad, r[2] + pad, r[3] + pad];
    const inside = p => p[0] >= R_[0] && p[0] <= R_[2] && p[1] >= R_[1] && p[1] <= R_[3];
    if (inside(a) || inside(b)) return true;
    if (Math.max(a[0], b[0]) < R_[0] || Math.min(a[0], b[0]) > R_[2] || Math.max(a[1], b[1]) < R_[1] || Math.min(a[1], b[1]) > R_[3]) return false;
    const cross = (p, q, r2) => (q[0] - p[0]) * (r2[1] - p[1]) - (q[1] - p[1]) * (r2[0] - p[0]);
    const C = [[R_[0], R_[1]], [R_[2], R_[1]], [R_[2], R_[3]], [R_[0], R_[3]]];
    const s = C.map(c => Math.sign(cross(a, b, c)));
    return !(s.every(v => v > 0) || s.every(v => v < 0));
  }
  function rectAt(corner, w, h) {
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    const x = corner[1] === 'l' ? M : cw - M - w, y = corner[0] === 't' ? M : ch - M - h;
    return [x, y, x + w, y + h];
  }
  function overlapCats(r, ob) {                     // [站点, 存根与坝标记, 线与其他]
    const n = [0, 0, 0];
    for (const s of ob.segs) if (segHitsRect(s[0], s[1], s[2], r)) n[s[3]]++;
    for (const q of ob.rects) if (hitRect(q, r)) n[q[4]]++;
    return n;
  }
  const overlapCount = (r, ob) => overlapCats(r, ob).reduce((a, b) => a + b, 0);
  // 位置记作 id：四个角 'tl' 'tr' 'bl' 'br'，沿边的位置 't@x' 'b@x'（上 / 下边，左端 x）、'l@y' 'r@y'（左 / 右边，上端 y）
  const STEP = 4;                                      // 沿边每 4 px 试一个位置
  const CORNERS = ['tl', 'tr', 'bl', 'br'];
  function placeAt(id, w, h) {                         // 尺寸变了（展开、收起）仍贴住同一个角或同一条边
    const m = /^([tblr])@(-?[\d.]+)$/.exec(id || '');
    if (!m) return rectAt(id, w, h);
    const cw = canvas.clientWidth, ch = canvas.clientHeight, v = +m[2];
    const clamp = (a, lo, hi) => Math.max(lo, Math.min(hi, a));
    if (m[1] === 't' || m[1] === 'b') { const x = clamp(v, M, cw - M - w), y = m[1] === 't' ? M : ch - M - h; return [x, y, x + w, y + h]; }
    const y = clamp(v, M, ch - M - h), x = m[1] === 'l' ? M : cw - M - w;
    return [x, y, x + w, y + h];
  }
  function edgeIds(w, h) {
    const cw = canvas.clientWidth, ch = canvas.clientHeight, ids = [];
    const along = (lo, hi) => { const v = []; for (let a = lo; a < hi; a += STEP) v.push(a); v.push(Math.max(lo, hi)); return v; };
    for (const x of along(M, cw - M - w)) ids.push('t@' + x, 'b@' + x);
    for (const y of along(M, ch - M - h)) ids.push('l@' + y, 'r@' + y);
    return ids;
  }
  // 作者 10-04：放在画布边上的几块——说明块、图例、小地图（只在示意图视图；地图视图下隐藏，D-35）——一起选位置，
  // 取总代价最小的组合。原先逐块依次选（说明块先、图例次、小地图最后），各自最优合起来不是最优：Yarra 地图里说明块
  // 躲开左上的 58 段线去了左下，把图例挤到左上压 183 段线。
  // 代价依次比（与原规则的三档一致）：
  //   ① 压住的可点击对象总数（站点、存根、坝标记）：有能做到 0 的组合就只在其中选；都做不到时取最少，一样少时优先保住站点；
  //   ② 压住的线段总数；
  //   ③ 平局顺序：先比说明块、再图例、再小地图，各按自己的角落顺序（说明块左上起、图例左下起、小地图右下起）；
  //      沿边位置排在角落之后，按离本块首选角的距离。没有冲突时三块落在各自的默认角。
  // 候选：四个角；某块四个角都压到可点击对象时，才加入它的沿边位置（每 4 px，只取不压可点击对象的；都压时全取）——
  // 角落可预期、用户下次打开还在那个角，沿边是没办法时的退路，不与角落平起平坐（作者 10-04）。
  // 块与块之间至少留 8 px；固定区域（地图视图右上角的比例尺、指北针与署名）不进入。
  // 只在载入流域、切换视图时选一次，缩放、平移、展开收起不重选（D-59、D-60）。
  const GAP = 8;
  function arrange(blocks, ob, fixed = []) {
    const grow = (r, p) => [r[0] - p, r[1] - p, r[2] + p, r[3] + p];
    const C = blocks.map(B => {
      const [w, h] = B.size;
      const mk = id => { const r = placeAt(id, w, h); return { id, r, v: overlapCats(r, ob) }; };
      const free = c => !fixed.some(f => hitRect(f, c.r));
      const corners = B.order.map((id, i) => Object.assign(mk(id), { rank: i })).filter(free);
      const cs = corners.slice();
      let edges = 0;
      if (!corners.some(c => c.v[0] + c.v[1] === 0)) {
        const ref = mk(B.order[0]).r;
        const es = edgeIds(w, h).map(mk).filter(free);
        const clean = es.filter(c => c.v[0] + c.v[1] === 0);
        for (const c of (clean.length ? clean : es)) { c.rank = 4 + Math.hypot(c.r[0] - ref[0], c.r[1] - ref[1]); cs.push(c); edges++; }
      }
      return { k: B.k, order: B.order, corners, cs, edges };
    });
    let best = null, combos = 0;
    const better = (a, b) => {
      if (!b) return true;
      if (a.click !== b.click) return a.click < b.click;
      if (a.st !== b.st) return a.st < b.st;
      if (a.lines !== b.lines) return a.lines < b.lines;
      for (let i = 0; i < a.ranks.length; i++) if (a.ranks[i] !== b.ranks[i]) return a.ranks[i] < b.ranks[i];
      return false;
    };
    const rec = (i, pick) => {
      if (i === C.length) {
        combos++;
        const sum = j => pick.reduce((s, c) => s + c.v[j], 0);
        const cand = { pick, click: sum(0) + sum(1), st: sum(0), lines: sum(2), ranks: pick.map(c => c.rank) };
        if (better(cand, best)) best = cand;
        return;
      }
      for (const c of C[i].cs) if (!pick.some(p => hitRect(grow(p.r, GAP), c.r))) rec(i + 1, pick.concat([c]));
    };
    rec(0, []);
    const out = { combos, totals: best && { click: best.click, stations: best.st, lines: best.lines }, blocks: {} };
    C.forEach((B, i) => {
      const p = best ? best.pick[i] : B.cs[0];
      out.blocks[B.k] = { id: p.id, v: p.v, edges: B.edges,
        slid: CORNERS.includes(p.id) ? null : { from: B.order[0], clean: p.v[0] + p.v[1] === 0, cats: p.v },
        scores: Object.fromEntries(B.corners.map(c => [c.id, c.v])) };
    });
    return out;
  }
  let seq = 0;                                         // 每重选一次加一：小地图据此知道要换位置
  function place() {
    const el = box.node();
    const w = el.offsetWidth, h = el.offsetHeight;
    const ob = obstacles();
    const forced = R.Q.get('legendCorner');
    const view = L.view || R.state.view;
    const key = (R.state.id || '') + '|' + view;
    L.recomputed = key !== L.key || !L.corner;
    if (L.recomputed) {                              // 载入流域、切换视图：几块一起选位置
      const blocks = [];
      if (R.intro) blocks.push({ k: 'intro', size: R.intro.size(), order: R.intro.ORDER });
      blocks.push({ k: 'legend', size: [w, h], order: ORDER });
      const ms = view === 'schematic' && R.minimap && R.minimap.size();
      if (ms) blocks.push({ k: 'minimap', size: ms, order: R.minimap.ORDER });
      const fixed = R.intro ? R.intro.fixedRects(view) : [];
      const A = arrange(blocks, ob, fixed);
      L.arrangement = { seq: ++seq, key, view, combos: A.combos, totals: A.totals, blocks: A.blocks };
      const lg = A.blocks.legend;
      L.corner = lg.id; L.slid = lg.slid; L.key = key;
      if (forced && !L.forcedDone && CORNERS.includes(forced)) { L.corner = forced; L.slid = null; }   // 调试：强制角落
      L.scoreCats = lg.scores;
      L.scores = Object.fromEntries(Object.entries(lg.scores).map(([c, v]) => [c, v[0] + v[1] + v[2]]));
      if (!Object.values(L.scores).some(n => n === 0)) document.body.dataset.legendOverlap = '1';
      else delete document.body.dataset.legendOverlap;
      if (R.intro) R.intro.setPlace(A.blocks.intro, ob);
      document.body.dataset.arrangement = JSON.stringify({ key, view, combos: A.combos, totals: A.totals,
        blocks: Object.fromEntries(Object.entries(A.blocks).map(([k, b]) => [k, { id: b.id, v: b.v, edges: b.edges }])) });
    }
    const r = placeAt(L.corner, w, h);               // 其余时候按原角落（或原来那条边）重新贴边；当前压线数照记
    L.rect = r;
    L.overlapCats = overlapCats(r, ob);
    L.overlap = L.overlapCats[0] + L.overlapCats[1] + L.overlapCats[2];
    box.style('left', r[0] + 'px').style('top', r[1] + 'px');
    document.body.dataset.legend = JSON.stringify({ open: L.open, corner: L.corner, slid: L.slid, rect: r.map(v => Math.round(v * 10) / 10),
      overlap: L.overlap, overlap_cats: L.overlapCats, scores: L.scores, score_cats: L.scoreCats, w, h, cw: canvas.clientWidth, ch: canvas.clientHeight,
      recomputed: L.recomputed });
    R.emit('legendplaced', { corner: L.corner, rect: r });     // 小地图据此取自己的位置（一起选的结果）
  }
  // 说明块、小地图（验收修订 10-01 移到画布角落）与图例一起选位置（arrange）
  // assigned(k)：最近一次一起选给 k 的位置（{ seq, key, id, v, slid, scores }），没有参加则为 null
  // reset：清掉已选的位置，下次就位时重选（自检的反向对照用来模拟「每次都重算」）
  R.corners = { obstacles, overlapCount, overlapCats, arrange, placeAt, rectAt: (c, w, h) => rectAt(c, w, h), state: L,
    assigned: k => { const a = L.arrangement; return a && a.blocks[k] ? { seq: a.seq, key: a.key, ...a.blocks[k] } : null; },
    reset: () => { L.key = null; R.emit('cornersreset'); } };

  box.on('click', ev => {
    const b = ev.target.closest('[data-lg]');
    if (!b) return;
    const a = b.dataset.lg;
    if (a === 'open') L.open = true;
    else if (a === 'close') { L.open = false; L.more = false; }
    else if (a === 'more') L.more = !L.more;
    else if (a === 'ratio') { R.state.showRatio = b.checked; R.draw(R.state.frame || R.still(R.state.view)); }
    L.forcedDone = true;
    render();
  });
  // 形变开始时保持原图例（D-52：图例在动画结束后切换）；静止视图就绪时按当前视图重画、重新选角落
  R.on('morphstart', () => { L.view = R.state.view; });
  R.on('layout', () => { L.view = null; render(); });
  R.on('build', () => { L.view = null; });
  let debugDone = false;
  R.on('layout', () => {
    if (debugDone) return;
    debugDone = true;
    const q = R.Q.get('legend');
    if (q === 'open' || q === 'more') { L.open = true; L.more = q === 'more'; render(); }
    if (R.Q.get('ratio')) { R.state.showRatio = true; R.draw(R.state.frame || R.still(R.state.view)); render(); }   // 调试：&ratio=1
  });
  R.legend = { state: L, render };
})();
