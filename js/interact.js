/*
 * interact.js — T-09 悬停与选中（impl-spec §6.1、§6.4；D-44、D-45）
 *
 * 命中判断在屏幕坐标里自己算（不靠 SVG 的指针事件），这样热区、优先顺序、边的归属都能照规格做：
 *   第一步 看得见的符号：指针落在站点圆、设施三角、河口三角上时，取其中优先级最高的
 *          （作者 09-24：「先看形状、再看热区」——地图上被站点压住的坝，露出的黄边能点到坝）；
 *   第二步 热区：点状对象（站点、设施、汇流点、河口，地图上的存根汇入点）的热区为正方形，
 *          半边长 = min(12, max(4, 与最近对象间距的一半))，即默认 24 × 24、密集处退为间距的一半、
 *          不小于 8 px（D-44）；站点、设施的间距只在站点与设施之间量，其余点在全部点之间量；
 *          热区重叠处（间距 < 8 px）取离指针最近的一个；
 *          线状对象（边的各段、存根、分流、地图上存根支流的河段）取 12 px 以内最近的一条——相邻两线各得一半间距；
 *          河名标注取文字矩形外扩 2 px。多个候选按优先顺序取：站点 > 设施 > 存根 > 汇流点 > 河名标注 >
 *          河口与分流 > 边 > 背景河流（D-44）。
 *   悬停对象 = 全部候选里优先级最高的；点击对象 = 可点对象（站点、设施、存根、边）里优先级最高的，
 *   所以汇流点、河名标注上点击会落到其下的边（§6.1「不可点（落到边）」）。
 *   边的归属用导出的 owner（D-44：每段只归沿这条河走的那条边，共用段归干流）。
 *
 * 点击：站点 → 加入卡片栈；边、存根 → 选中其下游的站并展开对应区块，同时高亮整条路径与两端的站（D-45）；
 *       流向河口的那条边没有下游站，选中其上游站并展开「本站到河口之间」（作者 09-24）；
 *       设施 → 临时卡片；空白或 Esc → 关闭临时卡片、清除高亮，不动栈。移动超过 3 px 视为拖动，不触发选择。
 *
 * 联动（作者 10-01）：
 *   - 悬停一一对应：悬停什么就只亮什么，画布、小地图、侧边栏三处同此一条（修订 D-41：取消悬停站点时的到河口路径，
 *     悬停汇流点只亮汇流点）。边的范围就是「两站之间」，含两端的站；存根亮出整条未监测支流、设施亮出水库水面、
 *     河名亮出整条同名河，是同一对象在另一个尺度上的样子，保留。选中态不受此约束（选中边、存根带出路径与两端站）。
 *   - 两套状态：本文件的「当前高亮集合」（悬停 + 选中，临时：移开、Esc、点空白即清）与 stack.js 的「卡片栈」（持久）。
 *     各视图各用一个渲染函数同时读这两套：画布的光晕读卡片栈（栈内站的光晕放大到圆环白边之外，不被白边盖住）；
 *     小地图与侧边栏在 'hl'、'stack' 两个事件上重画。R.hlState() 给出当前高亮集合。
 *
 * 调试参数（只供自检截图）：
 *   &hover=type:id        在该对象的锚点处模拟悬停（经过同一套命中判断），type ∈ station、edge、facility、stub、
 *                         confluence、outlet、outflow、label、bgriver
 *   &pt=x,y               在画布坐标 (x, y) 处模拟悬停
 *   &click=type:id,…      依次在锚点处模拟点击
 *   &selftest=1           点击准确性自测，结果写 body[data-selftest]（JSON）
 *
 * 作者标注：本文件由 Claude Code（M2 T-09，2026-09-24）编写，见 docs/plan.md §11。
 */
