/*
 * minimap.js — T-12 小地图与视野框（impl-spec §7、§6.3；D-35、D-52）；验收修订（作者 10-01）
 *
 * 位置：原在侧边栏底部（110–190 px，看不清），改到画布角落，宽约 260 px、高随流域外包框比例、长边上限 280 px（作者 10-01 放大，原 200 / 220）；
 *   与图例分居两角，与说明块、图例一起选位置（作者 10-04，legend.js 的 arrange；小地图自己的顺序右下起）；地图视图下隐藏（D-35）。
 * 内容：地图视图的缩小版——流域轮廓、诱导子树、水库水面、站点、坝标记；不画背景河网、城镇与标注；形状跟随地理外包框（北向上）。
 * 交互：不可点选（D-35），可悬停，与主视图双向联动高亮，两边同一种交互蓝（Hoang 2021 的 inset map：悬停让两图同时亮起）：
 *   - 主视图悬停或选中站、河、坝 → interact.js 发出 'hl'（悬停与选中集合）→ 小地图对应位置亮起；
 *   - 悬停小地图某处 → 找最近的站（6 px 内）、坝（6 px 内）或河段（4 px 内）→ R.preview → 主视图亮起，'hl' 再回到小地图。
 *   示意图放大时框出当前视野。
 * 状态的画法（作者 10-01）：一个渲染函数 render() 同时读两套状态——卡片栈（持久）与当前高亮集合（临时，R.hlState()）。
 *   原则：实心 = 持久（在卡片栈里），空心 = 临时（本次高亮带出来的），悬停另加光晕；目标是「亮的几个浮在灰底上」。
 *   - 普通站 r 1.5：栈非空或有高亮时淡成浅灰，两者都没有时为深色；
 *   - 栈内的站 r 4 实心交互蓝加白边；临时亮起的站（选中边或存根带出的两端站、悬停到但不在栈里的站）r 4 空心环（线宽 1.2）加白边；
 *   - 悬停：在上述样式之外再加一圈光晕，移开即消失；
 *   - 路径 3 px 交互蓝：选中态实色、悬停态半透明（与画布 1 / 0.5 对应）；水面高亮同理；
 *   - 坝与存根汇入点按同一原则：临时亮起为空心环加白边，悬停加光晕（坝、存根不进卡片栈，没有实心态）。
 *
 * 作者标注：本文件由 Claude Code（M4 T-12，2026-09-24；验收修订 2026-10-01）编写，见 docs/plan.md §11。
 */
