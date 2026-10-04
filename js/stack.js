/*
 * stack.js — T-10 卡片栈与 T-11 空栈（impl-spec §6.2、§7.1–§7.5；D-44、D-45、D-47）
 *
 * 侧边栏主区域随选择变化：栈为空时显示空栈概况；否则自上而下为（设施临时卡片）、提示条、各站的行（按上下游排序，
 * 展开的为卡片、其余折叠成一行）、相邻两行位于同一条水流路径时插入行间信息行、底部一个 Clear。
 * 画布上栈内的站带细圆环、展开的带粗圆环（§4.2 第三层）。
 *
 * 数值一律取导出字段（作者 09-24：带数值或口径的结论在 Python 算好）：摘要句与网络位置行用 incr_area_km2、
 * nearest_up、facility_relation；折叠区用 nearest_confluence、incr_breakdown、basin.outlet_incr_breakdown；
 * 行间信息行用 down_chain；导航按钮的「最近」按 down_chain 的河道距离。前端只沿树找「哪些站」（上游全部站、
 * 到河口的下游站、上游有无调节设施或分流）。
 *
 * 时间序列（数据区、折叠行曲线、ERS 目标线、库水位、其他参数与质量码）由 ts.js 画（M3；ERS 为 M3+M4 增补）。
 *
 * 调试参数（只供自检截图）：&stack=id,…（依次加入）&expand=id,…（展开这些，其余折叠）&fold=id[:between|outlet]
 *   &fac=设施 id（打开临时卡片）&facTab=up|in|down &tmp=stub:S…|edge:E…（存根、边的临时卡片） &nav=id:up|down（按导航按钮）&method=id:incr（打开方法说明）
 *
 * 作者标注：本文件由 Claude Code（M2 T-10、T-11，2026-09-24）编写，见 docs/plan.md §11。
 */
