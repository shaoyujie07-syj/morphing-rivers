/*
 * app.js — 站点层河网示意图：示意图视图（T-06）、地图视图（T-07）、形变（T-08）
 *
 * 前端只做插值与渲染（D-13、impl-spec §2）：所有坐标、段的切分、存根与设施的位置、流向箭头的位置
 * 都由 src/export_basin.py 算好写进 data/{basin}.js；这里只把两套坐标按进度线性插值后画出来。
 * 河名标注的避让放在前端做，因为要量文字宽度、缩放后重算（impl-spec §4.4）。
 *
 * 调试参数（仅供自检截图用，不是面向用户的功能）：
 *   ?basin=goulburn            流域
 *   &view=map|schematic        初始视图（默认 map，D-52）
 *   &morph=0..1&dir=toSchematic|toMap   冻结在形变的某一时刻
 *   &zoom=cx,cy,k&zoomback=0..1         冻结在「回全景」过渡（形变前，0.3 s）的某一时刻（作者 10-01 截图用）
 *   &geo=m                     地图视图改用形变用的重采样几何（与完整几何对比用）
 *   M2 的交互调试参数见 interact.js 开头。
 *
 * M2 起本文件对外开放 window.River（状态、几何函数、事件钩子），interact.js、stack.js、legend.js 通过它
 * 读当前帧的几何、在 draw 之后叠画高亮与圆环；布局与派生值仍只来自导出数据。
 *
 * 作者标注：本文件由 Claude Code（T-06/T-07/T-08，2026-09-23；M2，2026-09-24）编写，见 docs/plan.md §11。
 */