(function () {
  'use strict';
  const R = window.River;
  const box = d3.select('#minimap');
  const canvas = document.getElementById('canvas');
  const ORDER = ['br', 'tr', 'tl', 'bl'];
  const M = { geo: null, w: 0, h: 0, corner: null, overlap: 0, legend: null, pe: new Map(), hl: 0 };
  // 作者 10-01：由宽 200、长边 220 放大到宽 260、长边 280（右下角本来空着；空心环在 12 px 的点上才清楚）。
  // 位置与说明块、图例一起选（作者 10-04）：不压可点击对象，再比压线总数；压住的线从半透明面板下穿过，不再躲避
  const PAD = 6, BASE_W = 260, MAX_SIDE = 280;

  // 小地图的尺寸只取决于流域轮廓的长宽比：宽 260，长边不超过 280
  function sizeOf(d) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const ring of d.background.outline_geo) for (const [x, y] of ring) {
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    const asp = (y1 - y0) / (x1 - x0);
    let W = BASE_W, H = Math.round((BASE_W - 2 * PAD) * asp + 2 * PAD);
    if (H > MAX_SIDE) { H = MAX_SIDE; W = Math.round((MAX_SIDE - 2 * PAD) / asp + 2 * PAD); }
    return [W, H];
  }

  function build() {
    const d = R.state.d;
    if (!d) return;
    box.html('');
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const ring of d.background.outline_geo) for (const [x, y] of ring) {
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    const [W, H] = sizeOf(d);
    M.w = W; M.h = H;
    const k = Math.min((W - 2 * PAD) / (x1 - x0), (H - 2 * PAD) / (y1 - y0));
    const ox = (W - (x1 - x0) * k) / 2 - x0 * k, oy = (H - (y1 - y0) * k) / 2 - y0 * k;
    M.geo = p => [ox + p[0] * k, oy + p[1] * k];
    const geo = M.geo;
    const line = pts => 'M' + pts.map(p => geo(p).map(v => v.toFixed(1)).join(',')).join('L');
    const svg = box.append('svg').attr('width', W).attr('height', H).attr('class', 'mm');
    svg.append('g').selectAll('path').data(d.background.outline_geo).enter().append('path').attr('class', 'mm-outline').attr('d', r => line(r) + 'Z');
    svg.append('g').selectAll('path').data(d.background.waterbodies_geo).enter().append('path').attr('class', 'mm-water')
      .attr('d', w => w.rings.map(r => line(r) + 'Z').join(''));
    svg.append('g').selectAll('path').data(R.state.pieces).enter().append('path').attr('class', 'mm-river')
      .attr('d', p => line(p.geo)).attr('stroke-width', p => Math.max(0.7, p.w_geo * 0.4));
    svg.append('g').selectAll('path').data(d.facilities).enter().append('path').attr('class', f => 'mm-fac ' + f.type)
      .attr('d', f => { const c = geo(f.xy_geo); return `M${c[0]},${c[1] - 3.5}L${c[0] - 3},${c[1] + 2}L${c[0] + 3},${c[1] + 2}Z`; });
    svg.append('g').attr('class', 'mm-st').selectAll('circle').data(d.stations).enter().append('circle')
      .attr('cx', s => geo(s.xy_geo)[0]).attr('cy', s => geo(s.xy_geo)[1]).attr('r', 1.5);
    svg.append('g').attr('class', 'mm-hl');
    svg.append('rect').attr('class', 'mm-frame').style('display', 'none');
    // 段 → 边（悬停小地图上的河时，主视图高亮整条边，与主视图的悬停一致）
    M.pe = new Map();
    for (const e of d.edges) for (const p of e.pieces) M.pe.set(p.id, e.id);
    M.riv = new Map(d.background.rivers_geo.map(r => [r.id, r]));          // 存根整条支流、同名河段的几何（小地图平时不画）
    // 悬停：不可点选，点击不穿透到画布
    const node = svg.node();
    node.addEventListener('pointermove', ev => {
      if (R.state.busy || R.state.view !== 'schematic') return;
      const b = node.getBoundingClientRect(), q = [ev.clientX - b.left, ev.clientY - b.top];
      R.preview(pick(q));
    });
    node.addEventListener('pointerleave', () => R.preview && R.preview(null));
    box.on('click', ev => ev.stopPropagation()).on('pointerdown', ev => ev.stopPropagation());
    update();
    place();                                         // 图例可能已先选好角落
  }

  function pick(q) {                                 // 小地图坐标 → 'station:id' | 'facility:id' | 'edge:id' | null
    const d = R.state.d;
    let best = null, bd = 6;
    for (const s of d.stations) { const c = M.geo(s.xy_geo), dd = Math.hypot(c[0] - q[0], c[1] - q[1]); if (dd < bd) { bd = dd; best = 'station:' + s.id; } }
    if (best) return best;
    for (const f of d.facilities) { const c = M.geo(f.xy_geo), dd = Math.hypot(c[0] - q[0], c[1] - q[1]); if (dd < bd) { bd = dd; best = 'facility:' + f.id; } }
    if (best) return best;
    bd = 4;
    for (const p of R.state.pieces) {
      const g = p.geo;
      for (let i = 1; i < g.length; i++) {
        const a = M.geo(g[i - 1]), b = M.geo(g[i]);
        const vx = b[0] - a[0], vy = b[1] - a[1], L2 = vx * vx + vy * vy || 1;
        const t = Math.max(0, Math.min(1, ((q[0] - a[0]) * vx + (q[1] - a[1]) * vy) / L2));
        const dd = Math.hypot(a[0] + t * vx - q[0], a[1] + t * vy - q[1]);
        if (dd < bd && M.pe.has(p.id)) { bd = dd; best = 'edge:' + M.pe.get(p.id); }
      }
    }
    return best;
  }

  // 主视图的悬停与选中、卡片栈 → 小地图（交互蓝）。高亮扩展到全部可见元素（作者 10-01），河段才是形变要建立的对应——
  //   边 → 这一段真实河道（段的 geo）；河名 → 这条河的全部河段（画出的段 + 同名背景河段）；
  //   存根 → 整条未监测支流（D-32：悬停或选中时高亮整条支流，背景河网 rivers_geo）；调节设施 → 坝的位置点与水库水面。
  //   小地图上的线很细，高亮一律 3 px（宁可比例失真也要看得见，小地图本来就是示意）。
  // 一个函数同时读卡片栈与当前高亮集合（作者 10-01 合并渲染）：实心 = 在卡片栈里，空心 = 本次高亮带出来的，悬停另加光晕
  const HLW = 3, R_PT = 4, R_EDGE = 5.2, R_HALO = 8, R_SUB = 3;   // 点半径、白边半径、光晕半径、坝与存根点半径
  function render() {
    const d = R.state.d;
    if (!d || !M.geo) return;
    const h = R.hlState ? R.hlState() : null;
    const E = new Set();
    const hov = k => (h ? h.hover[k] : E), sel = k => (h ? h.sel[k] : E);
    const stack = new Set(R.stack ? R.stack.state.ids : []);
    const active = stack.size > 0 || !!h && ['pieces', 'stations', 'stubs', 'rivers', 'facs', 'confs'].some(k => hov(k).size || sel(k).size)
      || !!h && (h.hover.outlet || h.sel.outlet);
    box.selectAll('.mm-st circle').attr('class', active ? 'dim' : null);   // 普通站：有栈或有高亮时淡成浅灰
    const G = box.select('.mm-hl');
    G.selectAll('*').remove();
    const line = pts => 'M' + pts.map(p => M.geo(p).map(v => v.toFixed(1)).join(',')).join('L');
    const state = (k, id) => (sel(k).has(id) ? 'sel' : hov(k).has(id) ? 'hov' : null);
    const n = { water: 0, rivers: 0, pieces: 0, points: 0 };
    // 面与线：选中实色，悬停半透明
    for (const w of d.background.waterbodies_geo) {
      const s_ = w.facility && state('facs', w.facility);
      if (s_) { G.append('path').attr('class', 'mm-hl-water' + (s_ === 'hov' ? ' hov' : '')).attr('d', w.rings.map(r => line(r) + 'Z').join('')); n.water++; }
    }
    const rvIds = new Set([...hov('rivers'), ...sel('rivers')]);
    for (const id of rvIds) { const r = M.riv.get(id); if (r) { G.append('path').attr('class', 'mm-hl-line' + (state('rivers', id) === 'hov' ? ' hov' : '')).attr('d', line(r.d)).attr('stroke-width', HLW); n.rivers++; } }
    for (const p of R.state.pieces) { const s_ = state('pieces', p.id); if (s_) { G.append('path').attr('class', 'mm-hl-line' + (s_ === 'hov' ? ' hov' : '')).attr('d', line(p.geo)).attr('stroke-width', HLW); n.pieces++; } }
    // 点：先画全部光晕，再画全部白边，最后画点（相邻的点白边不压住别的点）
    const P = [];
    for (const s of d.stubs) { const s_ = state('stubs', s.id); if (s_) P.push({ c: M.geo(s.junction_geo), r: R_SUB, solid: false, hl: true, hover: hov('stubs').has(s.id) }); }
    for (const f of d.facilities) { const s_ = state('facs', f.id); if (s_) P.push({ c: M.geo(f.xy_geo), r: R_SUB, solid: false, hl: true, hover: hov('facs').has(f.id) }); }
    for (const s of d.stations) {
      const inS = stack.has(s.id), s_ = state('stations', s.id);
      if (inS || s_) P.push({ c: M.geo(s.xy_geo), r: R_PT, solid: inS, hl: !!s_, hover: hov('stations').has(s.id) });
    }
    for (const p of P) if (p.hover) G.append('circle').attr('class', 'mm-hl-halo').attr('cx', p.c[0]).attr('cy', p.c[1]).attr('r', R_HALO);
    for (const p of P) G.append('circle').attr('class', 'mm-hl-edge').attr('cx', p.c[0]).attr('cy', p.c[1]).attr('r', p.r + (R_EDGE - R_PT));
    for (const p of P) {
      // mm-hl-pt：当前高亮集合里的点（临时或悬停，不论是否也在栈里）；mm-stack-pt：卡片栈里的站
      const cls = [p.solid ? 'mm-stack-pt' : 'mm-tmp-pt', p.hl ? 'mm-hl-pt' : ''].filter(Boolean).join(' ');
      G.append('circle').attr('class', cls).attr('cx', p.c[0]).attr('cy', p.c[1]).attr('r', p.r);
      if (p.hl) n.points++;
    }
    M.hl = G.node().childNodes.length;
    M.hlCounts = n;
  }

  // 选位置（作者 10-04）：与说明块、图例一起选（legend.js 的 arrange），这里只取分给小地图的位置。
  // 只在载入流域、切换视图时选；缩放、平移不重算，按原位置贴边，压住的线从面板下穿过（作者 10-01）。
  // 地图视图下小地图隐藏（D-35），不参加；切回示意图时随图例一起重选
  function place() {
    if (!R.corners || !M.w) return;
    const ob = R.corners.obstacles();
    const ow = M.w + 10, oh = M.h + 10;            // 含内边距与边框
    const a = R.corners.assigned('minimap');
    if (a && a.seq !== M.seq) {
      M.corner = a.id; M.slid = a.slid; M.seq = a.seq; M.key = a.key;
      M.scores = Object.fromEntries(Object.entries(a.scores).map(([c, v]) => [c, v[0] + v[1] + v[2]]));
    }
    if (!M.corner) M.corner = ORDER[0];
    const r = R.corners.placeAt(M.corner, ow, oh);
    M.rect = r;
    M.overlapCats = R.corners.overlapCats(r, ob);  // [站点, 存根与坝标记, 线与其他]（缩放后可能 > 0）
    M.overlap = M.overlapCats[0] + M.overlapCats[1] + M.overlapCats[2];
    box.style('left', r[0] + 'px').style('top', r[1] + 'px');
  }

  function update() {
    const d = R.state.d;
    if (!d || !M.geo) return;
    box.style('display', R.state.view === 'map' ? 'none' : null);      // 地图视图下隐藏（D-35）
    render();
    const z = R.state.zt;
    const fr = box.select('.mm-frame');
    if (R.state.view !== 'schematic' || !z || z.k <= 1.001) { fr.style('display', 'none'); return; }
    const { cw, ch } = R.state.fit, t = 1;
    const seen = [];
    const inView = q => q[0] >= 0 && q[0] <= cw && q[1] >= 0 && q[1] <= ch;
    for (const s of d.stations) if (inView(R.stCenter(s, t))) seen.push(s.xy_geo);
    for (const p of R.state.pieces) {
      const n = p.sch_m.length;
      for (let i = 0; i < n; i += 2) if (inView(R.P(p.sch_m[i]))) seen.push(p.geo_m[i]);
    }
    if (!seen.length) { fr.style('display', 'none'); return; }
    const g = seen.map(M.geo);
    const xs = g.map(q => q[0]), ys = g.map(q => q[1]);
    const a = [Math.min(...xs) - 3, Math.min(...ys) - 3], b = [Math.max(...xs) + 3, Math.max(...ys) + 3];
    fr.style('display', null).attr('x', a[0]).attr('y', a[1]).attr('width', b[0] - a[0]).attr('height', b[1] - a[1]);
  }

  R.on('build', () => setTimeout(build, 0));
  R.on('layout', update);
  R.on('zoom', update);
  R.on('sidebar', () => setTimeout(update, 0));
  R.on('stack', update);
  R.on('hl', render);
  R.on('legendplaced', e => { M.legend = e.corner; M.legendRect = e.rect; place(); });
  R.on('cornersreset', () => { M.seq = null; });
  R.on('morphstart', () => box.select('.mm-frame').style('display', 'none'));
  window.addEventListener('resize', () => setTimeout(build, 0));
  R.minimap = { build, update, ORDER, size: () => { const d = R.state.d; if (!d) return null; const [w, h] = sizeOf(d); return [w + 10, h + 10]; },
    info: () => ({ corner: M.corner, slid: M.slid || null, rect: M.rect && M.rect.map(v => Math.round(v * 10) / 10),
    overlap: M.overlap, overlap_cats: M.overlapCats, scores: M.scores, legend: M.legend, legend_rect: M.legendRect && M.legendRect.map(v => Math.round(v * 10) / 10), w: M.w, h: M.h,
    visible: getComputedStyle(box.node()).display !== 'none', hl: M.hl, hl_counts: M.hlCounts || null }) };
})();
