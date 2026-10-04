/*
 * audit.js — 规格符合性自检（M2 起每个里程碑末尾必做，作者 09-24）；只在 ?audit=1 时运行，不影响正常使用
 *
 * 在静止视图就绪后，把以下内容写进 body[data-audit]（JSON），由 tools/conformance.py 读出并对照截图：
 *   counts    JSON 中的数量；rendered：画布上实际渲染的元素数量（站点、段、边、存根、设施、河口、流向箭头、圆环）；
 *   symbols   每个应出现的符号在页面上的位置（站点圆心、设施三角、存根线段、段上的取样点、河口、圆环圆心），
 *             Python 在截图上取样判断「有可见像素、未被完全遮挡」；
 *   styles    各类元素计算后的颜色（getComputedStyle），对照规格 §4.1 与 M1 最终取值表；
 *   sizes     DOM 里的尺寸（站点半径与白边、设施三角外包框、存根箭头、线宽档、圆环、光晕、侧边栏与卡片各部分的高度）。
 *
 * 作者标注：本文件由 Claude Code（M2，2026-09-24）编写，见 docs/plan.md §11。
 */
(function () {
  'use strict';
  const R = window.River;
  if (!R || !R.Q.get('audit')) return;
  const r1 = v => Math.round(v * 10) / 10;
  const col = (sel, prop) => { const el = document.querySelector(sel); return el ? getComputedStyle(el)[prop] : null; };
  const bbox = el => { const b = el.getBBox(); return [r1(b.width), r1(b.height)]; };

  let done = false;
  R.on('layout', () => {
    if (done) return;
    done = true;
    // M3：等时间序列载入、侧边栏画完图表再审计
    const go = () => setTimeout(run, 60);
    if (R.ts && !R.ts.ready && !R.ts.failed) { const iv = setInterval(() => { if (R.ts.ready || R.ts.failed) { clearInterval(iv); go(); } }, 20); }
    else go();
  });
  function run() {
    const s = R.state, d = s.d, t = s.frame.t, map = t === 0;
    const svgBox = document.getElementById('svg').getBoundingClientRect();
    const pg = p => [r1(svgBox.left + p[0]), r1(svgBox.top + p[1])];
    const L = R.layer;
    const nodes = sel => L[sel].node().querySelectorAll(':scope > *');
    const visible = el => el.getAttribute('display') !== 'none' && getComputedStyle(el).display !== 'none';

    // ---------------- 数量
    const pieces = s.pieces;
    const edgesWithPieces = new Set(d.edges.filter(e => e.pieces.length).map(e => e.id));
    const counts = {
      stations: d.stations.length, pieces: pieces.length, edges: d.edges.length, edges_with_pieces: edgesWithPieces.size,
      stubs: d.stubs.length, stubs_in: d.stubs.filter(x => x.kind === 'in').length, facilities: d.facilities.length,
      arrows: pieces.reduce((a, p) => a + p.arrows.length, 0), outlet: 1,
      stack: R.stack ? R.stack.state.ids.length : 0,
    };
    const stubEls = [...nodes('stubs')];
    const rendered = {
      stations: nodes('stations').length,
      station_circles: L.stations.node().querySelectorAll('circle.st-wq, circle.st-flow').length,
      pieces: nodes('pieces').length,
      edges: new Set([...L.pieces.node().querySelectorAll('path')].map(el => d3.select(el).datum().owner)).size,
      stubs: stubEls.length, stubs_displayed: stubEls.filter(visible).length,
      facilities: nodes('fac').length,
      outlet: L.outlet.node().querySelectorAll('path').length,
      arrows: nodes('arrows').length, arrows_shown: map ? 0 : nodes('arrows').length,
      rings: L.rings.node().querySelectorAll('circle.ring').length,
    };

    // ---------------- 符号位置（页面坐标）
    const symbols = [];
    const dimOf = new Map();                        // 按当前参数淡显的站（作者 09-30 起为浅灰实心 #B0AFA8 加白边，class faded）
    L.stations.selectAll('g').each(function (st) { dimOf.set(st.id, this.classList.contains('faded')); });
    d.stations.forEach((st, i) => {
      const c = R.stCenter(st, t);
      symbols.push({ kind: 'station', id: st.id, order: i, wq: !!st.has_wq, c: pg(c), r: R.R_ST, halo: map ? R.HALO.map : R.HALO.schematic,
        faded: dimOf.get(st.id) });
    });
    const cb = document.getElementById('svg').getBoundingClientRect();
    var canvasBox = [cb.left, cb.top, cb.right, cb.bottom];
    for (const f of d.facilities) {
      const G = R.facGeom(f, t), n = [-G.u[1], G.u[0]];
      const tp = [G.c[0] + G.u[0] * G.h / 2, G.c[1] + G.u[1] * G.h / 2], b = [G.c[0] - G.u[0] * G.h / 2, G.c[1] - G.u[1] * G.h / 2];
      symbols.push({ kind: 'facility', id: f.id, type: f.type, tri: [tp, [b[0] + n[0] * G.w / 2, b[1] + n[1] * G.w / 2],
        [b[0] - n[0] * G.w / 2, b[1] - n[1] * G.w / 2]].map(pg) });
    }
    if (!map) for (const st of d.stubs) {
      const G = R.stubGeom(st, t);
      if (G.len >= 0.5) symbols.push({ kind: 'stub', id: st.id, a: pg(G.flat), b: pg(G.tip), w: st.w });   // 削角条：平头端到尖（作者 10-01）
    }
    for (const p of pieces) {
      const poly = R.piecePts(p, t).map(R.P);
      const pts = [];
      let acc = 6;
      for (let i = 1; i < poly.length; i++) {
        const a = poly[i - 1], b = poly[i], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        while (acc <= len) { pts.push(pg([a[0] + (b[0] - a[0]) * acc / len, a[1] + (b[1] - a[1]) * acc / len])); acc += 12; }
        acc -= len;
      }
      symbols.push({ kind: 'piece', id: p.id, w: R.pieceW(p, t), samples: pts });
    }
    const og = R.outletGeom(t);
    symbols.push({ kind: 'outlet', c: pg(og.c) });
    if (R.stack) for (const id of R.stack.state.ids) {
      symbols.push({ kind: 'ring', id, c: pg(R.stCenter(R.idx().st.get(id), t)), expanded: R.stack.state.expanded.has(id) });
    }
    const avoid = [];                                  // 取样时要避开的文字（标注）矩形
    for (const b of s.labelBoxes || []) if (!map) avoid.push([...pg([b.rect[0], b.rect[1]]), ...pg([b.rect[2], b.rect[3]])]);
    if (map) for (const pos of (s.mapLabelPos || new Map()).values()) if (pos.rect) avoid.push([...pg([pos.rect[0], pos.rect[1]]), ...pg([pos.rect[2], pos.rect[3]])]);
    const lg = document.getElementById('legend');
    if (lg) { const b = lg.getBoundingClientRect(); avoid.push([b.left, b.top, b.right, b.bottom]); }
    const intro = document.getElementById('intro');   // 说明块（作者 10-04）：与图例一样是半透明面板，线可以从下面穿过
    if (intro) { const b = intro.getBoundingClientRect(); avoid.push([b.left, b.top, b.right, b.bottom]); }

    // ---------------- 颜色（计算后的样式）
    const styles = {
      // 站点颜色只取没有淡显的站；淡显的另取（作者 09-30：浅灰实心 #B0AFA8）
      station_wq_fill: col('.layer-stations g:not(.faded) .st-wq', 'fill'), station_flow_fill: col('.layer-stations g:not(.faded) .st-flow', 'fill'),
      station_flow_stroke: col('.layer-stations g:not(.faded) .st-flow', 'stroke'),
      station_faded_fill: col('.layer-stations g.faded .st-wq, .layer-stations g.faded .st-flow', 'fill'),
      station_halo_fill: col('.st-halo', 'fill'), piece_stroke: col('.piece', 'stroke'), stub_fill: col('.stub-body', 'fill'),
      stub_flag_fill: col('.stub-flag', 'fill'), storage_fill: col('.fac-storage', 'fill'),
      weir_fill: col('.fac-weir', 'fill'), fac_stroke: col('.fac-storage, .fac-weir', 'stroke'), outlet_fill: col('.outlet-mark', 'fill'),
      arrow_stroke: col('.flow-arrow:not(.on-thick)', 'stroke'), arrow_thick_stroke: col('.flow-arrow.on-thick', 'stroke'),
      ring_halo_stroke: col('.ring-halo', 'stroke'), ring_stroke: col('.ring', 'stroke'), water_fill: col('.bg-water', 'fill'),
      water_stroke: col('.bg-water', 'stroke'), bg_river_stroke: col('.bg-river', 'stroke'), outline_stroke: col('.bg-outline', 'stroke'),
      land_fill: col('.bg-outline', 'fill'), river_label_fill: col('.river-label:not(.forced)', 'fill'),
      view_btn_on_bg: col('.grp-view button.on', 'backgroundColor'), card_exp_border: col('.card.exp', 'borderTopColor'),
      sidebar_body_px: col('#sidebar', 'fontSize'), sidebar_aux_px: col('.sb-main .aux, .tips, .c-net .lab', 'fontSize'),
    };

    // ---------------- 尺寸（DOM）
    const q = sel => [...document.querySelectorAll(sel)];
    const facSizes = {};
    L.fac.selectAll('g').each(function (f) { facSizes[f.id] = { type: f.type, geo_scale: f.geo_scale, bbox: bbox(this.querySelector('path')) }; });
    // 存根削角（作者 10-01）：每个看得见的存根量尖的长度（尖到根部两点中点）与条宽（根部两点距离）
    const stubTips = [];
    L.stubs.selectAll('g').each(function (st) {
      if (this.getAttribute('display') === 'none') return;
      const n = (this.querySelector('path.stub-body').getAttribute('d').match(/-?\d*\.?\d+/g) || []).map(Number);
      if (n.length < 10) return;
      const tip = [n[0], n[1]], a = [n[2], n[3]], b = [n[8], n[9]];
      stubTips.push({ id: st.id, w: st.w, width: r1(Math.hypot(a[0] - b[0], a[1] - b[1]) * 100) / 100,
        tip_len: r1(Math.hypot(tip[0] - (a[0] + b[0]) / 2, tip[1] - (a[1] + b[1]) / 2) * 100) / 100 });
    });
    const sizes = {
      station_r: [...new Set(q('#svg circle.st-wq').map(c => +c.getAttribute('r')))],
      station_flow_r: [...new Set(q('#svg circle.st-flow').map(c => +c.getAttribute('r')))],
      station_halo_r: [...new Set(q('#svg circle.st-halo').map(c => r1(+c.getAttribute('r'))))],
      piece_widths: [...new Set(q('#svg path.piece').map(p => r1(+p.getAttribute('stroke-width') * 100) / 100))].sort((a, b) => a - b),
      stub_tips: stubTips,
      facilities: facSizes,
      outlet_bbox: bbox(L.outlet.node().querySelector('path')),
      ring_r: [...new Set(q('#svg circle.ring').map(c => +c.getAttribute('r')))],
      ring_widths: [...new Set(q('#svg circle.ring').map(c => +c.getAttribute('stroke-width')))],
      sidebar_w: r1(document.getElementById('sidebar').getBoundingClientRect().width),
      topbar_h: r1(document.getElementById('topbar').getBoundingClientRect().height),
      canvas: [r1(svgBox.width), r1(svgBox.height)],
      card_exp_h: q('.card.exp').map(e => r1(e.getBoundingClientRect().height)),
      card_exp_w: q('.card.exp').map(e => r1(e.getBoundingClientRect().width)),
      row_h: q('.row').map(e => r1(e.getBoundingClientRect().height)),
      row_spark_w: q('.row .r-spark').map(e => r1(e.getBoundingClientRect().width)),
      row_name_w: q('.row .r-name').map(e => r1(e.getBoundingClientRect().width)),
      info_h: q('.info').map(e => r1(e.getBoundingClientRect().height)),
      card_overflow_x: q('.card, .row').filter(e => e.scrollWidth > e.clientWidth + 1).length,
      // 作者 10-04（反馈 F8）：四处图表的左右端点（相对侧边栏左缘）——折叠行曲线、行间降雨小柱、展开卡片各层、栈底时间轴；
      // 轴的刻度文字不得伸出轴；栈底自上而下为最后一行、分隔线、轴、Clear
      chart_x: (() => {
        const sb = document.getElementById('sidebar').getBoundingClientRect().left;
        const lr = e => { const b = e.getBoundingClientRect(); return [r1(b.left - sb), r1(b.right - sb)]; };
        const tb = e => { if (!e) return null; const b = e.getBoundingClientRect(); return [r1(b.top), r1(b.bottom)]; };
        const last = q('#sb-main .stack > .row, #sb-main .stack > .card').slice(-1)[0];
        return { rows: q('.row .r-spark svg').map(lr), irain: q('.info-rain svg').map(lr),
          card: q('.c-chart svg g[data-kind] > rect.ts-bg').map(lr), axis: q('.t-axis svg').map(lr), ticks: q('.t-axis .tick text').map(lr),
          v: { last: tb(last), sep: tb(document.querySelector('#sb-main .stack-sep')), axis: tb(document.querySelector('.t-axis svg')),
            clear: tb(document.querySelector('.stack-foot [data-act="clear"]')) } };
      })(),
      legend: document.body.dataset.legend ? JSON.parse(document.body.dataset.legend) : null,
    };
    const model = R.model && R.model();
    if (model) {
      const st = model.pts.filter(p => p.type === 'station' || p.type === 'facility');
      sizes.hot_zone_px_min = r1(Math.min(...st.map(p => 2 * p.half)));
      sizes.hot_zone_px_default = 2 * 12;
      sizes.symbols_spacing_lt8 = st.filter(p => p.nn < 8).length;
    }
    // ---------------- M3 / M4：图表、小地图、数据来源面板、缩放、字阶
    const ts = R.ts || {};
    const stackIds = R.stack ? R.stack.state.ids : [];
    const exp = R.stack ? [...R.stack.state.expanded] : [];
    const withTs = id => d.stations.find(x => x.id === id).has_ts;
    const m34 = {
      ts_ready: !!ts.ready, ts_load_ms: ts.loadMs, hydrate_ms: ts.hydrateMs,
      expected_card_charts: exp.filter(withTs).length,
      card_charts: q('.c-chart svg').length,
      expected_row_charts: stackIds.filter(id => !exp.includes(id) && withTs(id)).length,
      row_charts: q('.r-spark svg').length,
      axis: q('.t-axis svg').length,
      rain_rects: q('.c-chart rect.ts-rain').length,
      info_rain: q('.info-rain svg').length,
      minimap_stations: q('#minimap .mm-st circle').length, minimap_visible: getComputedStyle(document.getElementById('minimap')).display !== 'none',
      minimap_frame: (() => { const f = document.querySelector('#minimap .mm-frame'); return !!f && f.style.display !== 'none'; })(),
      sources: !!document.querySelector('#sources .src-h'),
      deco_visible: (() => { const e = document.getElementById('mapdeco'); return !!e && getComputedStyle(e).display !== 'none'; })(),
      param_select_enabled: !document.getElementById('param-select').disabled,
      zoom_k: s.zt ? s.zt.k : 1,
      chart_colors: { rain: col('rect.ts-rain', 'fill'), gap: col('rect.ts-gap', 'fill'), line_param: (document.querySelector('.c-chart path.ts-line[stroke="#3B3B38"]') || {}).getAttribute ? '#3B3B38' : null },
    };
    // 缩放后存根的屏幕长度（应恒为 20 px，只移动汇入点）
    m34.stub_screen_len = [...new Set(d.stubs.map(st => R.stubGeom(st, t)).filter(G => G.len >= 0.5).map(G => Math.round(G.len * 10) / 10))];
    // 字阶：界面上实际出现的字号（有文字的可见元素）
    const fs = new Map();
    for (const el of document.querySelectorAll('#topbar *, #sidebar *, #legend *, #tooltip *, #canvas svg text, #mapdeco *')) {
      if (!el.childNodes.length || ![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || el.closest('[style*="display: none"]')) continue;
      if (el.classList.contains('mi')) continue;      // 方法说明图标「i」是符号，不算字阶
      const v = cs.fontSize;
      fs.set(v, (fs.get(v) || 0) + 1);
    }
    m34.font_sizes = Object.fromEntries(fs);
    // ---------------- M3+M4 增补（作者 09-30）：ERS 目标线、地图城镇、不相邻两站的区间降雨、临时卡片
    const m34b = {};
    if (ts.ready && ts.ersOf) {
      const want = { card: 0, row: 0 }, none = [];
      for (const id of stackIds) {
        if (!ts.hasParam(id, ts.param)) continue;
        const E = ts.ersOf(id, ts.param);
        if (E && E.kind === 'line') want[exp.includes(id) ? 'card' : 'row'] += E.T.length;
        else if (E && exp.includes(id)) none.push(id);
      }
      m34b.ers = { param: ts.param, want, lines_card: q('.c-chart line.ts-ers').length, lines_row: q('.r-spark line.ts-ers').length,
        exceed: q('rect.ts-exceed').length, stroke: col('line.ts-ers', 'stroke'), exceed_fill: col('rect.ts-exceed', 'fill'),
        none_expected: none, none_texts: q('.c-ers.none .c-ers-t').map(e => [e.closest('.card') && e.closest('.card').dataset.id, e.textContent]),
        line_texts: q('.c-ers.line .c-ers-t').map(e => [e.closest('.card') && e.closest('.card').dataset.id, e.textContent]) };
    }
    m34b.towns = { total: (d.background.towns_geo || []).length, placed: s.townStats ? s.townStats.placed : null,
      shown: q('.layer-towns g.town').filter(g => g.getAttribute('display') !== 'none' && getComputedStyle(g.parentNode).display !== 'none').length,
      dot_fill: col('.town-dot', 'fill'), label_fill: col('.town-label', 'fill'),
      names: (d.background.towns_geo || []).filter(t => s.townPos && s.townPos.get(t)).map(t => t.name) };
    m34b.irain = q('.info-rain').map(e => {
      const pr = ts.pathRain && ts.pathRain(e.dataset.from, e.dataset.id);
      return { from: e.dataset.from, to: e.dataset.id, ids: pr ? pr.ids : [], sum: pr ? pr.arr.reduce((a, v) => a + (v || 0), 0) : null,
        n: pr ? pr.arr.filter(v => v != null).length : 0, bars: e.querySelectorAll('rect.ts-rain').length };
    });
    m34b.temp = R.stack ? R.stack.state.temp : null;
    m34b.temp_card = (() => { const c = document.querySelector('.card.temp'); return c ? { text: c.innerText, border: getComputedStyle(c).borderTopStyle } : null; })();
    m34b.stack_ids = stackIds.slice();
    m34b.card_h = q('.card.exp').map(e => r1(e.getBoundingClientRect().height));
    m34b.main_h = r1(document.getElementById('sb-main').getBoundingClientRect().height);
    m34b.minimap_h = r1(document.getElementById('minimap').getBoundingClientRect().height);
    m34b.minimap = R.minimap && R.minimap.info ? R.minimap.info() : null;
    m34b.legend_open = !!(R.corners && R.corners.state.open);
    m34b.sparse = q('.card.exp .ts-sparse').map(e => [e.closest('.card') && e.closest('.card').dataset.id, e.textContent, !!e.querySelector('[data-act=five]')]);
    m34.m34b = m34b;
    document.body.dataset.audit = JSON.stringify({ basin: d.basin.id, view: map ? 'map' : 'schematic', counts, rendered,
      symbols, avoid, styles, sizes, m34, canvas_box: canvasBox });
  }
})();