(function () {
  'use strict';
  const R = window.River;
  const T = R.T;
  const LIMIT = 10;                                  // 上限约 10 个站（D-44）
  const main = document.getElementById('sb-main');
  const titleEl = document.getElementById('sb-title');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const S = { ids: [], expanded: new Set(), fold: new Map(), temp: null, flash: new Set(), undo: null, notice: null,
    method: new Set(), covOpen: false, scrollTo: null };
  let inEdges = new Map();

  R.on('build', d => {
    S.ids = []; S.expanded = new Set(); S.fold = new Map(); S.temp = null; S.flash = new Set(); S.undo = null;
    S.notice = null; S.method = new Set(); S.covOpen = false;
    inEdges = new Map();
    for (const e of d.edges) {
      const k = e.down || null;
      if (!inEdges.has(k)) inEdges.set(k, []);
      inEdges.get(k).push(e);
    }
  });
  const I = () => R.idx();
  const TS = () => R.ts || { ready: false, failed: false };
  // 数据区（M3）：有时间序列的站由 ts.js 画三层图表，底部一行说明采样方式；载入中显示占位；退化或无数据时整块不显示（§10）
  function dataArea(s) {
    const ts = TS();
    if (!s.has_ts || ts.failed) return '';
    if (!ts.ready) return `<div class="c-data">${esc(T.tsLoading)}</div>`;
    // 采样方式压成一行（作者 09-30），超出截断、完整文字悬停；其下一行为 ERS 目标或不画线的原因（ts.js 填）
    const ml = ts.methodLine(s.id);
    return `<div class="c-chart" data-chart="card" data-id="${esc(s.id)}"></div>`       // 稀疏站的「展开到五年」写在图里（ts.js，作者 10-01）
      + `<div class="c-meth aux" title="${esc(ml)}">${esc(ml)}</div>`
      + `<div class="c-ers aux"><span class="c-ers-t" data-chart="ers" data-id="${esc(s.id)}"></span>${mbtn(s.id, 'ers')}</div>`
      + methodBlock(s.id, 'ers');
  }
  const st = id => I().st.get(id);

  // ------------------------------------------------------------ 沿树找站（前端允许的「哪些站」）
  function upstreamOf(src) {                        // 上游全部站，按到 src 的河道距离（取自各站的 down_chain）
    const out = [], q = [...st(src).up_sites];
    while (q.length) {
      const u = q.shift();
      const c = st(u).down_chain.find(x => x.id === src);
      out.push({ id: u, dist: c ? c.dist_km : Infinity });
      q.push(...st(u).up_sites);
    }
    return out.sort((a, b) => a.dist - b.dist);
  }
  const downstreamOf = src => st(src).down_chain.map(c => ({ id: c.id, dist: c.dist_km }));
  function regulatedAbove(s) {                      // 上游有调节设施或分流（D-39：面积可能高估实际水量）
    const fr = s.facility_relation || {};
    if (fr.upstream || fr.in) return true;
    const q = [s.id];
    while (q.length) {
      for (const e of inEdges.get(q.pop()) || []) {
        if (e.facilities.length || e.outflows.length || e.stubs.some(i => I().stub.get(i).flag_facility)) return true;
        q.push(e.up);
      }
    }
    return false;
  }
  const facName = id => { const f = I().fac.get(id); return f ? (f.name || T.facType[f.type]) : id; };
  // 按树排（作者 10-01）：同一条河的上游段在前，各支流段按汇入点自上游而下、紧贴在接收它的站之上，逐级递归。
  // 名次 tree_rank 由 Python 导出（export_basin.py）；原先按到河口的距离排，几条支流的站会交错混排
  const byTree = (a, b) => st(a).tree_rank - st(b).tree_rank;
  const sortIds = () => S.ids.sort(byTree);
  const order = ids => ids.slice().sort(byTree);    // 与 sortIds 同一比较函数（供自检在大量组合上直接验证）

  // ------------------------------------------------------------ 操作
  function add(id, opts = {}) {
    if (!st(id)) return;
    if (!opts.keepTemp) S.temp = null;
    S.notice = null;
    if (!S.ids.includes(id)) {
      if (S.ids.length >= LIMIT) { S.notice = { text: T.full(LIMIT) }; render(); return; }
      S.ids.push(id); sortIds();
      S.expanded = new Set([id]);                   // 新加入的展开，其余折叠（D-44）
      S.flash = new Set([id]);
      S.undo = null;
    } else S.expanded.add(id);                      // 已在栈中：展开它，不重复加入
    if (opts.section) S.fold.set(id, { open: true, section: opts.section, stub: opts.stub || null });
    S.scrollTo = id;
    render();
  }
  function addMany(src, dir) {
    let cand = (dir === 'up' ? upstreamOf(src) : downstreamOf(src)).filter(c => !S.ids.includes(c.id));
    // 按当前筛选过滤（D-44）：M3 起筛选即当前参数，没有该参数数据的站不加入，并在撤销条上写明
    let skipped = 0;
    if (TS().ready) { const n0 = cand.length; cand = cand.filter(c => TS().hasParam(c.id, TS().param)); skipped = n0 - cand.length; }
    S.skipped = skipped;
    if (!cand.length) { S.notice = { text: T.none + (skipped ? ' ' + T.navSkipped(skipped, TS().pname(TS().param)) : '') }; render(); return; }
    const room = LIMIT - S.ids.length;
    if (cand.length > room) {
      S.notice = { text: T.over(cand.length, room), nearest: room > 0 ? cand.slice(0, room).map(c => c.id) : null };
      render();
      return;
    }
    commit(cand.map(c => c.id));
  }
  function commit(ids) {
    S.ids.push(...ids); sortIds();
    S.undo = { ids, n: ids.length, skipped: S.skipped || 0 };   // 加入的行折叠；可整批撤销（D-44）
    S.flash = new Set(ids);
    S.notice = null;
    render();
  }
  function remove(id) {
    S.ids = S.ids.filter(x => x !== id); S.expanded.delete(id); S.fold.delete(id);
    if (S.undo) S.undo.ids = S.undo.ids.filter(x => x !== id);
    render();
  }
  function clear() { S.ids = []; S.expanded = new Set(); S.fold = new Map(); S.undo = null; S.notice = null; render(); }
  function openFacility(fid) { S.temp = { kind: 'facility', fac: fid, tab: 'down', all: false }; S.notice = null; render(); main.scrollTop = 0; }
  // 存根与边（作者 09-30，修订 D-45「点击边或存根即选中其下游的站」）：弹出临时摘要卡片，复用调节设施的机制
  // （虚线边框、浮在栈顶、点空白或 Esc 关闭、不进栈）；末行链接「打开 × 的卡片」，点了才把站加入栈——
  // 点 A 不再得到 B，探索时点几条存根也不会改动用户要比较的站
  function openStub(id) { S.temp = { kind: 'stub', id }; S.notice = null; render(); main.scrollTop = 0; }
  function openEdge(id) { S.temp = { kind: 'edge', id }; S.notice = null; render(); main.scrollTop = 0; }
  function closeTemp(re = true) { if (!S.temp) return; S.temp = null; if (R.clearSel) R.clearSel(); if (re) render(); }
  R.stack = { add, addMany, openFacility, openStub, openEdge, closeTemp, clear, remove, order, state: S };

  // ------------------------------------------------------------ 渲染：各部分
  function tags(s) {                                // 标题行的参数标签（测什么）；多于 5 个时写 +n
    const ps = s.params || [];
    const shown = ps.slice(0, 5).map(p => `<span class="tag" title="${esc(T.param(p))}">${esc(T.pabbr(p))}</span>`).join('');
    return shown + (ps.length > 5 ? `<span class="tag more" title="${esc(ps.slice(5).map(T.param).join(', '))}">+${ps.length - 5}</span>` : '');
  }
  function summary(s) {
    const fr = s.facility_relation || {};
    if (fr.in) return T.sumInRes(facName(fr.in));
    if (s.same_reach_as_up && s.nearest_up) return T.sumSameReach(s.nearest_up.id);
    if (!s.up_sites.length) return T.sumLeaf(R.riverName(s.branch), s.area_km2);
    // 设施分三种情况写（作者 09-24，D-31 只陈述位置关系）：同一条河上 → 「d km below X」；本河没有、上游路径上有 →
    // 「X is d km upstream, on 河名」（让读者知道不在同一条河）；都没有 → 这一句不写，改写相对上游站的位置
    const sf = s.summary_facility;
    const a = !sf ? T.sumBelowSite(s.nearest_up.dist_km, s.nearest_up.id)
      : sf.case === 'same_river' ? T.sumBelowFac(sf.dist_km, facName(sf.id))
        : T.sumFacOther(facName(sf.id), sf.dist_km, sf.river || T.unnamedA(sf.river_area_km2));
    return T.sumJoin(a, T.sumMore(s.incr_area_km2, s.up_sites.length));
  }
  const mbtn = (sid, k) => `<button class="mi" data-act="method" data-id="${esc(sid)}" data-k="${k}" title="${esc(T.methodTitle[k])}">i</button>`;
  function methodBlock(sid, k) {
    if (!S.method.has(sid + ':' + k)) return '';
    return `<div class="method"><b>${esc(T.methodTitle[k])}</b>${T.method[k].map(p => `<p>${esc(typeof p === 'function' ? p(R.state.d) : p)}</p>`).join('')}</div>`;
  }
  // 列表：名称左对齐、数值右对齐（作者 09-24 视觉约定）
  const kv = (k, v, cls = '', attrs = '') => `<li class="kv ${cls}"${attrs}><span class="k">${k}</span><span class="v">${esc(v)}</span></li>`;
  function stubLine(id, focus) {
    const s = I().stub.get(id);
    return kv(esc(R.stubName(s)) + (s.flag_facility ? ' <span class="flag" title="' + esc(T.tipStubFlag) + '"></span>' : ''),
      T.a2(s.area_km2), 'hv' + (focus === id ? ' focus' : ''), ` data-hl="stub:${esc(id)}"`);
  }
  function breakdown(ib, focus) {
    const lis = ib.stubs.map(i => stubLine(i, focus));
    if (!ib.stubs.length && !ib.rest_n) lis.push(`<li class="aux">${esc(T.fNoStubs)}</li>`);
    if (ib.rest_n) lis.push(kv(esc(T.fRestK(ib.rest_n)), T.a2(ib.rest_km2), 'aux'));
    lis.push(kv(esc(T.fLocalK), T.a2(ib.local_km2), 'aux'));
    return `<ul class="klist">${lis.join('')}</ul>`;
  }
  function fold(s) {
    const f = S.fold.get(s.id) || {};
    const parts = [];
    const chain = s.inflow_path.map(x => x.name || T.unnamedA(x.area_km2)).concat([T.fOutletWord]);
    parts.push(`<div class="fsec"><div class="fh">${esc(T.fInflow)}</div><div>${esc(chain.join(' → '))}</div></div>`);
    const nc = s.nearest_confluence;
    parts.push(`<div class="fsec"><div class="fh">${esc(T.fNearest)} ${nc ? mbtn(s.id, 'share') : ''}</div>${
      nc ? `<div class="hv" data-hl="${nc.kind === 'stub' ? 'stub:' + esc(nc.id) : 'confluence:' + esc(nc.id)}">${
        esc(T.fNearestTxt(nc.kind === 'stub' ? R.stubName(I().stub.get(nc.id)) : nc.name || T.unnamedA(nc.area_km2), nc.dist_km, nc.share))}</div>` : `<div class="aux">${esc(T.fNearestNone)}</div>`}${
      methodBlock(s.id, 'share')}</div>`);
    if (s.up_sites.length) {                        // 最上游的站没有「与上游站之间」：它的集水面积全部是自己的
      parts.push(`<div class="fsec${f.section === 'between' ? ' focus' : ''}" data-sec="between"><div class="fh kvh"><span>${
        esc(T.fBetween)}</span><span class="v">${esc(T.a2(s.incr_area_km2))}</span></div>${breakdown(s.incr_breakdown, f.stub)}</div>`);
    }
    if (!s.down_site) {                             // 最下游的站：本站到河口之间（流向河口的那条边，作者 09-24）
      const ob = R.state.d.basin.outlet_incr_breakdown;
      parts.push(`<div class="fsec${f.section === 'outlet' ? ' focus' : ''}" data-sec="outlet"><div class="fh kvh"><span>${
        esc(T.fBetweenOutlet(s.dist_outlet_km))}</span><span class="v">${esc(T.a2(R.state.d.basin.outlet_incr_area_km2))}</span></div>${breakdown(ob, f.stub)}</div>`);
    }
    const fr = s.facility_relation || {};
    const fl = [];
    if (fr.in) fl.push(`<li class="hv" data-hl="facility:${esc(fr.in)}">${esc(T.fFacIn(facName(fr.in)))}</li>`);
    if (fr.upstream) fl.push(kv(esc(T.fFacUpK(facName(fr.upstream.id))), T.d2(fr.upstream.dist_km), 'hv', ` data-hl="facility:${esc(fr.upstream.id)}"`));
    if (fr.downstream) fl.push(kv(esc(T.fFacDownK(facName(fr.downstream.id))), T.d2(fr.downstream.dist_km), 'hv', ` data-hl="facility:${esc(fr.downstream.id)}"`));
    parts.push(`<div class="fsec"><div class="fh">${esc(T.fFacs)}</div>${fl.length ? `<ul class="klist">${fl.join('')}</ul>` : `<div class="aux">${esc(T.fFacNone)}</div>`}</div>`);
    const ts = TS();
    if (ts.ready && s.has_ts) {
      const others = (s.params || []).filter(p => p !== ts.param);
      const on = ts.checked.get(s.id) || new Set();
      if (others.length) {
        parts.push(`<div class="fsec"><div class="fh">${esc(T.fOtherP)}</div><div class="chks">${others.map(p =>
          `<label><input type="checkbox" data-act="chk" data-id="${esc(s.id)}" data-p="${p}"${on.has(p) ? ' checked' : ''}> ${esc(ts.pname(p))}</label>`).join('')}</div>${
          [...on].filter(p => others.includes(p)).map(p => `<div class="more-chart" data-chart="more" data-id="${esc(s.id)}" data-p="${p}"></div>`).join('')}</div>`);
      }
      const qc = ts.qcList(s.id);
      if (qc.length) parts.push(`<div class="fsec"><div class="fh">${esc(T.fQc(ts.pname(ts.param)))}</div><ul class="klist">${
        qc.slice(0, 6).map(x => kv(esc(x.text), String(x.n), 'aux')).join('')}</ul></div>`);
    }
    return `<div class="fold">${parts.join('')}</div>`;
  }
  function card(s) {
    const f = S.fold.get(s.id) || {};
    // 网络位置一行：三格，小字标签在上、数值在下（字号两级）。作者 09-30（侧边栏高度）：默认折叠成一行小字，
    // 与折叠区一起展开——摘要句已写出相对上游站的距离与新增面积；「面积可能高估实际水量」一句照常常驻（D-39）
    const cell = (lab, val) => `<div class="cell"><span class="lab">${lab}</span><span class="val">${esc(val)}</span></div>`;
    const net = cell(esc(T.netLabArea), T.netArea(s.area_km2))
      + (s.up_sites.length ? cell(esc(T.netLabNew) + ' ' + mbtn(s.id, 'incr'), T.netNew(s.incr_area_km2))
        + cell(esc(T.netLabUp), T.netUp(s.nearest_up.id, s.nearest_up.dist_km)) : cell(esc(T.netLabUp), T.netTop));
    return `<div class="card exp${S.flash.has(s.id) ? ' flash' : ''}" data-id="${esc(s.id)}">
      <div class="c-title" data-act="collapse" data-id="${esc(s.id)}"><b class="c-name" title="${esc(s.name)}">${
        esc(s.short_name || s.name)}</b><span class="c-id">${esc(s.id)}</span><span class="c-tags">${tags(s)}</span><button class="x" data-act="remove" data-id="${esc(s.id)}" title="×">×</button></div>
      <div class="c-sum">${esc(summary(s))}</div>
      ${dataArea(s)}
      ${f.open ? `<div class="c-net">${net}<button class="fold-btn open" data-act="fold" data-id="${esc(s.id)}">▾</button></div>`
        : `<div class="c-net closed" data-act="fold" data-id="${esc(s.id)}"><span class="lab">${esc(T.netClosed)}</span><button class="fold-btn" data-act="fold" data-id="${esc(s.id)}">▾</button></div>`}
      ${f.open ? methodBlock(s.id, 'incr') : ''}
      ${regulatedAbove(s) ? `<div class="c-warn">${esc(T.overstate)}</div>` : ''}
      ${f.open ? fold(s) : ''}
      <div class="c-nav"><button data-act="nav" data-dir="up" data-id="${esc(s.id)}">${esc(T.btnUp)}</button><button data-act="nav" data-dir="down" data-id="${esc(s.id)}">${esc(T.btnDown)}</button></div>
    </div>`;
  }
  function row(s) {
    const ts = TS();
    const nots = !s.has_ts || ts.failed;
    const dimmed = ts.ready && !ts.hasParam(s.id, ts.param);
    return `<div class="row${S.flash.has(s.id) ? ' flash' : ''}${nots ? ' nots' : ''}${dimmed ? ' dim' : ''}" data-act="expand" data-id="${esc(s.id)}">
      <div class="r-name"><b title="${esc(s.name)}">${esc(s.short_name || s.name)}</b><span>${esc(s.id)}</span></div>
      ${nots ? '<div class="r-spark none"></div>' : ts.ready ? `<div class="r-spark" data-chart="row" data-id="${esc(s.id)}"></div>`
        : `<div class="r-spark loading">${esc(T.tsLoading)}</div>`}
      <button class="x" data-act="remove" data-id="${esc(s.id)}" title="×">×</button></div>`;
  }
  // 分界行（作者 10-01）：相邻两行不在同一条水流路径上时画在信息行的位置，与信息行同形（同样高度、同样的左侧竖线），
  // 只有两处不同：竖线断成两截；文字写「另一条支流 · 河名」。按树排时分界只出现在支流段开头。
  // 河名：上下两段在哪条河上汇合，就取下面这一段在那条河上汇入的支流。
  // 接收站：上一行流向河口路径上第一个在栈里的站。这一段末尾下面紧跟的不是它（几条支流汇入同一个站时，
  // 前面几段之后是另一条支流的开头）才写「（汇入下方 ××）」；紧邻时下一行就是它，不重复；接收站是河口（栈里没有它下游的站）时不写
  function breakLine(a, b) {
    const br = I().br;
    const chain = x => { const c = []; let cur = st(x).branch; while (cur != null) { c.push(cur); cur = br.get(cur).parent; } return c; };
    const ca = chain(a), cb = chain(b), m = cb.find(x => ca.includes(x));
    const t = cb.indexOf(m) > 0 ? cb[cb.indexOf(m) - 1] : st(b).branch;
    const recv = x => { const c = st(x).down_chain.find(y => S.ids.includes(y.id)); return c ? c.id : null; };
    const P = recv(a);
    let tail = '';
    if (P) {
      let k = S.ids.indexOf(b);
      while (k < S.ids.length && recv(S.ids[k]) !== P) k++;          // 这一段的最后一站（它的接收站就是 P）
      if (S.ids[k + 1] !== P) tail = T.infoJoins(P);
    }
    const txt = T.infoOther(R.riverName(t)) + tail;
    return `<div class="brk" title="${esc(txt)}"><span>${esc(txt)}</span></div>`;
  }
  function infoLine(a, b) {                         // 行间信息行（§7.3）：仅当 b 在 a 流向河口的路径上
    const c = st(a).down_chain.find(x => x.id === b);
    if (!c) return breakLine(a, b);
    let parts;
    if (c.same_reach) parts = [T.infoDist(c.dist_km), T.infoSame];
    else {
      parts = [T.infoDist(c.dist_km)];
      const names = c.tribs.map(t => t[0] === 'S' ? R.stubName(I().stub.get(t)) : R.riverName(+t.slice(1)));
      if (names.length || c.rest_n) parts.push(T.infoTribs(names.join(', '), c.rest_n, c.trib_km2));
      if (c.facilities.length) parts.push(T.infoFacs(c.facilities.map(facName).join(', ')));
      for (const o of c.outflows) parts.push(T.infoOut(I().stub.get(o).to || '—'));
    }
    const txt = parts.join(' · ');
    const ts = TS();
    // 区间降雨小柱（D-42 R2）：a、b 之间新增土地的降雨。相邻时为 b 的增量区间；不相邻时（跳站比较，如栈里只有 A 和 D）
    // 把中间各站的增量区间按面积加权合成一条（作者 09-30，ts.pathRain）。零面积区间（同河段相邻站）没有降雨
    const bars = ts.ready && ts.hasPathRain(a, b);
    const small = bars && ts.isSmallPath(a, b);
    return `<div class="info${bars ? ' with-rain' : ''}" title="${esc(txt)}"><span>${esc(txt)}${small ? ' · ' + esc(T.infoSmall) : ''}</span>${
      bars ? `<div class="info-rain" data-chart="irain" data-from="${esc(a)}" data-id="${esc(b)}"></div>` : ''}</div>`;
  }
  function tempCard() {
    if (S.temp.kind === 'stub') return stubCard(I().stub.get(S.temp.id));
    if (S.temp.kind === 'edge') return edgeCard(I().edge.get(S.temp.id));
    const f = I().fac.get(S.temp.fac);
    const tab = S.temp.tab;
    const lists = { up: f.up_sites, in: f.in_sites, down: f.down_sites };
    const L = [...lists[tab]].sort((a, b) => a.dist_km - b.dist_km);
    const shown = S.temp.all ? L : L.slice(0, 5);
    const li = shown.map(x => { const s = st(x.id); return kv(`<b>${esc(x.id)}</b> ${esc(s ? s.short_name || s.name : '')}`,
      T.d2(x.dist_km), 'hv', ` data-act="addsite" data-id="${esc(x.id)}" data-hl="station:${esc(x.id)}"`); }).join('');
    const below = [...f.down_sites].sort((a, b) => a.dist_km - b.dist_km)[0];
    const bs = below && st(below.id);
    return `<div class="card temp">
      <div class="c-title"><b>${esc(f.name || T.facType[f.type])}</b><span class="c-type">${esc(T.facType[f.type])}</span><span class="c-tag">${
        esc(T.facTemp)}</span><button class="x" data-act="closetemp" title="×">×</button></div>
      <div class="c-sum">${esc(T.tipOperator(f.operator))} · ${esc(T.facUse(f.use))}</div>
      <div class="tabs">${['up', 'in', 'down'].map(k => `<button data-act="tab" data-k="${k}" class="${k === tab ? 'on' : ''}">${
        esc(T.facTabs[k])} (${lists[k].length})</button>`).join('')}</div>
      <ul class="klist slist">${li || `<li class="aux">${esc(T.facNone)}</li>`}</ul>
      ${L.length > 5 && !S.temp.all ? `<button class="link" data-act="all">${esc(T.facAll(L.length))}</button>` : ''}
      ${f.level_sites && f.level_sites.length && TS().ready ? `<div class="c-level" data-chart="level" data-id="${esc(f.id)}"></div>` : ''}
      ${below ? `<div class="c-link hv" data-act="addsite" data-id="${esc(below.id)}" data-hl="station:${esc(below.id)}">${
        esc(T.facBelow((bs ? bs.short_name + ' ' : '') + below.id, below.dist_km))}</div>` : ''}
    </div>`;
  }
  const siteLab = id => { const s = st(id); return s ? `${id} ${s.short_name || s.name}` : id; };
  const tempHead = (title, type) => `<div class="c-title"><b>${esc(title)}</b><span class="c-type">${esc(type)}</span><span class="c-tag">${
    esc(T.facTemp)}</span><button class="x" data-act="closetemp" title="×">×</button></div>`;
  // 末行链接：打开下游站的卡片（流向河口的边为上游站），并展开对应的区块（与原先点边、点存根的落点相同）
  const openLink = (e, stub) => { const tgt = e.down || e.up;
    return `<div class="c-link hv" data-act="opensite" data-id="${esc(tgt)}" data-sec="${e.down ? 'between' : 'outlet'}"${
      stub ? ` data-stub="${esc(stub)}"` : ''} data-hl="station:${esc(tgt)}">${esc(T.tmpOpen(siteLab(tgt)))}</div>`; };
  function stubCard(sb) {                           // 存根：四行，不重复行间信息行与站点折叠区的内容
    const e = I().edge.get(sb.edge_owner);
    const lis = [kv(esc(T.tmpArea), T.tmpAreaShare(sb.area_km2, sb.share))];
    if (sb.flag_facility) lis.push(kv(esc(T.tmpFacUp), sb.facilities_up.length ? sb.facilities_up.join(', ') : T.tmpFacUpYes));
    lis.push(kv(esc(T.tmpWhere), e.down ? T.tmpBetween(e.up, e.down) : T.tmpBetweenOutlet(e.up)));
    return `<div class="card temp">${tempHead(R.stubName(sb), T.tmpStubType)}<ul class="klist">${lis.join('')}</ul>${openLink(e, sb.id)}</div>`;
  }
  function edgeCard(e) {                            // 边：上下游站、河道距离、途中汇入几条与合计面积、经过的设施
    const j = e.joins, n = j.tribs.length + j.rest_n;
    const lis = [kv(esc(T.tmpUp), siteLab(e.up)), kv(esc(T.tmpDown), e.down ? siteLab(e.down) : T.fOutletWord),
      kv(esc(T.tmpDist), T.d2(e.dist_km)), kv(esc(T.tmpJoins(n)), n ? T.a2(j.trib_km2) : '—')];
    if (j.facilities.length) lis.push(kv(esc(T.tmpFacs), j.facilities.map(facName).join(', ')));
    return `<div class="card temp">${tempHead(e.down ? T.tmpEdgeTitle(e.up, e.down) : T.tmpEdgeTitleOut(e.up), T.tmpEdgeType)}<ul class="klist">${
      lis.join('')}</ul>${openLink(e, null)}</div>`;
  }

  function emptyState() {                           // T-11（§7.5）：概况 → 三条操作提示 → 覆盖率细节（折叠）
    const d = R.state.d, b = d.basin;
    const tips = T.tips.slice();
    if (R.state.view === 'map') tips.push(T.tipMap);    // 地图视图下多一条（D-45）
    const cov = b.top_unmonitored.map(x => kv(esc(x.stub ? R.stubName(I().stub.get(x.stub)) : x.name || T.unnamed), T.covArea(x.area_km2, x.basin_share), 'hv',
      x.stub ? ` data-hl="stub:${esc(x.stub)}"` : '')).join('');
    const nSec = (d.meta.excluded || {})['位于次要出口'] || 0;
    // 三块（概况、操作提示、覆盖率细节）之间用分隔线分组（作者 09-24）；操作提示为三行小字短句、不编号
    return `<div class="empty">
      <div class="blk"><p class="e-count">${esc(T.emptyCount(b.n_stations, Math.round(b.unmonitored_share * 100)))} ${mbtn('basin', 'coverage')}</p>
        ${methodBlock('basin', 'coverage')}
        <p class="aux">${esc(T.note)}</p>
        ${nSec ? `<p class="aux">${esc(T.multiOutlet(nSec))}</p>` : ''}
        ${TS().failed ? `<p class="aux">${esc(T.noTs)}</p>` : ''}</div>
      <div class="blk tips">${tips.map(t => `<div>${esc(t)}</div>`).join('')}</div>
      <div class="blk cov"><button class="cov-h${S.covOpen ? ' open' : ''}" data-act="cov">${esc(T.covDetail)} ${S.covOpen ? '▴' : '▾'}</button>
        ${S.covOpen ? `<ul class="klist">${cov}</ul>` : ''}</div>
    </div>`;
  }

  // ------------------------------------------------------------ 渲染：整体
  function fitTags(root) {
    root.querySelectorAll('.c-tags').forEach(box => {
      const tags = [...box.querySelectorAll('.tag:not(.more)')];
      let more = box.querySelector('.tag.more');
      let n = more ? +more.textContent.slice(1) : 0;
      const hid = more ? (more.title ? more.title.split(', ') : []) : [];
      while (box.scrollWidth > box.clientWidth + 0.5 && tags.length) {
        const t = tags.pop();
        t.style.display = 'none'; n++; hid.unshift(t.title);
        if (!more) { more = document.createElement('span'); more.className = 'tag more'; box.appendChild(more); }
        more.textContent = '+' + n; more.title = hid.join(', ');
      }
    });
  }
  function render() {
    const d = R.state.d;
    if (!d || !I()) return;
    titleEl.textContent = T.stackTitle(d.basin.name, S.ids.length);
    const h = [];
    if (S.temp) h.push(`<div class="blk">${tempCard()}</div>`);
    if (S.notice) {
      h.push(`<div class="notice">${esc(S.notice.text)}${S.notice.nearest ? ` <button data-act="nearest">${
        esc(T.addNearest(S.notice.nearest.length))}</button>` : ''} <button class="link" data-act="dismiss">${esc(T.cancel)}</button></div>`);
    }
    if (S.undo && S.undo.ids.length) h.push(`<div class="undo">${esc(T.added(S.undo.n))}<button class="link" data-act="undo">${esc(T.undo)}</button>${
      S.undo.skipped ? `<div class="aux">${esc(T.navSkipped(S.undo.skipped, TS().pname(TS().param)))}</div>` : ''}</div>`);
    const ts = TS();
    if (ts.ready && S.ids.length) {                 // 改筛选不动栈，不符合的淡显并在栈顶给出汇总（D-44）
      const n = S.ids.filter(id => !ts.hasParam(id, ts.param)).length;
      if (n) h.push(`<div class="stack-note aux">${esc(T.stackNoParam(n, ts.pname(ts.param)))}</div>`);
    }
    if (!S.ids.length) h.push(`<div class="blk">${emptyState()}</div>`);
    else {
      const rows = [];
      S.ids.forEach((id, i) => {
        if (i > 0) rows.push(infoLine(S.ids[i - 1], id));
        rows.push(S.expanded.has(id) ? card(st(id)) : row(st(id)));
      });
      h.push(`<div class="stack">${rows.join('')}</div>`);
      // 作者 10-04（反馈 F8）：数据区与公共时间轴之间留空隙并画一条分隔线——轴管的是栈里所有的行，不只属于最后一行；
      // 分隔线以下轴在上、Clear 在下靠右，不并排。轴与各行曲线、行间降雨小柱、卡片各层左右端点一致（同为曲线区 247 px）
      h.push('<div class="stack-sep"></div>');
      if (ts.ready) h.push('<div class="t-axis" data-chart="axis"></div>');     // 栈底只有刻度（§9）
      h.push(`<div class="stack-foot"><button data-act="clear">${esc(T.btnClear)}</button></div>`);
    }
    const keep = main.scrollTop;
    main.innerHTML = h.join('');
    main.scrollTop = keep;
    if (S.scrollTo) {
      const el = main.querySelector(`[data-id="${CSS.escape(S.scrollTo)}"]`);
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
      S.scrollTo = null;
    }
    fitTags(main);                                  // 参数标签放不下的收进「+n」（验收修订 10-01：站名优先）
    if (ts.ready) ts.hydrate(main);                 // 图表（M3，ts.js）
    S.flash = new Set();                            // 闪烁只在加入的那一次（CSS 动画 1.2 s）
    drawRings();
    document.body.dataset.stack = JSON.stringify({ ids: S.ids, expanded: [...S.expanded], temp: S.temp && (S.temp.fac || S.temp.kind + ':' + S.temp.id) });
    applyLinked();
    R.emit('stack');
  }
  R.on('sidebar', render);
  // 联动（作者 10-01）：画布、小地图上悬停到的站，侧边栏对应的折叠行或展开卡片加浅色底（#EEF5FA，与列表项同色）。
  // 读 interact.js 的当前高亮集合（只看悬停，不看选中）；悬停边时两端的站都算（边的范围含两端）
  function applyLinked() {
    const h = R.hlState ? R.hlState() : null;
    const on = h ? h.hover.stations : new Set();
    main.querySelectorAll('.row[data-id], .card.exp[data-id]').forEach(el => el.classList.toggle('linked', on.has(el.dataset.id)));
  }
  R.on('hl', applyLinked);
  R.on('layout', () => { if (!S.ids.length) render(); });   // 视图切换后空栈的操作提示不同（D-45）

  // 画布：栈内的站一种外观——半径 11、线宽 2.5 的交互色环（作者 10-01 取消细环：原细环 1.5 与粗环 2.5 只差 1 px，
  // 而白边本身 1.5 px，差别被抹平，实测分辨不出；哪张卡片展开，侧边栏自己看得出来，画布不必再说一遍）
  const RING_W = 2.5;
  function drawRings() {
    const s = R.state;
    if (!s.frame || !I()) return;
    const L = R.layer.rings, Wh = R.layer.ringWhites;
    L.selectAll('*').remove();
    Wh.selectAll('*').remove();
    // 验收修订 10-01：圆环外侧加一圈 1.5 px 白边，交互蓝画在深蓝干流上也看得清。
    // 作者 10-04（F10）：环内侧也填白（不透明）。蓝贴蓝的那条边界在内侧——环内露出 2.25 px 河道色（环内缘 9.75 − 站点白边 7.5），
    // 外白边碰不到它；内侧填白后环夹在两道白之间，对内侧 1.04 → 5.19:1。白边与白底都画在坝标记之下（ringWhites 层），
    // 环画在坝标记之上、站点之下（rings 层），所以环内站点下面的坝标记不会被白底盖住
    const rs = S.ids.map(id => ({ c: R.stCenter(st(id), s.frame.t), w: RING_W }));
    for (const r of rs) Wh.append('circle').attr('class', 'ring-halo').attr('cx', r.c[0]).attr('cy', r.c[1])
      .attr('r', 11 + r.w / 2 + 0.75).attr('stroke-width', 1.5);
    for (const r of rs) Wh.append('circle').attr('class', 'ring-fill').attr('cx', r.c[0]).attr('cy', r.c[1]).attr('r', 11);
    for (const r of rs) L.append('circle').attr('class', 'ring').attr('cx', r.c[0]).attr('cy', r.c[1]).attr('r', 11).attr('stroke-width', r.w);
  }
  R.on('draw', drawRings);

  // ------------------------------------------------------------ 侧边栏事件
  main.addEventListener('click', ev => {
    const el = ev.target.closest('[data-act]');
    if (!el) return;
    if (ev.target.closest('svg.ts-svg')) return;    // 图表上的点击留给拖选与双击（ts.js）
    const act = el.dataset.act, id = el.dataset.id;
    ev.stopPropagation();
    switch (act) {
      case 'remove': remove(id); break;
      case 'expand': S.expanded.add(id); render(); break;
      case 'collapse': if (ev.target.closest('button')) return; S.expanded.delete(id); render(); break;
      case 'fold': { const f = S.fold.get(id) || {}; S.fold.set(id, { ...f, open: !f.open, section: null, stub: null }); render(); break; }
      case 'nav': addMany(id, el.dataset.dir); break;
      case 'undo': S.ids = S.ids.filter(x => !S.undo.ids.includes(x)); S.undo = null; render(); break;
      case 'nearest': commit(S.notice.nearest); break;
      case 'dismiss': S.notice = null; render(); break;
      case 'clear': clear(); break;                 // 无确认、无撤销（D-44）
      case 'closetemp': closeTemp(); break;
      case 'tab': S.temp.tab = el.dataset.k; S.temp.all = false; render(); break;
      case 'all': S.temp.all = true; render(); break;
      case 'addsite': add(id, { keepTemp: true }); break;
      case 'opensite': add(id, { section: el.dataset.sec, stub: el.dataset.stub || null }); break;   // 存根 / 边临时卡片的末行链接
      case 'method': { const k = id + ':' + el.dataset.k; if (S.method.has(k)) S.method.delete(k); else S.method.add(k); render(); break; }
      case 'cov': S.covOpen = !S.covOpen; render(); break;
      case 'five': TS().setRange({ preset: '5y' }); break;   // 「展开到五年」：全局时间范围切到近五年（作者 10-01）
      case 'chk': {
        const set = TS().checked.get(id) || new Set();
        if (el.checked) set.add(el.dataset.p); else set.delete(el.dataset.p);
        TS().checked.set(id, set); render(); break;
      }
    }
  });
  // 面板与画布联动：悬停面板里的站、支流、设施时，画布同步高亮（§5.4）
  main.addEventListener('mouseover', ev => {
    const el = ev.target.closest('[data-hl], .card.exp, .row');
    if (!el) { if (R.preview) R.preview(null); return; }
    const hl = el.dataset.hl || (el.dataset.id ? 'station:' + el.dataset.id : null);
    if (R.preview) R.preview(hl);
  });
  main.addEventListener('mouseleave', () => { if (R.preview) R.preview(null); });

  // ------------------------------------------------------------ 调试参数（只供自检截图）
  let debugDone = false;
  R.on('layout', () => {
    if (debugDone || !R.state.d) return;
    debugDone = true;
    const Q = R.Q;
    for (const id of (Q.get('stack') || '').split(',').filter(Boolean)) add(id);
    if (Q.get('expand')) { S.expanded = new Set(Q.get('expand').split(',')); render(); }
    if (Q.get('fold')) { const [id, sec] = Q.get('fold').split(':'); S.fold.set(id, { open: true, section: sec || null }); render(); }
    if (Q.get('method')) { S.method.add(Q.get('method')); render(); }
    if (Q.get('nav')) { const [id, dir] = Q.get('nav').split(':'); addMany(id, dir); }
    if (Q.get('fac')) { openFacility(Q.get('fac')); if (Q.get('facTab')) { S.temp.tab = Q.get('facTab'); render(); } }
    if (Q.get('tmp')) { const [k, id] = Q.get('tmp').split(':'); if (k === 'stub') openStub(id); else if (k === 'edge') openEdge(id); }
    if (Q.get('cov')) { S.covOpen = true; render(); }
  });
})();