(function () {
  'use strict';

  const W0 = 1280, H0 = 900;                 // 导出坐标所用的参考画布（1700 × 950 窗口减 420 px 侧边栏与顶部栏；验收修订 10-01）
  const R_ST = 6;                            // 站点半径（规格 §4.2）
  const HALO = { schematic: 1.5, map: 2 };   // 站点白色描边：示意图 1.5，地图 2（规格 §4.2、T-07）
  const FAC = { storage: [12, 14], weir: [10, 12] };   // 宽、高；蓄水 16×20 → 12×14（作者 09-24）
  // 存根末端削角（作者 10-01，取代 4 × 4 px 小箭头）：尖朝河道 = 流入，尖朝外 = 流出；尖的长度随存根粗细，
  // 粗的存根尖也长，所以无论多粗都看得出方向。流入存根的尖离汇入点留 4 px（原箭头尖的位置）
  const STUB_GAP = 4;
  const stubTip = w => Math.max(3, 1.5 * w);
  const OUTLET_H = 10;                       // 河口箭头高 [初值]
  const CHEV = 8;                            // 流向 V 形高 [初值]
  const PHASE = { labels: 0.3, move: 1.2, map: 0.5 };   // 形变三段（秒，D-52）
  const TOTAL = PHASE.labels + PHASE.move + PHASE.map;
  const FONT = '11px "Segoe UI", "Microsoft YaHei", "PingFang SC", system-ui, sans-serif';
  const FONT_END = '600 13px "Segoe UI", "Microsoft YaHei", "PingFang SC", system-ui, sans-serif';

  const Q = new URLSearchParams(location.search);
  const LANG = 'en';                                     // 托管版只有英文：中文文案与 ?lang=zh 已移除（开发仓库仍保留）
  const TXT = window.RIVER_TXT;                          // 界面文字在 i18n.js（M2 起集中）
  const T = TXT[LANG];
  document.documentElement.lang = 'en';
  document.title = T.title;
  document.getElementById('basin-select').setAttribute('aria-label', T.basinSelect);

  const ease = d3.easeCubicInOut;            // 规格 §5.3 [初值]
  const svg = d3.select('#svg');
  const root = svg.append('g');
  const layer = {};
  // 水面画在背景河网之上、河道之下（作者 09-24：灰色背景河段不得盖住湖面）
  // M2 插入三层，M1 的 z 序不变：hl（路径高亮，河道与存根之上）、halo（悬停光晕，设施之下）、rings（栈内圆环，站点之上）
  // M3+M4 增补：towns（地图城镇，地理背景角色）在水面之上、河道之下
  for (const k of ['bg', 'bgRivers', 'water', 'towns', 'pieces', 'stubs', 'hl', 'ratio', 'outlet', 'halo', 'fac', 'arrows', 'stations',
    'rings', 'labels', 'mapLabels']) layer[k] = root.append('g').attr('class', 'layer-' + k);

  const state = { id: null, d: null, view: Q.get('view') === 'schematic' ? 'schematic' : 'map', busy: false,
    fit: { k: 1, ox: 0, oy: 0, cw: W0, ch: H0 }, labels: [] };

  // 事件钩子（M2）：build 新流域元素建好；draw 每画一帧之后；layout 静止视图就绪（载入、形变结束、窗口变化）；
  // morphstart 形变开始
  const hooks = {};
  const on = (ev, fn) => { (hooks[ev] = hooks[ev] || []).push(fn); };
  const emit = (ev, ...a) => { for (const fn of hooks[ev] || []) fn(...a); };

  // ------------------------------------------------------------ 小工具
  const lerp = (a, b, t) => a + (b - a) * t;
  const lerp2 = (p, q, t) => [lerp(p[0], q[0], t), lerp(p[1], q[1], t)];
  const norm = v => { const n = Math.hypot(v[0], v[1]) || 1; return [v[0] / n, v[1] / n]; };
  const P = p => [state.fit.ox + p[0] * state.fit.k, state.fit.oy + p[1] * state.fit.k];
  const pathOf = pts => 'M' + pts.map(p => { const q = P(p); return q[0].toFixed(1) + ',' + q[1].toFixed(1); }).join('L');
  const tri = (c, u, w, h) => {              // 尖端朝 u 的三角：中心 c，沿 u 高 h，横跨宽 w
    const n = [-u[1], u[0]];
    const tip = [c[0] + u[0] * h / 2, c[1] + u[1] * h / 2];
    const b = [c[0] - u[0] * h / 2, c[1] - u[1] * h / 2];
    return `M${tip}L${b[0] + n[0] * w / 2},${b[1] + n[1] * w / 2}L${b[0] - n[0] * w / 2},${b[1] - n[1] * w / 2}Z`;
  };

  // ------------------------------------------------------------ 画布尺寸
  // 缩放（T-12，D-52）：state.base 为全景的等比适配，state.zt 为 d3.zoom 的变换（倍数 1–8）；
  // state.fit = 两者复合，位置按它换算。符号与线宽是固定像素，只有位置拉开（只做几何缩放）。
  function fit() {
    const box = document.getElementById('canvas').getBoundingClientRect();
    const k = Math.min(box.width / W0, box.height / H0);
    state.base = { k, ox: (box.width - W0 * k) / 2, oy: (box.height - H0 * k) / 2, cw: box.width, ch: box.height };
    if (!state.zt) state.zt = d3.zoomIdentity;
    const z = (Q.get('zoom') || '').split(',').map(Number);   // 自检用：?zoom=cx,cy,倍数（用户动过缩放之前，每次适配都按参数重算）
    if (z.length === 3 && z.every(Number.isFinite) && !state.userZoomed && Q.get('zoomback') === null) {   // zoomback 模式见 show()
      const b = state.base, s = z[2];
      state.zt = d3.zoomIdentity.translate(b.cw / 2 - s * (b.ox + z[0] * b.k), b.ch / 2 - s * (b.oy + z[1] * b.k)).scale(s);
      svg.property('__zoom', state.zt);
    }
    compose();
  }
  function compose() {
    const b = state.base, t = state.zt;
    state.fit = { k: b.k * t.k, ox: t.x + b.ox * t.k, oy: t.y + b.oy * t.k, cw: b.cw, ch: b.ch };
  }
  const zoom = d3.zoom().scaleExtent([1, 8]).clickDistance(3)
    .filter(ev => !state.busy && !ev.button && ev.type !== 'dblclick')
    .on('start', ev => { if (ev.sourceEvent) state.userZoomed = true; emit('zoomstart'); })
    .on('zoom', ev => {
      state.zt = ev.transform; compose();
      placeLabels(); draw(state.frame || still(state.view)); emit('zoom');
    })
    .on('end', () => { emit('layout'); });
  svg.call(zoom).on('dblclick.zoom', null);
  function setExtent() {
    const b = state.base;
    zoom.extent([[0, 0], [b.cw, b.ch]]).translateExtent([[0, 0], [b.cw, b.ch]]);
  }
  // 「回全景」过渡在 f（0..1）处的样子，只供自检截图：与 resetZoom 的 d3.zoom 过渡同一插值（interpolateZoom + 同一缓动），
  // 并照过渡的事件顺序——开始时 zoomstart、每一帧走 zoom 回调、结束（f = 1）才有 layout
  function zoomBackAt(f) {
    const b = state.base, p = [b.cw / 2, b.ch / 2], w = Math.max(b.cw, b.ch), a = state.zt, z = d3.zoomIdentity;
    let T = z;
    if (f < 1) {
      const i = d3.interpolateZoom(a.invert(p).concat(w / a.k), z.invert(p).concat(w / z.k));
      const l = i(ease(Math.max(0, f))), k = w / l[2];
      T = d3.zoomIdentity.translate(p[0] - l[0] * k, p[1] - l[1] * k).scale(k);
    }
    emit('zoomstart');
    state.zt = T; compose(); svg.property('__zoom', T);
    placeLabels(); draw(state.frame || still(state.view)); emit('zoom');
    if (f >= 1) emit('layout');
  }
  function resetZoom(ms) {                          // 回到整个流域的全景（形变前、切换流域时）
    return new Promise(ok => {
      if (state.zt.k === 1 && state.zt.x === 0 && state.zt.y === 0) { ok(); return; }
      if (!ms) { svg.call(zoom.transform, d3.zoomIdentity); ok(); return; }
      svg.transition().duration(ms).ease(ease).call(zoom.transform, d3.zoomIdentity).on('end', ok);
    });
  }

  // ------------------------------------------------------------ 载入流域（file:// 下只能用 <script> 载入数据）
  function loadBasin(id) {
    window.RIVER_DATA = window.RIVER_DATA || {};
    if (window.RIVER_DATA[id]) return Promise.resolve(window.RIVER_DATA[id]);
    return new Promise((ok, fail) => {
      const s = document.createElement('script');
      s.src = `${Q.get('data') === 'fig' ? 'data_fig' : 'data'}/${id}.js`;   // T-17 论文插图用固定行距的导出
      s.onload = () => window.RIVER_DATA[id] ? ok(window.RIVER_DATA[id]) : fail(new Error('No data for basin: ' + id));
      s.onerror = () => fail(new Error(`Could not load data/${id}.js`));
      document.head.appendChild(s);
    });
  }

  // ------------------------------------------------------------ 建立元素（每个流域一次）
  function build(d) {
    for (const k in layer) layer[k].selectAll('*').remove();
    const pieces = d.edges.flatMap(e => e.pieces);
    state.pieces = pieces;

    layer.bg.selectAll('path').data(d.background.outline_geo).enter().append('path').attr('class', 'bg-outline');
    layer.water.selectAll('path').data(d.background.waterbodies_geo).enter().append('path').attr('class', 'bg-water');
    layer.bgRivers.selectAll('path').data(d.background.rivers_geo).enter().append('path').attr('class', 'bg-river')
      .attr('stroke-width', r => r.strahler >= 5 ? 1.3 : r.strahler === 4 ? 1.0 : 0.75);
    layer.pieces.selectAll('path').data(pieces).enter().append('path').attr('class', 'piece');

    const sg = layer.stubs.selectAll('g').data(d.stubs).enter().append('g');
    sg.append('path').attr('class', 'stub-body').attr('data-w', s => s.w);
    sg.filter(s => s.flag_facility).append('rect').attr('class', 'stub-flag').attr('width', 5).attr('height', 5);

    layer.outlet.append('path').attr('class', 'outlet-mark');
    const fg = layer.fac.selectAll('g').data(d.facilities).enter().append('g');
    fg.append('path').attr('class', f => f.type === 'weir' ? 'fac-weir' : 'fac-storage');

    // 流向 V 形：线宽 ≥ 5.5 px 的线上用白色（验收修订 10-01），细线仍用河网色
    // 支流的 V 导出为 [x, y, dx, dy]（固定在连接段上、指向汇入点，作者 10-01），干流的为 [x, y]（按整体流向）
    const arrows = pieces.flatMap(p => p.arrows.map(xy => ({ xy, dir: xy.length >= 4 ? [xy[2], xy[3]] : null, thick: p.w_sch >= 5.5 })));
    layer.arrows.selectAll('path').data(arrows).enter().append('path').attr('class', a => 'flow-arrow' + (a.thick ? ' on-thick' : ''));

    const gs = layer.stations.selectAll('g').data(d.stations).enter().append('g');
    gs.append('circle').attr('class', 'st-halo');
    gs.append('circle').attr('class', s => s.has_wq ? 'st-wq' : 'st-flow');

    layer.mapLabels.selectAll('text').data(d.background.labels_geo.filter(l => l.text)).enter().append('text')
      .attr('class', l => 'map-label ' + l.kind).text(l => l.text);
    // 地图城镇（D-38；GeoNames）：小圆点加小字灰色标注，不可交互（D-44）；位置在 placeLabels 里按避让结果定
    const tg = layer.towns.selectAll('g').data(d.background.towns_geo || []).enter().append('g').attr('class', 'town');
    tg.append('circle').attr('class', 'town-dot').attr('r', 2.2);
    tg.append('text').attr('class', 'town-label').text(t => t.name);
  }

  // ------------------------------------------------------------ 当前帧的几何（draw 与 M2 的命中、高亮共用）
  const geoFull = Q.get('geo') !== 'm';
  function piecePts(p, t) {                    // 数据坐标
    if (t <= 0) return geoFull ? p.geo : p.geo_m;
    if (t >= 1) return p.sch;
    return p.geo_m.map((g, i) => lerp2(g, p.sch_m[i], t));
  }
  const pieceW = (p, t) => lerp(p.w_geo, p.w_sch, t);
  function stubGeom(st, t) {                   // 屏幕坐标：汇入点 J、外端 E、削角多边形 body（尖 tip）
    const Jd = lerp2(st.junction_geo, st.junction_schematic, t), Ed = lerp2(st.end_geo, st.end_schematic, t);
    const J = P(Jd), kb = (state.base || state.fit).k;   // 缩放时存根长度保持屏幕像素不变，只移动汇入点（M1 遗留，T-12）
    const E = [J[0] + (Ed[0] - Jd[0]) * kb, J[1] + (Ed[1] - Jd[1]) * kb];
    const len = Math.hypot(E[0] - J[0], E[1] - J[1]);
    if (len < 0.5) return { J, E, len };
    const u = [(J[0] - E[0]) / len, (J[1] - E[1]) / len];            // 指向河道
    const n = [-u[1], u[0]];
    const near = [J[0] - u[0] * STUB_GAP, J[1] - u[1] * STUB_GAP];    // 靠河道的一端（离汇入点 4 px）
    const inflow = st.kind === 'in';
    const tip = inflow ? near : E, flat = inflow ? E : near;          // 流入：尖朝河道；流出：尖朝外
    const d_ = [tip[0] - flat[0], tip[1] - flat[1]], L_ = Math.hypot(...d_) || 1, v = [d_[0] / L_, d_[1] / L_];
    const tl = Math.min(stubTip(st.w), L_), hw = st.w / 2;
    const sh = [tip[0] - v[0] * tl, tip[1] - v[1] * tl];              // 削角开始处（尖的根部）
    const q = (p, s) => `${(p[0] + n[0] * s).toFixed(2)},${(p[1] + n[1] * s).toFixed(2)}`;
    const body = `M${tip[0].toFixed(2)},${tip[1].toFixed(2)}L${q(sh, hw)}L${q(flat, hw)}L${q(flat, -hw)}L${q(sh, -hw)}Z`;
    return { J, E, len, tip, flat, body };
  }
  const stCenter = (st, t) => P(lerp2(st.xy_geo, st.xy_schematic, t));
  function facGeom(f, t) {                     // 屏幕坐标：中心、朝向、宽高（含地图上的放大倍数）
    const c = P(lerp2(f.xy_geo, f.xy_schematic, t));
    const u = norm(lerp2(f.dir_geo, f.dir_schematic, t));
    const k = lerp(f.geo_scale || 1, 1, t);
    const [w, h] = FAC[f.type];
    return { c, u, w: w * k, h: h * k };
  }
  function outletGeom(t) {
    const om = state.d.basin.outlet_marker;
    const oc = P(lerp2(om.xy_geo, om.xy_schematic, t));
    const ou = norm(lerp2(om.dir_geo, om.dir_schematic, t));
    return { c: [oc[0] + ou[0] * (OUTLET_H / 2 + 1), oc[1] + ou[1] * (OUTLET_H / 2 + 1)], u: ou };
  }

  // ------------------------------------------------------------ 画一帧
  // s.t：几何进度，0 = 地图，1 = 示意图；s.mapA：地图专有元素不透明度；s.schA：示意图专有元素不透明度
  function draw(s) {
    state.frame = s;                           // 窗口尺寸变化时按当前帧重画
    const d = state.d, t = s.t;

    layer.bg.attr('opacity', s.mapA).selectAll('path').attr('d', r => pathOf(r) + 'Z');
    layer.water.attr('opacity', s.mapA).selectAll('path').attr('d', w => w.rings.map(r => pathOf(r) + 'Z').join(''));
    layer.bgRivers.attr('opacity', s.mapA).selectAll('path').attr('d', r => pathOf(r.d));

    layer.pieces.selectAll('path')
      .attr('d', p => pathOf(piecePts(p, t)))
      .attr('stroke-width', p => pieceW(p, t));

    layer.stubs.selectAll('g').each(function (st) {
      const G = stubGeom(st, t);
      const g = d3.select(this).attr('opacity', Math.min(1, G.len / 20));
      if (G.len < 0.5) { g.attr('display', 'none'); return; }
      g.attr('display', null);
      g.select('path').attr('d', G.body);
      g.select('rect').attr('x', G.E[0] - 2.5).attr('y', G.E[1] - 2.5);
    });

    const og = outletGeom(t);
    layer.outlet.select('path').attr('d', tri(og.c, og.u, 9, OUTLET_H));

    layer.fac.selectAll('g').each(function (f) {
      const G = facGeom(f, t);                                        // 地图上被站点压住时放大 1.5 倍，示意图 1 倍
      d3.select(this).select('path').attr('d', tri(G.c, G.u, G.w, G.h));
    });

    const fdir = d.basin.axis_direction.flow;
    const fn = [-fdir[1], fdir[0]];
    layer.arrows.attr('opacity', s.schA).attr('display', s.schA > 0 ? null : 'none').selectAll('path').attr('d', a => {
      const c = P(a.xy), u = a.dir || fdir, nn = a.dir ? [-u[1], u[0]] : fn;
      const tip = [c[0] + u[0] * CHEV / 4, c[1] + u[1] * CHEV / 4];
      const bk = [tip[0] - u[0] * CHEV / 2, tip[1] - u[1] * CHEV / 2];
      return `M${bk[0] + nn[0] * CHEV / 2},${bk[1] + nn[1] * CHEV / 2}L${tip}L${bk[0] - nn[0] * CHEV / 2},${bk[1] - nn[1] * CHEV / 2}`;
    });

    const halo = lerp(HALO.map, HALO.schematic, t);
    layer.stations.selectAll('g').each(function (st) {
      const c = stCenter(st, t);
      const g = d3.select(this);
      g.select('.st-halo').attr('cx', c[0]).attr('cy', c[1]).attr('r', R_ST + halo);
      g.select(':nth-child(2)').attr('cx', c[0]).attr('cy', c[1]).attr('r', st.has_wq ? R_ST : R_ST - 0.75);
    });

    layer.labels.attr('opacity', s.schA).attr('display', s.schA > 0 ? null : 'none');
    layer.towns.attr('opacity', s.mapA).attr('display', s.mapA > 0 ? null : 'none').selectAll('g.town').each(function (tw) {
      const q = state.townPos && state.townPos.get(tw);
      const g = d3.select(this).attr('display', q ? null : 'none');
      if (!q) return;
      const c = P(tw.xy);
      g.select('circle').attr('cx', c[0]).attr('cy', c[1]).attr('display', q.dot ? null : 'none');
      g.select('text').attr('x', q.x).attr('y', q.y).attr('text-anchor', q.anchor);
    });
    layer.mapLabels.attr('opacity', s.mapA).attr('display', s.mapA > 0 ? null : 'none').selectAll('text')
      .attr('x', l => (state.mapLabelPos.get(l) || { x: P(l.xy)[0] }).x)
      .attr('y', l => (state.mapLabelPos.get(l) || { y: P(l.xy)[1] }).y)
      .attr('text-anchor', l => (state.mapLabelPos.get(l) || { anchor: l.anchor || 'middle' }).anchor);
    drawRatio(t);
    emit('draw', s);
  }
  // 汇流比例符号（D-36）：每个汇流点（有站支流与存根）一个小扇形，扇形角度 = 支流占汇流后面积的比例；
  // 占比取导出值（D-36 口径），前端只画；默认关闭，开关在图例末尾（D-52）
  function drawRatio(t) {
    const L = layer.ratio;
    L.selectAll('*').remove();
    if (!state.showRatio || !state.d) return;
    const seen = new Set(), items = [];
    for (const e of state.d.edges) for (const c of e.confluences) if (!seen.has(c.branch)) { seen.add(c.branch); items.push([c.xy_geo, c.xy_schematic, c.share]); }
    for (const st of state.d.stubs) if (st.kind === 'in' && st.share != null) items.push([st.junction_geo, st.junction_schematic, st.share]);
    const r = 5.5, arc = d3.arc().innerRadius(0).outerRadius(r).startAngle(0);
    for (const [g, sc, sh] of items) {
      const c = P(lerp2(g, sc, t));
      const G = L.append('g').attr('class', 'ratio').attr('transform', `translate(${c[0].toFixed(1)},${c[1].toFixed(1)})`);
      G.append('circle').attr('r', r);
      G.append('path').attr('d', arc.endAngle(Math.max(0.02, sh) * 2 * Math.PI)());
    }
  }

  // ------------------------------------------------------------ 河名与两端标签（示意图，按矩形避让）
  const ctx = document.createElement('canvas').getContext('2d');
  function textW(s, font) { ctx.font = font || FONT; return ctx.measureText(s).width; }
  const hit = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
  function segHitsRect(a, b, pad, r) {             // 线段与矩形（外扩 pad）是否相交（与 legend.js 同一写法）
    const R_ = [r[0] - pad, r[1] - pad, r[2] + pad, r[3] + pad];
    const ins = p => p[0] >= R_[0] && p[0] <= R_[2] && p[1] >= R_[1] && p[1] <= R_[3];
    if (ins(a) || ins(b)) return true;
    if (Math.max(a[0], b[0]) < R_[0] || Math.min(a[0], b[0]) > R_[2] || Math.max(a[1], b[1]) < R_[1] || Math.min(a[1], b[1]) > R_[3]) return false;
    const cr = (p, q, t) => (q[0] - p[0]) * (t[1] - p[1]) - (q[1] - p[1]) * (t[0] - p[0]);
    const sg = [[R_[0], R_[1]], [R_[2], R_[1]], [R_[2], R_[3]], [R_[0], R_[3]]].map(c => Math.sign(cr(a, b, c)));
    return !(sg.every(v => v > 0) || sg.every(v => v < 0));
  }

  function placeLabels() {
    const d = state.d, k = state.fit.k;
    const obs = [];
    const segRect = (a, b, w) => { const A = P(a), B = P(b); const h = w / 2 + 1;
      return [Math.min(A[0], B[0]) - h, Math.min(A[1], B[1]) - h, Math.max(A[0], B[0]) + h, Math.max(A[1], B[1]) + h]; };
    const lineObs = [], vObs = [];                 // 端标签压线兜底时分开计数：先少压流向 V 形，再少压线（作者 10-01）
    for (const p of state.pieces) for (let i = 1; i < p.sch.length; i++) { const q = segRect(p.sch[i - 1], p.sch[i], p.w_sch); obs.push(q); lineObs.push(q); }
    for (const st of d.stations) { const c = P(st.xy_schematic); obs.push([c[0] - 8, c[1] - 8, c[0] + 8, c[1] + 8]); }
    const hardObs = [];                            // 两端标签压线兜底时仍须避开的：存根、坝标记、河口标记（站点另算）
    for (const st of d.stubs) { const q = segRect(st.junction_schematic, st.end_schematic, st.w + 5); obs.push(q); hardObs.push(q); }
    for (const f of d.facilities) { const c = P(f.xy_schematic); const r = FAC[f.type][1] / 2 + 1; const q = [c[0] - r, c[1] - r, c[0] + r, c[1] + r]; obs.push(q); hardObs.push(q); }
    const om = P(d.basin.outlet_marker.xy_schematic);
    obs.push([om[0] - 14, om[1] - 14, om[0] + 14, om[1] + 14]); hardObs.push([om[0] - 14, om[1] - 14, om[0] + 14, om[1] + 14]);
    for (const p of state.pieces) for (const a of p.arrows) {           // 流向 V 形也是障碍物（作者 09-24）
      const c = P(a), r = CHEV / 2 + 9;                                  // 四周再留 9 px，免得读成「河名 ↑」
      const q = [c[0] - r, c[1] - r, c[0] + r, c[1] + r]; obs.push(q); vObs.push(q);
    }

    const inside = r => r[0] >= 2 && r[1] >= 2 && r[2] <= state.fit.cw - 2 && r[3] <= state.fit.ch - 2;
    const out = [];
    const tryPlace = (cands, text, cls, lb) => {
      for (const c of cands) {
        if (inside(c.rect) && !obs.some(o => hit(o, c.rect))) {
          obs.push(c.rect);
          out.push({ text, cls, x: c.x, y: c.y, anchor: c.anchor, rect: c.rect, lb });   // rect、lb：M2 悬停用
          return true;
        }
      }
      return false;
    };
    const orient = d.basin.axis_direction.orient;

    // 两端标签（D-50 ①：常驻）：先沿长轴放到线端外侧，放不下再放到线的上 / 下方
    // 作者 10-01（方向线索减到一种）：去掉箭头，只留文字——两端标签的箭头指「那边是上游」，流向 V 形指「水往那边流」，
    // 方向相反的两种箭头并存会互相干扰。醒目度靠加粗、字号比河名大一档（13 对 11 px）。不用省略号：图是完整的
    const fdir = d.basin.axis_direction.flow, udir = fdir.map(v => -v);
    const ends = [
      { line_end: d.basin.end_labels.outlet.line_end, text: T.outlet(d.basin.outlet_to), toward: fdir },
      { line_end: d.basin.end_labels.source.line_end, text: T.source, toward: udir },
    ];
    // 两端标签离站点至少再留 8 px（作者 09-24：不要压在站上）
    const stObs = d.stations.map(st => { const c = P(st.xy_schematic); return [c[0] - 16, c[1] - 16, c[0] + 16, c[1] + 16]; });
    const clearOfStations = r => !stObs.some(o => hit(o, r));
    for (const e of ends) {
      const L = P(e.line_end), u = e.toward;
      const w = textW(e.text, FONT_END);         // 验收修订 10-01：两端标签为正文字号 13 px 加粗
      const cands = [];
      if (orient === 'h') {
        const out = u[0] > 0;                                           // 线端在右边
        const xo = L[0] + u[0] * 22;                                    // ① 线端外侧，沿长轴
        cands.push({ x: xo, y: L[1] + 4, anchor: out ? 'start' : 'end',
          rect: out ? [xo, L[1] - 8, xo + w, L[1] + 6] : [xo - w, L[1] - 8, xo, L[1] + 6] });
        for (const dy of [-20, 28, -36, 44]) {                          // ② 线的上 / 下方：贴画布边缘跨过线端，或紧挨线端
          const edge = out ? state.fit.cw - 6 : 6;
          // 作者 10-01：标签贴着干流端点，不沿线往里滑远（原先最远滑到 170 px，Yarra 的河口标签因此离端点约 250 px）
          for (const x0 of [edge, ...[-14, 20].map(o => L[0] - u[0] * o)]) {
            cands.push({ x: x0, y: L[1] + dy, anchor: out ? 'end' : 'start',
              rect: out ? [x0 - w, L[1] + dy - 11, x0, L[1] + dy + 3] : [x0, L[1] + dy - 11, x0 + w, L[1] + dy + 3] });
          }
        }
      } else {
        const yo = L[1] + u[1] * 26 + (u[1] > 0 ? 8 : 0);               // ① 线端外侧，沿长轴
        cands.push({ x: L[0], y: yo, anchor: 'middle', rect: [L[0] - w / 2, yo - 11, L[0] + w / 2, yo + 3] });
        for (const dx of [18, -18, 34, -34]) {                          // ② 线的左右两侧，紧挨线端（不往里滑远，作者 10-01）
          for (const o of [0, 30]) {
            const yc = L[1] - u[1] * o;
            cands.push({ x: L[0] + dx, y: yc + 4, anchor: dx > 0 ? 'start' : 'end',
              rect: dx > 0 ? [L[0] + dx, yc - 8, L[0] + dx + w, yc + 6] : [L[0] + dx - w, yc - 8, L[0] + dx, yc + 6] });
          }
        }
      }
      if (tryPlace(cands.filter(c => clearOfStations(c.rect)), e.text, 'end-label')) continue;
      // 端点附近都被挡：允许压住线（与图例「线可以压」同一原则），但不压站点、存根、坝标记、河口标记与已放的标注；
      // 压线时文字加白色描边（end-label over-line），保证读得清。
      // 作者 10-01 定的避让优先级：可点击对象 > 其他标注 > 流向 V 形 > 线。前两者不压；V 形算线、可以压，但作为最后选择：
      // 在剩下的候选里先取压 V 形最少的，再取压线最少的，同分按候选顺序（离端点由近及远）
      const hard = [...stObs, ...hardObs, ...out.map(o => o.rect)];
      const cost = c => [vObs.filter(o => hit(o, c.rect)).length, lineObs.filter(o => hit(o, c.rect)).length];
      const best = cands.filter(c => inside(c.rect) && !hard.some(o => hit(o, c.rect)))
        .map(c => ({ c, k: cost(c) })).reduce((a, b) => !a || (b.k[0] - a.k[0] || b.k[1] - a.k[1]) < 0 ? b : a, null);
      const c = best && best.c;
      if (c) { obs.push(c.rect); out.push({ text: e.text, cls: 'end-label over-line', x: c.x, y: c.y, anchor: c.anchor, rect: c.rect }); }
    }

    // 河名：按集水面积从大到小，放在靠近汇入点处，上方优先、下方备选，放不下跳过（D-49、D-50 ⑤）
    // 栈内站所在的支流强制标注并用交互色（D-49、T-14）：排在最前面；没有空位时取第一个画布内的位置照样标出
    let placed = 0;
    const named = new Set();                   // 同名的河只标一次（作者 09-24）：面积最大、放得下的那一段
    const forcedBr = new Set((window.River.stack ? window.River.stack.state.ids : [])
      .map(id => (d.stations.find(s => s.id === id) || {}).branch));
    const order = d.basin.labels.filter(lb => forcedBr.has(lb.branch)).concat(d.basin.labels.filter(lb => !forcedBr.has(lb.branch)));
    for (const lb of order) {
      const forced = forcedBr.has(lb.branch);
      if (named.has(lb.name) && !forced) continue;
      const A = P(lb.from), B = P(lb.to);
      const ua = norm([B[0] - A[0], B[1] - A[1]]);
      const w = textW(lb.name), h = 12;
      const cands = [];
      const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
      // 从汇入点（干流从河口）起沿线往上游滑动，越近越优先；每个位置先上方后下方（竖排：先右后左）
      const offs = [10, 24, 40, 60, 85, 115, 150, 190, 240, 300, 370, 450].filter(o => o <= Math.max(10, len - 10));
      for (const o of offs) {
        if (orient === 'h') {
          const x0 = A[0] + ua[0] * o;
          const right = ua[0] >= 0;
          for (const dy of [-6, 6 + h]) {
            const yb = A[1] + dy;
            cands.push({ x: x0, y: yb, anchor: right ? 'start' : 'end',
              rect: right ? [x0, yb - 9, x0 + w, yb + 3] : [x0 - w, yb - 9, x0, yb + 3] });
          }
        } else {
          const yc = A[1] + ua[1] * (o + 8);
          for (const dx of [8, -8]) cands.push({ x: A[0] + dx, y: yc + 4, anchor: dx > 0 ? 'start' : 'end',
            rect: dx > 0 ? [A[0] + dx, yc - 6, A[0] + dx + w, yc + 6] : [A[0] + dx - w, yc - 6, A[0] + dx, yc + 6] });
        }
      }
      if (tryPlace(cands, lb.name, forced ? 'river-label forced' : 'river-label', lb)) { placed++; named.add(lb.name); }
      else if (forced) {                           // 强制：没有空位也标出（取第一个在画布内的位置）
        const c = cands.find(c => inside(c.rect)) || cands[0];
        if (c) { obs.push(c.rect); out.push({ text: lb.name, cls: 'river-label forced', x: c.x, y: c.y, anchor: c.anchor, rect: c.rect, lb }); placed++; named.add(lb.name); }
      }
    }
    const nNames = new Set(d.basin.labels.map(l => l.name)).size;
    state.labelStats = { placed, total: nNames };
    document.body.dataset.labels = `${placed}/${nNames}`;                   // 自检截图读取（放下 / 不同河名数）
    // 地图常驻名称：水库名先用导出给的位置（远离站点的一侧），压到站点或别的名称时依次试三角的右、左、上、下
    state.mapLabelPos = new Map();
    const mObs = d.stations.map(st => { const c = P(st.xy_geo); return [c[0] - 9, c[1] - 9, c[0] + 9, c[1] + 9]; });
    for (const f of d.facilities) {                                   // 坝标记（地图上可能放大）也是障碍物
      const c = P(f.xy_geo), r = Math.max(...FAC[f.type]) * (f.geo_scale || 1) / 2 + 4;   // 含文字白底
      mObs.push([c[0] - r, c[1] - r, c[0] + r, c[1] + r]);
    }
    for (const l of d.background.labels_geo.filter(x => x.text)) {
      const w = textW(l.text);
      const rectOf = (x, y, a) => a === 'start' ? [x, y - 10, x + w, y + 3] : a === 'end' ? [x - w, y - 10, x, y + 3]
        : [x - w / 2, y - 10, x + w / 2, y + 3];
      const c0 = P(l.xy);
      const cands = [{ x: c0[0], y: c0[1], anchor: l.anchor || 'middle' }];
      if (l.at) {
        const a = P(l.at);
        for (const dd of [11, 20, 30]) {
          cands.push({ x: a[0] + dd, y: a[1] + 4, anchor: 'start' }, { x: a[0] - dd, y: a[1] + 4, anchor: 'end' },
            { x: a[0], y: a[1] - dd - 1, anchor: 'middle' }, { x: a[0], y: a[1] + dd + 9, anchor: 'middle' },
            { x: a[0] + 6, y: a[1] - dd, anchor: 'start' }, { x: a[0] - 6, y: a[1] - dd, anchor: 'end' });
        }
      }
      const nHit = c => { const r = rectOf(c.x, c.y, c.anchor); return mObs.filter(o => hit(o, r)).length; };
      const ok = cands.find(c => nHit(c) === 0) || cands.reduce((b, c) => nHit(c) < nHit(b) ? c : b);
      state.mapLabelPos.set(l, { ...ok, rect: rectOf(ok.x, ok.y, ok.anchor) });
      mObs.push(rectOf(ok.x, ok.y, ok.anchor));
    }

    // 地图城镇（D-38；作者 09-30：GeoNames）：按人口顺序放；标注规则与河名相同——矩形判重叠，放不下就跳过，点与名一起不画。
    // 障碍物：站点、坝标记、已放的地图名称（上面的 mObs）、诱导子树的河段（地图线）、已放的城镇；圆点只避开站点
    // 河道按真实线段判相交（地图上的河段多为斜线，外包矩形会把整片区域都算成障碍）
    state.townPos = new Map();
    const tObs = mObs.slice();
    const segs = [];
    for (const p of state.pieces) for (let i = 1; i < p.geo.length; i++) segs.push([P(p.geo[i - 1]), P(p.geo[i]), p.w_geo / 2 + 1]);
    const segHit = r => segs.some(([a, b, pad]) => segHitsRect(a, b, pad, r));
    const stOnly = d.stations.map(st => { const c = P(st.xy_geo); return [c[0] - 9, c[1] - 9, c[0] + 9, c[1] + 9]; });
    let tPlaced = 0;
    for (const tw of d.background.towns_geo || []) {
      const c = P(tw.xy), w = textW(tw.name), dot = [c[0] - 3, c[1] - 3, c[0] + 3, c[1] + 3];
      if (!inside(dot)) continue;
      // 镇点压在站点上（测站常以所在城镇命名，如 Shepparton、Seymour、Euroa）：不画小圆点，名字照样标在旁边
      const dotOk = !stOnly.some(o => hit(o, dot));
      const cands = [];
      for (const dd of [5, 10, 16]) {                  // 右、左、上、下，再往外挪两档
        cands.push({ x: c[0] + dd, y: c[1] + 4, anchor: 'start', rect: [c[0] + dd, c[1] - 6, c[0] + dd + w, c[1] + 6] },
          { x: c[0] - dd, y: c[1] + 4, anchor: 'end', rect: [c[0] - dd - w, c[1] - 6, c[0] - dd, c[1] + 6] },
          { x: c[0], y: c[1] - dd - 1, anchor: 'middle', rect: [c[0] - w / 2, c[1] - dd - 11, c[0] + w / 2, c[1] - dd + 1] },
          { x: c[0], y: c[1] + dd + 10, anchor: 'middle', rect: [c[0] - w / 2, c[1] + dd - 1, c[0] + w / 2, c[1] + dd + 11] });
      }
      const ok = cands.find(q => inside(q.rect) && !tObs.some(o => hit(o, q.rect)) && !segHit(q.rect));
      if (!ok) continue;
      state.townPos.set(tw, { ...ok, dot: dotOk });
      tObs.push(ok.rect); if (dotOk) tObs.push(dot); mObs.push(ok.rect);
      tPlaced++;
    }
    state.townStats = { placed: tPlaced, total: (d.background.towns_geo || []).length };
    document.body.dataset.towns = `${tPlaced}/${state.townStats.total}`;

    state.labelBoxes = out;
    layer.labels.selectAll('*').remove();
    layer.labels.selectAll('text').data(out).enter().append('text')
      .attr('class', l => l.cls).attr('x', l => l.x).attr('y', l => l.y).attr('text-anchor', l => l.anchor).text(l => l.text);
  }

  // ------------------------------------------------------------ 形变（D-52：三段、不可中断、期间禁止点击）
  function frameAt(prog, dir) {
    const tt = Math.max(0, Math.min(1, prog)) * TOTAL;
    if (dir === 'toSchematic') {                 // 地图 → 示意图：③ 地图元素淡出、② 移动、① 标注与箭头淡入
      const a = PHASE.map, b = a + PHASE.move;
      if (tt <= a) return { t: 0, mapA: 1 - ease(tt / a), schA: 0 };
      if (tt <= b) return { t: ease((tt - a) / PHASE.move), mapA: 0, schA: 0 };
      return { t: 1, mapA: 0, schA: ease(Math.min(1, (tt - b) / PHASE.labels)) };
    }
    const a = PHASE.labels, b = a + PHASE.move; // 示意图 → 地图：① 标注与箭头淡出、② 移动、③ 地图元素淡入
    if (tt <= a) return { t: 1, mapA: 0, schA: 1 - ease(tt / a) };
    if (tt <= b) return { t: 1 - ease((tt - a) / PHASE.move), mapA: 0, schA: 0 };
    return { t: 0, mapA: ease(Math.min(1, (tt - b) / PHASE.map)), schA: 0 };
  }
  const still = view => view === 'map' ? { t: 0, mapA: 1, schA: 0 } : { t: 1, mapA: 0, schA: 1 };

  function setBusy(b) {
    state.busy = b;
    svg.classed('busy', b);
    d3.selectAll('#topbar .grp-basin select, #topbar .grp-view button').property('disabled', b);   // 占位控件始终禁用
  }

  function morphTo(view) {
    if (state.busy || view === state.view) return;
    const dir = view === 'schematic' ? 'toSchematic' : 'toMap';
    setBusy(true);
    emit('morphstart', view);
    resetZoom(300).then(() => { placeLabels(); runMorph(view, dir); });
  }
  function runMorph(view, dir) {
    const timer = d3.timer(el => {
      const p = el / 1000 / TOTAL;
      draw(frameAt(p, dir));
      if (p >= 1) {
        timer.stop();
        state.view = view;
        draw(still(view));
        updateTopbar();
        setBusy(false);
        emit('layout');                            // 形变结束：命中模型重建、图例切换（D-52：动画结束后）
      }
    });
  }

  // ------------------------------------------------------------ 顶部栏与侧边栏（M1 只有骨架）
  function updateTopbar() {
    d3.select('#btn-schematic').text(T.schematic).classed('on', state.view === 'schematic');
    d3.select('#btn-map').text(T.map).classed('on', state.view === 'map');
    d3.select('#view-hint').text(T.viewHint);
    d3.select('#lbl-basin').text(T.basinSelect);
    // 中右与右两组为占位（M2）：参数默认浊度、时间范围默认近一年（D-46）；时间序列就绪后由 ts.js 的 controls() 接管。
    // 作者 10-01 发现：本函数在每次形变结束都会调用，原先不论就绪与否都写占位——参数下拉被重置成只剩 Turbidity、
    // 时间范围按钮退回「近一年」（自 09-24 起）。改为只在未就绪时写占位
    d3.select('#lbl-param').text(T.topParam);
    d3.select('#lbl-range').text(T.topRange);
    if (!(window.River && window.River.ts && window.River.ts.ready)) {
      d3.select('#param-select').attr('title', T.topLater).selectAll('option').data([T.param('turbidity')])
        .join('option').text(x => x);
      d3.select('#range-btn').attr('title', T.topLater).text(T.topRangeVal);
    }
    d3.select('#search').attr('placeholder', T.topSearch).attr('aria-label', T.topSearch);   // 搜索由 search.js 启用（可以档）
  }
  function updateSidebar() {
    const b = state.d.basin;
    d3.select('#subtitle').text(T.subtitle);
    if (hooks.sidebar) { emit('sidebar'); return; }   // M2：侧边栏由 stack.js 接管
    d3.select('#sb-title').text(b.name);
    d3.select('#sb-main').html('')
      .call(m => m.append('p').text(T.summary(b.n_stations, Math.round(b.unmonitored_share * 100))))
      .call(m => m.append('p').attr('class', 'muted').text(T.note));
  }

  // ------------------------------------------------------------ 启动
  async function show(id) {
    const d = await loadBasin(id);
    state.id = id; state.d = d;
    document.getElementById('basin-select').value = id;
    if (state.zt && !Q.get('zoom')) { state.zt = d3.zoomIdentity; svg.property('__zoom', state.zt); }
    fit(); setExtent();
    build(d);
    placeLabels();
    emit('build', d);                              // 切换流域：清空栈、清除高亮（D-44）
    updateTopbar();
    updateSidebar();
    const m = Q.get('morph');
    if (m !== null) {
      // 冻结在形变中的某一时刻（自检截图）：与真实动画一样先进入「形变中」——禁止点击、morphstart（比例尺与署名隐藏、
      // 悬停清除、图例停在起始视图、小地图视野框隐藏）；动画结束后的切换（图例、小地图、顶部栏按钮）不会发生
      // 顺序同真实操作：先是起始视图的静止状态（layout：栈、图例等调试参数在此生效），再按下按钮进入形变中
      const dir = Q.get('dir') === 'toMap' ? 'toMap' : 'toSchematic';
      draw(still(state.view)); emit('layout');
      setBusy(true); emit('morphstart', dir === 'toMap' ? 'map' : 'schematic');
      draw(frameAt(parseFloat(m), dir));
    } else { draw(still(state.view)); emit('layout'); }
    const zb = Q.get('zoomback'), zq = (Q.get('zoom') || '').split(',').map(Number);
    if (zb !== null && zq.length === 3 && zq.every(Number.isFinite)) {
      // 先放大再触发形变，顺序同真实操作：按全景载入（图例与小地图的角落在此选定）→ 放大到 zoom 参数 → 按下按钮即进入形变中 → 0.3 s 回全景
      state.userZoomed = true;
      const b = state.base, k = zq[2];
      svg.call(zoom.transform, d3.zoomIdentity.translate(b.cw / 2 - k * (b.ox + zq[0] * b.k), b.ch / 2 - k * (b.oy + zq[1] * b.k)).scale(k));
      const f = parseFloat(zb);
      if (f > 0) { setBusy(true); emit('morphstart', state.view === 'map' ? 'schematic' : 'map'); zoomBackAt(f); }
    }
    document.body.dataset.ready = '1';
  }

  d3.selectAll('#topbar button[data-view]').on('click', function () { morphTo(this.dataset.view); });
  d3.select('#basin-select').on('change', function () { if (!state.busy) show(this.value); });
  window.addEventListener('resize', () => {
    if (!state.d || state.busy) return;
    fit(); setExtent(); placeLabels(); draw(state.frame || still(state.view)); emit('layout');
  });
  window.__river = { state, frameAt, draw, show };       // 自检用
  on('stack', () => {                                      // 栈变化：强制标注随之变化（T-14）
    if (!state.d || state.busy) return;
    placeLabels(); draw(state.frame || still(state.view)); emit('labels');
  });
  const still_ = still;
  Object.assign(window.River = window.River || {}, {
    Q, LANG, T, state, layer, on, emit, P, lerp, lerp2, norm, tri, pathOf, textW, hit,
    piecePts, pieceW, stubGeom, stCenter, facGeom, outletGeom, draw, still: still_, show, resetZoom, zoom, svg, placeLabels, W0, H0,
    R_ST, HALO, FAC, OUTLET_H, CHEV,
  });
  // 等 interact.js、stack.js、legend.js 都注册好钩子再载入（它们排在本文件之后）
  const start = () => show(Q.get('basin') || 'goulburn').catch(e => {
    d3.select('#sb-main').append('p').style('color', 'var(--warn)').text(e.message);
    document.body.dataset.ready = 'error';
    console.error(e);
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