(function () {
  'use strict';
  const R = window.River;
  const T = R.T;
  const PRI = { station: 0, facility: 1, stub: 2, confluence: 3, label: 4, outlet: 5, outflow: 5, edge: 6, bgriver: 7 };
  const CLICKABLE = new Set(['station', 'facility', 'stub', 'edge']);
  const ZONE_MAX = 12, ZONE_MIN = 4, LINE_ZONE = 12, DRAG = 3;
  const svgEl = document.getElementById('svg');
  const canvas = document.getElementById('canvas');
  const tip = d3.select(canvas).append('div').attr('id', 'tooltip').attr('class', 'tip').style('display', 'none');

  let model = null;
  let idx = null;                                   // 每个流域的查找表
  const HL = { hover: blank(), sel: blank() };
  let hoverObj = null;

  function blank() { return { pieces: new Set(), stations: new Set(), stubs: new Set(), rivers: new Set(), facs: new Set(),
    confs: new Set(), outlet: false }; }
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ------------------------------------------------------------ 查找表
  R.on('build', d => {
    idx = {
      st: new Map(d.stations.map(x => [x.id, x])),
      edge: new Map(d.edges.map(e => [e.id, e])),
      piece: new Map(R.state.pieces.map(p => [p.id, p])),
      stub: new Map(d.stubs.map(s => [s.id, s])),
      fac: new Map(d.facilities.map(f => [f.id, f])),
      br: new Map(d.basin.branches.map(b => [b.id, b])),
      river: new Map(d.background.rivers_geo.map(r => [r.id, r])),
      conf: new Map(),
    };
    for (const e of d.edges) for (const c of e.confluences) if (!idx.conf.has(c.branch)) idx.conf.set(c.branch, c);
    HL.hover = blank(); HL.sel = blank(); hoverObj = null;
    hideTip();
  });
  R.idx = () => idx;

  const riverName = bid => { const b = idx.br.get(bid); return b && b.name ? b.name : T.unnamedA(b ? b.area_km2 : 0); };
  R.riverName = riverName;
  // 存根与它汇入的那条河同名时（如 Yarra：active 站只到 McMahons Creek，上游 Yarra 成了存根，D-56 的正确后果），
  // 写成「Yarra River（上游段）」以免读者以为出错（作者 09-24）；只改显示，不动数据
  R.stubName = st => {
    if (!st || !st.name) return T.unnamed;
    const into = idx.br.get(st.branch);
    return into && into.name === st.name ? T.upperReach(st.name) : st.name;
  };

  // ------------------------------------------------------------ 命中模型（静止视图下，屏幕坐标）
  function triPts(c, u, w, h) {
    const n = [-u[1], u[0]];
    const tp = [c[0] + u[0] * h / 2, c[1] + u[1] * h / 2];
    const b = [c[0] - u[0] * h / 2, c[1] - u[1] * h / 2];
    return [tp, [b[0] + n[0] * w / 2, b[1] + n[1] * w / 2], [b[0] - n[0] * w / 2, b[1] - n[1] * w / 2]];
  }
  function inTri(p, t) {
    const s = (a, b, c) => (a[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (a[1] - c[1]);
    const d1 = s(p, t[0], t[1]), d2 = s(p, t[1], t[2]), d3 = s(p, t[2], t[0]);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  }
  function segDist(x, y, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const L2 = dx * dx + dy * dy;
    let t = L2 ? ((x - a[0]) * dx + (y - a[1]) * dy) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy));
  }
  function polyDist(x, y, poly) {
    let m = Infinity;
    for (let i = 1; i < poly.length; i++) m = Math.min(m, segDist(x, y, poly[i - 1], poly[i]));
    return poly.length === 1 ? Math.hypot(x - poly[0][0], y - poly[0][1]) : m;
  }

  function buildModel() {
    const s = R.state, d = s.d;
    model = null;
    if (!d || s.busy || !s.frame || (s.frame.t !== 0 && s.frame.t !== 1)) return;
    const t = s.frame.t, map = t === 0;
    const halo = map ? R.HALO.map : R.HALO.schematic;
    const pts = [], lines = [], labels = [];
    for (const st of d.stations) {
      const c = R.stCenter(st, t);
      pts.push({ type: 'station', id: st.id, obj: st, x: c[0], y: c[1], r: R.R_ST + halo });
    }
    for (const f of d.facilities) {
      const G = R.facGeom(f, t);
      pts.push({ type: 'facility', id: f.id, obj: f, x: G.c[0], y: G.c[1], tri: triPts(G.c, G.u, G.w, G.h) });
    }
    const og = R.outletGeom(t);
    pts.push({ type: 'outlet', id: 'outlet', obj: d.basin, x: og.c[0], y: og.c[1], tri: triPts(og.c, og.u, 9, R.OUTLET_H) });
    for (const c of idx.conf.values()) {
      const q = R.P(map ? c.xy_geo : c.xy_schematic);
      pts.push({ type: 'confluence', id: c.branch, obj: c, x: q[0], y: q[1] });
    }
    const riverOwner = new Map();                   // 地图：存根支流（与分流去向）的背景河段 → 存根
    for (const st of d.stubs) {
      const type = st.kind === 'in' ? 'stub' : 'outflow';
      const G = R.stubGeom(st, t);
      if (G.len >= 0.5) lines.push({ type, id: st.id, obj: st, poly: [G.J, G.E] });
      else pts.push({ type, id: st.id, obj: st, x: G.J[0], y: G.J[1] });
      if (map) for (const rid of st.river_ids || []) riverOwner.set(rid, { type, st });
    }
    for (const p of s.pieces) {
      lines.push({ type: 'edge', id: idx.st.get(p.owner).edge, obj: p, piece: p, poly: R.piecePts(p, t).map(R.P) });
    }
    if (map) {
      for (const r of d.background.rivers_geo) {
        const own = riverOwner.get(r.id);
        if (!own && !r.name) continue;                // 背景河流只悬停有名称的（D-44）
        const poly = r.d.map(R.P);
        lines.push(own ? { type: own.type, id: own.st.id, obj: own.st, poly, viaRiver: true }
          : { type: 'bgriver', id: r.id, obj: r, poly });
      }
      const main = d.basin.labels.find(x => x.main);
      for (const [l, pos] of s.mapLabelPos || []) {
        if (l.kind === 'river' && pos.rect && main) labels.push({ type: 'label', id: main.branch, obj: main, rect: pos.rect });
      }
    } else {
      for (const b of s.labelBoxes || []) {
        if (b.cls === 'river-label' && b.lb) labels.push({ type: 'label', id: b.lb.branch, obj: b.lb, rect: b.rect });
      }
    }
    for (const L of lines) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const q of L.poly) { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); }
      L.bb = [x0, y0, x1, y1];
    }
    // 站点与设施的间距只在看得见的可点符号（站点、设施）之间量：地图上存根没有符号，只有汇入点，不挤占站点的热区
    const symPts = pts.filter(p => p.type === 'station' || p.type === 'facility');
    for (const p of pts) {
      const pool = p.type === 'station' || p.type === 'facility' ? symPts : pts;
      let nn = Infinity;
      for (const q of pool) if (q !== p) nn = Math.min(nn, Math.hypot(q.x - p.x, q.y - p.y));
      p.nn = nn;
      p.half = Math.min(ZONE_MAX, Math.max(ZONE_MIN, nn / 2));
    }
    model = { t, map, pts, lines, labels };
  }
  R.on('layout', buildModel);
  R.on('labels', buildModel);
  R.model = () => model;

  function pick(x, y) {
    const m = model;
    if (!m) return { hover: null, click: null };
    const shape = [], zone = [];
    for (const p of m.pts) {
      const dd = Math.hypot(x - p.x, y - p.y);
      if (p.type === 'station' ? dd <= p.r : p.tri && inTri([x, y], p.tri)) shape.push({ o: p, d: dd });
      if (Math.max(Math.abs(x - p.x), Math.abs(y - p.y)) <= p.half) zone.push({ o: p, d: dd });
    }
    let best = null, bestBg = null;
    for (const L of m.lines) {
      if (x < L.bb[0] - LINE_ZONE || x > L.bb[2] + LINE_ZONE || y < L.bb[1] - LINE_ZONE || y > L.bb[3] + LINE_ZONE) continue;
      const dd = polyDist(x, y, L.poly);
      if (dd > LINE_ZONE) continue;
      if (L.type === 'bgriver') { if (!bestBg || dd < bestBg.d) bestBg = { o: L, d: dd }; continue; }
      if (!best || dd < best.d - 0.5 || (Math.abs(dd - best.d) <= 0.5 && PRI[L.type] < PRI[best.o.type])) best = { o: L, d: dd };
    }
    if (best) zone.push(best);
    else if (bestBg) zone.push(bestBg);
    for (const l of m.labels) {
      if (x >= l.rect[0] - 2 && x <= l.rect[2] + 2 && y >= l.rect[1] - 2 && y <= l.rect[3] + 2) zone.push({ o: l, d: 0 });
    }
    const rank = a => a.length ? a.slice().sort((p, q) => PRI[p.o.type] - PRI[q.o.type] || p.d - q.d)[0].o : null;
    const clk = a => a.filter(c => CLICKABLE.has(c.o.type));
    return { hover: rank(shape) || rank(zone), click: rank(clk(shape)) || rank(clk(zone)) };
  }
  R.pick = pick;

  // ------------------------------------------------------------ 高亮集合（悬停一一对应，作者 10-01 修订 D-41）
  function edgeHL(e, H) {                           // 边：整条路径（含共用段）与两端的站（D-44）
    for (const p of e.path) H.pieces.add(p);
    H.stations.add(e.up);
    if (e.down) H.stations.add(e.down);
  }
  function hlFor(o) {
    const H = blank();
    if (!o) return H;
    switch (o.type) {
      case 'station': H.stations.add(o.id); break;                       // 只亮这个站（不再带到河口的路径）
      case 'edge': edgeHL(idx.edge.get(o.id), H); break;
      case 'facility': H.facs.add(o.id); break;
      case 'stub': case 'outflow':
        H.stubs.add(o.id);
        for (const r of o.obj.river_ids || []) H.rivers.add(r);
        break;
      case 'confluence': H.confs.add(o.id); break;                       // 只亮汇流点本身（不再带整条支流）
      case 'label':                                 // 河名：这条河的全部河段——画出的段，加同名的背景河段（小地图上看得到整条河，作者 10-01）
        for (const p of o.obj.pieces) H.pieces.add(p);
        if (o.obj.name) for (const r of R.state.d.background.rivers_geo) if (r.name === o.obj.name) H.rivers.add(r.id);
        break;
      case 'outlet': H.outlet = true; break;
      case 'bgriver': H.rivers.add(o.id); break;
    }
    return H;
  }

  R.hlFor = hlFor;                                  // 悬停规则的唯一入口（画布、小地图、侧边栏、搜索共用）；自检的反向对照经此换掉
  function renderHL() {
    const s = R.state;
    if (!s.d || !s.frame || !idx) return;
    const t = s.frame.t;
    const both = (k) => {
      const out = [];
      for (const id of HL.sel[k]) out.push({ id, sel: true });
      for (const id of HL.hover[k]) if (!HL.sel[k].has(id)) out.push({ id, sel: false });
      return out;
    };
    const cls = x => x.sel ? 'hl-line hl-sel' : 'hl-line hl-hover';
    // 作者 10-05（Q-25）：路径高亮为「套边」——河道本色不动，在河道之下垫两层：交互蓝（线宽 + 6）、其上白色（线宽 + 3），
    // 即河道两侧各一道 1.5 px 白隙、外侧各一道 1.5 px 交互蓝边；选中蓝边不透明，悬停蓝边 0.5、白隙不透明（.hl-hover）。
    // 取代 F10 的浅色光带：光带在地图上与水面同属浅蓝且画在水面之下，河道穿过水库时被水面接住、选中路径在湖岸断开。
    // hl 层在水面之后、河网之前（两个视图同一顺序）；每帧按插值后的几何与线宽重画，形变中不切换画法。
    // 线宽基准：边与河名画出的河段按该段线宽（地图视图为地图线宽），存根按存根线宽，整条支流与同名背景河段按 1 px
    const CASE = 6, GAP = 3;
    const L = R.layer.hl;
    L.selectAll('*').remove();
    const its = [];
    for (const x of both('pieces')) {
      const p = idx.piece.get(x.id);
      its.push({ d: R.pathOf(R.piecePts(p, t)), w: R.pieceW(p, t), sel: x.sel });
    }
    for (const x of both('stubs')) {
      const st = idx.stub.get(x.id);
      const m = R.stubMorph(st, t);                // F9：移动段里存根由整条支流的形变路径代替，套边跟着这条路径走
      if (m) { its.push({ d: R.scr(m.pts), w: m.w, sel: x.sel }); continue; }
      const G = R.stubGeom(st, t);
      if (G.len < 0.5) continue;
      its.push({ line: [G.J, G.E], w: st.w, sel: x.sel });
    }
    const draw = (G, it, c, w) => (it.line
      ? G.append('line').attr('x1', it.line[0][0]).attr('y1', it.line[0][1]).attr('x2', it.line[1][0]).attr('y2', it.line[1][1])
      : G.append('path').attr('d', it.d)).attr('class', c).attr('stroke-width', w);
    // 先画全部蓝边，再画全部白隙——逐条画时，相邻两段的蓝边会压住前一段的白隙，在接缝处留下蓝色横线
    const casing = (G, list) => { for (const it of list) draw(G, it, cls(it), it.w + CASE); for (const it of list) draw(G, it, 'hl-gap', it.w + GAP); };
    casing(L, its);
    const mapA = s.frame.mapA;
    if (mapA > 0) {
      const rv = [];
      for (const x of both('rivers')) {
        const r = idx.river.get(x.id);
        if (r) rv.push({ d: R.pathOf(r.d), w: 1, sel: x.sel, r });
      }
      if (rv.length) {
        const G = L.append('g').attr('opacity', mapA);            // 地图专属，随地图图层淡入淡出
        casing(G, rv);
        // 背景河网画在 hl 层之下，白隙会把它盖住：把这几条背景河道按原线宽重画在套边之上（河道本色不动）
        for (const it of rv) G.append('path').attr('class', 'bg-river').attr('d', it.d)
          .attr('stroke-width', it.r.strahler >= 5 ? 1.3 : it.r.strahler === 4 ? 1.0 : 0.75);
      }
    }
    // 光晕（规格 §4.2：半径 14、透明度 0.18；选中两端的站用 0.30）。光晕画在站点之下、圆环之下；
    // 栈内的站外面有圆环与白边（r 11 + 环宽/2 + 0.75 处、宽 1.5），半径 14 的光晕会被白边截成细条——
    // 改为放大到白边外缘再外扩 4 px（作者 10-01：光晕与圆环要叠得对，不能互相盖住）
    const Hl = R.layer.halo;
    Hl.selectAll('*').remove();
    const SS = R.stack && R.stack.state;
    // 作者 10-04（F10）：光晕提亮、不染蓝——悬停 #D1E6F1 × 0.85（即现状 0.18 交互蓝叠在白底上的合成色，白底上观感不变，
    // 河道上 3.51:1）；选中 #B2D5E8 × 0.9（现状 0.30 叠在白底上的合成色，河道上 3.15:1）。颜色与不透明度在 CSS
    const halo = (c, sel, r = 14) => Hl.append('circle').attr('class', sel ? 'halo-c sel' : 'halo-c hov').attr('cx', c[0]).attr('cy', c[1]).attr('r', r);
    const stHaloR = id => (SS && SS.ids.includes(id) ? 11 + 2.5 / 2 + 0.75 + 0.75 + 4 : 14);   // 栈内：圆环白边外缘 + 4 = 17.75（细环已取消）
    for (const x of both('stations')) halo(R.stCenter(idx.st.get(x.id), t), x.sel, stHaloR(x.id));
    for (const x of both('facs')) halo(R.facGeom(idx.fac.get(x.id), t).c, x.sel);
    for (const x of both('confs')) {
      const c = idx.conf.get(x.id);
      halo(R.P(R.lerp2(c.xy_geo, c.xy_schematic, t)), x.sel);
    }
    if (HL.sel.outlet || HL.hover.outlet) halo(R.outletGeom(t).c, HL.sel.outlet);
    // 验收修订 10-01：小地图与主视图双向联动——把当前的悬停与选中集合通知出去（小地图用同一种交互蓝画出）
    R.emit('hl', { hover: HL.hover, sel: HL.sel });
  }
  R.on('draw', renderHL);
  R.on('stack', renderHL);                          // 卡片栈变化时重画光晕（栈内站的光晕半径随圆环变）
  R.hlState = () => ({ hover: HL.hover, sel: HL.sel });

  // ------------------------------------------------------------ 悬停提示（§6.1）
  function tipHTML(o) {
    const d = R.state.d;
    const lines = [];
    switch (o.type) {
      case 'station': {
        const s = o.obj;
        lines.push(`<div class="tt-h"><b>${esc(s.short_name || s.name)}</b> <span class="tt-id">${esc(s.id)}</span></div>`);
        lines.push(`<div class="tt-sub">${esc(s.name)}</div>`);
        lines.push(`<div>${esc(T.tipToOutlet(s.dist_outlet_km))}</div>`);
        if (s.params.length) lines.push(`<div>${esc(T.tipMeasures(s.params.map(T.param)))}</div>`);
        else if (s.wmis_params.length) lines.push(`<div>${esc(T.tipRegistered(s.wmis_params))}</div>`);
        else lines.push(`<div>${esc(T.tipNoParams)}</div>`);
        const ts = R.ts;                              // M3：当前参数的最新读数、采样日期与质量码（§6.1）
        if (ts && ts.ready && ts.hasParam(s.id, ts.param)) {
          const L = ts.latest(s.id, ts.param);
          if (L) {
            const when = new Date(L.t + 10 * 36e5).toISOString().slice(0, L.kind === 'daily' ? 10 : 16).replace('T', ' ');
            lines.push(`<div>${esc(T.tipLatest(ts.pname(ts.param), d3.format(',~g')(+(+L.v).toPrecision(4)), ts.punit(ts.param), when))}</div>`);
            if (L.q != null) lines.push(`<div class="tt-note">${esc(T.tsQuality(ts.qcText(L.q)))}</div>`);
          }
        }
        const fin = s.facility_relation && s.facility_relation.in;
        if (fin) lines.push(`<div>${esc(T.tipInRes((idx.fac.get(fin) || {}).name || fin))}</div>`);
        lines.push(`<div class="tt-note">${esc(s.position_checked ? T.tipPosChecked(s.position_note) : T.tipPosAuto(s.snap_dist_m))}</div>`);
        if (model && model.map) {                     // 地图上与本站重合（< 12 px）的站（作者 09-24：陈述句）
          const me = model.pts.find(p => p.type === 'station' && p.id === s.id);
          const n = model.pts.filter(p => p.type === 'station' && p !== me && Math.hypot(p.x - me.x, p.y - me.y) < 2 * R.R_ST).length;
          if (n) lines.push(`<div class="tt-note">${esc(T.tipMore(n))}</div>`);
        }
        break;
      }
      case 'edge': {
        const e = idx.edge.get(o.id);
        lines.push(`<div>${esc(T.tipEdge(riverName(o.piece.branch), e.up, e.down || T.outletWord, e.dist_km))}</div>`);
        break;
      }
      case 'facility': {
        const f = o.obj;
        lines.push(`<div class="tt-h"><b>${esc(f.name || T.facType[f.type])}</b> · ${esc(T.facType[f.type])}</div>`);
        lines.push(`<div>${esc(T.tipOperator(f.operator))}</div>`);
        lines.push(`<div>${esc(T.tipFacSites(f.up_sites.length, f.in_sites.length, f.down_sites.length))}</div>`);
        break;
      }
      case 'stub': {
        const s = o.obj;
        lines.push(`<div class="tt-h"><b>${esc(R.stubName(s))}</b></div>`);
        lines.push(`<div class="tt-sub">${esc(T.tipStub)}</div>`);
        lines.push(`<div>${esc(T.tipArea(s.area_km2))}</div>`);
        lines.push(`<div>${esc(T.tipShare(R.stubName(s), s.share))}</div>`);
        if (s.flag_facility) lines.push(`<div class="tt-flag">${esc(T.tipStubFlag)}</div>`);
        break;
      }
      case 'outflow':
        lines.push(`<div>${esc(T.tipOutflow(o.obj.to))}</div>`);
        break;
      case 'confluence': {
        const c = o.obj, par = idx.br.get(c.branch).parent;
        lines.push(`<div class="tt-h"><b>${esc(T.tipConf(c.name || T.unnamed, riverName(par)))}</b></div>`);
        lines.push(`<div>${esc(T.tipArea(c.area_km2))}</div>`);
        lines.push(`<div>${esc(T.tipShare(c.name || T.unnamed, c.share))}</div>`);
        break;
      }
      case 'outlet':
        lines.push(`<div>${esc(T.tipOutlet(d.basin.outlet_to))}</div>`);
        break;
      case 'bgriver':
        lines.push(`<div>${esc(o.obj.name)}</div>`);
        break;
      case 'label':
        return null;                                  // 河名标注只高亮整条河（§6.1）
    }
    return lines.join('');
  }
  function showTip(o, x, y) {
    const html = o && tipHTML(o);
    if (!html) { hideTip(); return; }
    tip.html(html).style('display', 'block');
    const w = tip.node().offsetWidth, h = tip.node().offsetHeight;
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    let tx = x + 14, ty = y + 16;
    if (tx + w > cw - 4) tx = x - 14 - w;
    if (ty + h > ch - 4) ty = y - 12 - h;
    tip.style('left', Math.max(4, tx) + 'px').style('top', Math.max(4, ty) + 'px');
  }
  function hideTip() { tip.style('display', 'none'); }

  // ------------------------------------------------------------ 指针
  const same = (a, b) => a === b || (a && b && a.type === b.type && a.id === b.id);
  function onMove(x, y) {
    if (R.state.busy || !model) return;
    const r = pick(x, y);
    svgEl.style.cursor = r.click ? 'pointer' : '';   // 可点：手形；只悬停：默认（§6.1）
    if (!same(r.hover, hoverObj)) {
      hoverObj = r.hover;
      HL.hover = R.hlFor(r.hover);
      renderHL();
    }
    showTip(r.hover, x, y);
    return r;
  }
  function onLeave() {
    hoverObj = null; HL.hover = blank(); renderHL(); hideTip(); svgEl.style.cursor = '';
  }
  const local = ev => { const b = svgEl.getBoundingClientRect(); return [ev.clientX - b.left, ev.clientY - b.top]; };
  let down = null;
  svgEl.addEventListener('pointermove', ev => { const [x, y] = local(ev); onMove(x, y); });
  svgEl.addEventListener('pointerleave', onLeave);
  svgEl.addEventListener('pointerdown', ev => { down = local(ev); });
  svgEl.addEventListener('click', ev => {
    const p = local(ev);
    if (down && Math.hypot(p[0] - down[0], p[1] - down[1]) > DRAG) { down = null; return; }   // 拖动，不选择
    down = null;
    if (R.state.busy) return;
    clickAt(p[0], p[1]);
  });
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape') { clearSel(); if (R.stack) R.stack.closeTemp(); } });

  // ------------------------------------------------------------ 选择
  function setSel(H) { HL.sel = H; renderHL(); }
  function clearSel() { setSel(blank()); }
  R.clearSel = clearSel;
  function selectEdge(eid, stub) {
    const e = idx.edge.get(eid);
    if (!e) return;
    const H = blank();
    edgeHL(e, H);
    if (stub) { H.stubs.add(stub.id); for (const r of stub.river_ids || []) H.rivers.add(r); }
    setSel(H);
    // 作者 09-30：不再把下游站塞进卡片栈（修订 D-45），改为弹出存根 / 边的临时卡片，末行链接才打开站点卡片
    if (R.stack) { if (stub) R.stack.openStub(stub.id); else R.stack.openEdge(eid); }
  }
  function doClick(o) {
    if (!o) { clearSel(); if (R.stack) R.stack.closeTemp(); return; }
    switch (o.type) {
      case 'station': clearSel(); if (R.stack) R.stack.add(o.id, {}); break;
      case 'facility': { const H = blank(); H.facs.add(o.id); setSel(H); if (R.stack) R.stack.openFacility(o.id); break; }
      case 'edge': selectEdge(o.id, null); break;
      case 'stub': selectEdge(o.obj.edge_owner || o.obj.edge, o.obj); break;
    }
  }
  function clickAt(x, y) { const r = pick(x, y); doClick(r.click); return r.click; }
  R.selectEdge = selectEdge;
  // 面板悬停 → 画布同步高亮（§5.4 联动高亮）；arg 形如 'station:405204'、'stub:S…'、'facility:F…'、'confluence:7'
  R.preview = arg => {
    if (R.state.busy || !idx) return;
    let o = null;
    if (arg) {
      const i = arg.indexOf(':'), type = arg.slice(0, i), id = arg.slice(i + 1);
      const obj = type === 'stub' ? idx.stub.get(id) : type === 'station' ? idx.st.get(id) : type === 'facility' ? idx.fac.get(id)
        : type === 'confluence' ? idx.conf.get(+id) : type === 'edge' ? idx.edge.get(id) : null;   // edge：小地图悬停河段
      if (obj) o = { type, id: type === 'confluence' ? +id : id, obj };
    }
    if (same(o, hoverObj)) return;
    hoverObj = o; HL.hover = R.hlFor(o); renderHL();
  };
  R.on('morphstart', () => { hoverObj = null; HL.hover = blank(); hideTip(); svgEl.style.cursor = ''; });
  // 缩放、平移中命中模型失效：清掉悬停，结束时 layout 事件重建（T-12）
  R.on('zoomstart', () => { model = null; hoverObj = null; HL.hover = blank(); renderHL(); hideTip(); svgEl.style.cursor = ''; });

  // ------------------------------------------------------------ 自检：锚点、模拟悬停与点击、点击准确性
  function anchor(type, id) {
    if (!model) return null;
    const insideStation = (x, y) => model.pts.some(p => p.type === 'station' && Math.hypot(x - p.x, y - p.y) <= p.r + 0.5);
    const inPtZone = (x, y) => model.pts.some(p => Math.max(Math.abs(x - p.x), Math.abs(y - p.y)) <= p.half);
    if (type === 'edge' || type === 'bgriver' || ((type === 'stub' || type === 'outflow') && !model.map)) {
      let best = null;
      for (const L of model.lines) {
        if (L.type !== type || String(L.id) !== String(id)) continue;
        for (let i = 1; i < L.poly.length; i++) {
          const a = L.poly[i - 1], b = L.poly[i];
          const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
          for (const f of [0.5, 0.3, 0.7, 0.15, 0.85]) {
            const q = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
            const free = !inPtZone(q[0], q[1]);
            const score = (free ? 1e6 : 0) + len;
            if (!best || score > best.score) best = { q, score };
          }
        }
      }
      return best && best.q;
    }
    if (type === 'label') { const l = model.labels.find(x => String(x.id) === String(id)); return l && [(l.rect[0] + l.rect[2]) / 2, (l.rect[1] + l.rect[3]) / 2]; }
    const p = model.pts.find(x => x.type === type && String(x.id) === String(id));
    if (!p) return null;
    if (p.type === 'facility' && model.map) {        // 地图：取三角露在站点圆外的点
      const [A, B, C] = p.tri;
      for (let i = 1; i < 40; i++) for (let j = 1; j < 40 - i; j++) {
        const u = i / 40, v = j / 40, w = 1 - u - v;
        const q = [A[0] * u + B[0] * v + C[0] * w, A[1] * u + B[1] * v + C[1] * w];
        if (!insideStation(q[0], q[1])) return q;
      }
    }
    return [p.x, p.y];
  }
  R.anchor = anchor;

  function selftest() {
    const m = model, out = { view: m.map ? 'map' : 'schematic', stations: {}, facilities: {}, edges: {}, stubs: {} };
    const st = out.stations;
    st.n = 0; st.center_ok = 0; st.coincident = 0; st.edge_ok = 0; st.edge_other_nearer = 0; st.edge_fac = 0; st.wrong = [];
    st.zone_min_px = Infinity; st.zone_lt8 = [];     // zone_lt8：与最近的站点或设施相距 < 8 px（热区只能按最近者分割）
    const stPts = m.pts.filter(p => p.type === 'station');
    for (const p of stPts) {
      st.n++;
      st.zone_min_px = Math.min(st.zone_min_px, 2 * p.half);
      if (2 * Math.min(ZONE_MAX, p.nn / 2) < 8) st.zone_lt8.push(p.id);
      const twin = stPts.filter(q => q !== p && Math.hypot(q.x - p.x, q.y - p.y) < 1);
      const c = pick(p.x, p.y).click;
      if (c && c.type === 'station' && (c.id === p.id || twin.some(q => q.id === c.id))) { st.center_ok++; if (twin.length) st.coincident++; }
      else st.wrong.push({ id: p.id, at: 'center', got: c && c.type + ':' + c.id });
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = p.x + dx * 0.9 * p.half, y = p.y + dy * 0.9 * p.half;
        const r = pick(x, y).click;
        const dMe = Math.hypot(x - p.x, y - p.y);
        if (r && r.type === 'station' && r.id === p.id) st.edge_ok++;
        else if (r && r.type === 'station' && Math.hypot(x - r.x, y - r.y) <= dMe + 1e-6) st.edge_other_nearer++;
        else if (r && r.type === 'facility' && inTri([x, y], r.tri)) st.edge_fac++;
        else st.wrong.push({ id: p.id, at: [Math.round(x), Math.round(y)], got: r && r.type + ':' + r.id });
      }
    }
    const fa = out.facilities;
    fa.n = 0; fa.ok = 0; fa.no_exposed_point = []; fa.wrong = [];
    for (const p of m.pts.filter(q => q.type === 'facility')) {
      fa.n++;
      const q = anchor('facility', p.id);
      const hidden = m.map && q[0] === p.x && q[1] === p.y && stPts.some(s => Math.hypot(s.x - p.x, s.y - p.y) <= s.r);
      if (hidden) { fa.no_exposed_point.push(p.id); continue; }
      const r = pick(q[0], q[1]).click;
      if (r && r.type === 'facility' && r.id === p.id) fa.ok++; else fa.wrong.push({ id: p.id, got: r && r.type + ':' + r.id });
    }
    // 线上每隔 25 px（沿线长）取一点；落在点状对象热区里的跳过（那里按优先顺序应选点状对象）。
    // 期望：该边；或离得更近的另一条线（间距的一半，D-44）；或这条边上的存根——汇入点处存根按优先顺序（存根 > 边，D-44）胜出。
    // 作者 09-30 起存根与边各自弹出临时卡片（不再路由到同一个下游站），所以存根胜出单独计数
    const along = (poly, step) => {
      const out_ = [];
      let acc = step / 2;
      for (let i = 1; i < poly.length; i++) {
        const a = poly[i - 1], b = poly[i], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        while (acc <= len) { out_.push([a[0] + (b[0] - a[0]) * acc / len, a[1] + (b[1] - a[1]) * acc / len]); acc += step; }
        acc -= len;
      }
      return out_;
    };
    const onSymbol = q => m.pts.some(p => p.type === 'station' ? Math.hypot(q[0] - p.x, q[1] - p.y) <= p.r
      : p.tri && inTri(q, p.tri));
    const ed = out.edges;
    ed.n = 0; ed.ok = 0; ed.stub_priority = 0; ed.other_line_nearer = 0; ed.skipped_in_point_zone = 0; ed.wrong = [];
    for (const L of m.lines.filter(l => l.type === 'edge')) {
      for (const q of along(L.poly, 25)) {
        if (onSymbol(q) || m.pts.some(p => Math.max(Math.abs(q[0] - p.x), Math.abs(q[1] - p.y)) <= p.half)) {
          ed.skipped_in_point_zone++; continue;
        }
        ed.n++;
        const r = pick(q[0], q[1]).click;
        if (r && r.type === 'edge' && r.id === L.id) ed.ok++;
        else if (r && r.type === 'stub' && (r.obj.edge_owner === L.id || r.obj.edge === L.id)) ed.stub_priority++;
        else if (r && (r.type === 'edge' || r.type === 'stub') && r.poly && polyDist(q[0], q[1], r.poly) <= 0.5) ed.other_line_nearer++;
        else ed.wrong.push({ edge: L.id, at: q.map(Math.round), got: r && r.type + ':' + r.id });
      }
    }
    // 存根：示意图取短线中点；地图取汇入点（没有符号）——落在站点、设施热区里的跳过
    const sb = out.stubs;
    sb.n = 0; sb.ok = 0; sb.other_nearer = 0; sb.skipped_in_symbol_zone = 0; sb.wrong = [];
    const symZone = q => m.pts.some(p => (p.type === 'station' || p.type === 'facility') &&
      Math.max(Math.abs(q[0] - p.x), Math.abs(q[1] - p.y)) <= p.half);
    const stubIds = m.map ? m.pts.filter(p => p.type === 'stub').map(p => p.id)
      : m.lines.filter(l => l.type === 'stub').map(l => l.id);
    for (const id of stubIds) {
      const q = anchor('stub', id);
      if (symZone(q)) { sb.skipped_in_symbol_zone++; continue; }
      sb.n++;
      const r = pick(q[0], q[1]).click;
      if (r && r.type === 'stub' && r.id === id) sb.ok++;
      else if (r && r.type === 'stub' && r.x !== undefined && Math.hypot(q[0] - r.x, q[1] - r.y) <= 0.5) sb.other_nearer++;
      else sb.wrong.push({ id, got: r && r.type + ':' + r.id });
    }
    return out;
  }
  R.selftest = selftest;

  // 调试参数：在静止视图就绪后执行一次
  let debugDone = false;
  R.on('layout', () => {
    if (debugDone || !model) return;
    debugDone = true;
    const Q = R.Q;
    const parse = s => { const i = s.indexOf(':'); return [s.slice(0, i), s.slice(i + 1)]; };
    const log = [];
    for (const c of (Q.get('click') || '').split(',').filter(Boolean)) {
      const [ty, id] = parse(c);
      const a = anchor(ty, id);
      const got = a ? clickAt(a[0], a[1]) : null;
      log.push({ click: c, at: a && a.map(v => Math.round(v * 10) / 10), got: got && got.type + ':' + got.id });
    }
    let hp = null;
    if (Q.get('hover')) { const [ty, id] = parse(Q.get('hover')); hp = anchor(ty, id); }
    if (Q.get('pt')) hp = Q.get('pt').split(',').map(Number);
    if (hp) {
      const go = () => {
        const r = onMove(hp[0], hp[1]);
        log.push({ hover: Q.get('hover') || Q.get('pt'), at: hp.map(v => Math.round(v * 10) / 10), got: r && r.hover && r.hover.type + ':' + r.hover.id });
        document.body.dataset.debug = JSON.stringify(log);
      };
      if (R.ts && !R.ts.ready && !R.ts.failed) {
        const iv = setInterval(() => { if (R.ts.ready || R.ts.failed) { clearInterval(iv); setTimeout(go, 30); } }, 20);
      } else go();
    }
    if (log.length) document.body.dataset.debug = JSON.stringify(log);
    if (Q.get('selftest')) document.body.dataset.selftest = JSON.stringify(selftest());
  });
})();
