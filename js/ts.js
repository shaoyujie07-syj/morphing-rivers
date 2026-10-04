/*
 * ts.js — M3：T-13 降雨、T-15 时间序列、T-16 参数与时间范围（impl-spec §9、§7.1–§7.4、§10；D-42、D-46、D-47、D-55）
 *
 * 三者共用一条时间轴：全局状态只有「当前参数」与「时间范围」，改动后整栈重画、全局同步。
 *   数据：web/data/{basin}_ts.js（T-04b 清洗，export_basin 写出）、{basin}_rain.js（export_rain 写出），按流域延迟载入；
 *         载入失败 → 退化（§10：数据区整块消失，顶部栏隐藏参数与时间范围，空栈写「本版本未接入时间序列数据」）。
 *   参数：顶部栏单选，默认浊度，四流域一致；同一会话切换流域沿用（该流域没有时退到第一个可用参数）。
 *         画布上没有当前参数数据的站淡显（§4.2 不透明度 0.28）；导航按钮按当前参数过滤（D-44）。
 *   时间范围：预设一个月、一个季度、一年、五年、全部记录，默认近一年；「近」以数据快照的最后一天为准。
 *         在任意图表上横向拖选（移动超过 3 px）为自定义，双击复原；按钮显示「自定义 · 复原」。
 *   图表：卡片数据区自上而下 降雨（上游集水区，D-42 R1）→ 流量（对数纵轴）→ 当前参数；人工采样画点、连续数据画线；
 *         日值为空处断开并以浅灰底标出、不跨档连线；该站不测某参数时该层不显示；多站共用同一纵轴量程；
 *         折叠行只画当前参数；栈底只有刻度；折叠行、卡片、刻度的曲线区同宽 227 px 并左右对齐（作者 09-24）。
 *   降雨按实际覆盖的 24 小时画：SILO 日值为截至当日 09:00 的累计，柱子从前一日 09:00 画到当日 09:00。
 *   ERS 目标线（M3+M4 增补，D-40、D-47）：目标值与归属由 export_basin.py / ers_match.py 导出（stations[].ers、meta.ers），
 *         前端只读；卡片与折叠行画红虚线与超标区浅粉，纵轴量程包含目标值（始终画出）；窗口满一年才给百分位统计量，
 *         取窗口最后 12 个月，至少 11 个数据点（ERS clause 19(4)(a)），不下「达标 / 不达标」的结论（D-40）；
 *         不画线的站在卡片里写明原因：不适用（湖库）、未覆盖（ERS 表里没有这一行）、无法判定（作者 09-30）。
 *   行间降雨小柱：两站不相邻时，把中间各站的增量区间按面积（导出的 area_km2）加权合成一条（作者 09-30），与单区间同一口径。
 *   不做：数据可得性条（§9 不做）；插值与补缺（D-16）。
 *
 * 作者标注：本文件由 Claude Code（M3，2026-09-24）编写，见 docs/plan.md §11。
 */
(function () {
  'use strict';
  const R = window.River;
  const T = R.T;
  const W = 247;                                   // 曲线区宽（作者 09-24 按实测 227 px；验收修订 10-01 侧边栏 420 后为 247 px）
  const GUT = 90;                                  // 卡片数据区左侧标签栏：卡片内容起点 13 px + 90 = 折叠行曲线起点 103 px
  const DAY = 864e5, HOUR = 36e5, TZ = 10 * HOUR;  // AEST
  const PRESETS = [['1m', 30], ['3m', 91], ['1y', 365], ['5y', 1826], ['all', null]];
  // 参数固定色与点形（D-48）已取消（作者 10-01）：折叠区每个参数本来就是一张有标题、有量程的独立小图，
  // 靠位置与标签区分，颜色不承担区分任务；九个可选参数也凑不出九个色盲友好的颜色。小图与卡片主图当前参数同为深灰圆点
  const S = { basin: null, data: null, rain: null, meta: null, ready: false, failed: false,
    param: 'turbidity', range: { preset: '1y', t0: null, t1: null }, end: null, start: null, shared: {}, checked: new Map(),
    cache: new Map() };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const dayMs = iso => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - TZ;   // 当日 00:00 AEST
  const fmtDate = ms => { const d = new Date(ms + TZ); return d.toISOString().slice(0, 10); };
  const fmtTime = ms => { const d = new Date(ms + TZ); return d.toISOString().slice(0, 16).replace('T', ' '); };

  // ------------------------------------------------------------ 载入
  function loadScript(src) {
    return new Promise((ok, fail) => {
      const s = document.createElement('script');
      s.src = src; s.onload = ok; s.onerror = () => fail(new Error(src));
      document.head.appendChild(s);
    });
  }
  R.on('build', d => {
    if (R.Q.get('figure')) return;                 // 论文插图不载入时间序列（T-17）
    const id = d.basin.id;
    S.basin = id; S.meta = d.meta; S.ready = false; S.failed = false; S.cache = new Map(); S.checked = new Map();
    S.t0load = performance.now();                  // 自检：载入耗时（停下条件「时间序列体积导致页面明显卡顿」）
    S.data = (window.RIVER_TS || {})[id] || null; S.rain = (window.RIVER_RAIN || {})[id] || null;
    afterPaint(() => {
      if (S.basin !== id) return;                  // 等待期间已切到别的流域
      const need = [];
      if (!S.data) need.push(loadScript(`data/${id}_ts.js`));
      if (!S.rain) need.push(loadScript(`data/${id}_rain.js`).catch(() => null));   // 降雨缺失不致整体退化
      Promise.all(need).then(() => {
        if (S.basin !== id) return;
        S.data = (window.RIVER_TS || {})[id] || null; S.rain = (window.RIVER_RAIN || {})[id] || null;
        if (!S.data) throw new Error('no ts');
        setup(d);
      }).catch(() => { if (S.basin === id) { S.failed = true; S.ready = false; controls(); R.emit('sidebar'); document.body.dataset.ts = 'failed'; } });
    });
  });
  // 首屏画出之后再取时间序列与降雨（作者 10-01：下载量不变，首屏先出来；真正的点开卡片才取留待以后，牵动 D-47）。
  // requestAnimationFrame 在后台标签页里不触发，另以 300 ms 兜底
  function afterPaint(fn) {
    let done = false;
    const go = () => { if (!done) { done = true; fn(); } };
    requestAnimationFrame(() => setTimeout(go, 0)); setTimeout(go, 300);
  }
  function setup(d) {
    const avail = d.meta.params_available || [];
    if (!avail.includes(S.param)) S.param = avail.includes('turbidity') ? 'turbidity' : avail[0];
    // 快照的最后时刻：日值末日的次日 00:00、降雨末日的 09:00、最后一次采样，取最晚
    let end = 0, start = Infinity;
    for (const x of Object.values(S.data)) for (const v of Object.values(x.params)) {
      if (v.daily) { end = Math.max(end, dayMs(v.daily.start) + v.daily.n_days * DAY); start = Math.min(start, dayMs(v.daily.start)); }
      if (v.sample && v.sample.series.length) {
        end = Math.max(end, Date.parse(v.sample.series[v.sample.series.length - 1][0]));
        start = Math.min(start, Date.parse(v.sample.series[0][0]));
      }
    }
    if (S.rain) end = Math.max(end, dayMs(S.rain.end) + 9 * HOUR);
    S.end = end; S.start = start;
    S.ready = true;
    S.loadMs = Math.round(performance.now() - S.t0load);
    controls(); dim(); R.emit('sidebar');
    document.body.dataset.ts = 'ready';
    document.body.dataset.tsLoadMs = S.loadMs;
  }
  R.ts = S;

  // ------------------------------------------------------------ 取数（带缓存）
  function samples(sid, p) {
    const k = sid + '|' + p;
    if (S.cache.has(k)) return S.cache.get(k);
    const x = S.data && S.data[sid] && S.data[sid].params[p];
    let out = null;
    if (x && x.sample && x.sample.series.length) out = x.sample.series.map(r => [Date.parse(r[0]), r[1], r[2]]);
    S.cache.set(k, out);
    return out;
  }
  const daily = (sid, p) => { const x = S.data && S.data[sid] && S.data[sid].params[p]; return x && x.daily ? x.daily : null; };
  const hasParam = (sid, p) => !!(S.data && S.data[sid] && S.data[sid].params[p]);
  S.hasParam = hasParam;
  // 水文年（维州 7 月至次年 6 月）：wy = 起始年份；窗口为 [当年 7 月 1 日 00:00, 次年 7 月 1 日 00:00)（AEST）
  const wyStart = y => Date.UTC(y, 6, 1) - TZ;
  const wyOf = ms => { const d = new Date(ms + TZ); return d.getUTCMonth() >= 6 ? d.getUTCFullYear() : d.getUTCFullYear() - 1; };
  function waterYears() {                          // 当前参数在本流域有数据的水文年（下拉里只列这些）
    const k = 'wy|' + S.param;
    if (S.cache.has(k)) return S.cache.get(k);
    const ys = new Set();
    for (const sid in S.data) {
      for (const r of samples(sid, S.param) || []) if (r[1] != null) ys.add(wyOf(r[0]));
      const dl = daily(sid, S.param);
      if (dl) { const s0 = dayMs(dl.start); for (let i = 0; i < dl.n_days; i++) if (dl.values[i] != null) ys.add(wyOf(s0 + i * DAY)); }
    }
    const out = [...ys].sort((a, b) => b - a);
    S.cache.set(k, out);
    return out;
  }
  function window_() {
    const r = S.range;
    if (r.preset === 'custom') return [r.t0, r.t1];
    if (r.preset === 'wy') return [wyStart(r.y), wyStart(r.y + 1)];
    const days = PRESETS.find(x => x[0] === r.preset)[1];
    if (days) return [S.end - days * DAY, S.end];
    let t0 = Infinity;                              // 全部记录：当前参数在本流域最早的数据
    for (const sid in S.data) {
      const sm = samples(sid, S.param); if (sm) t0 = Math.min(t0, sm[0][0]);
      const dl = daily(sid, S.param); if (dl) t0 = Math.min(t0, dayMs(dl.start));
    }
    return [isFinite(t0) ? t0 : S.start, S.end];
  }
  S.window = window_;
  function ptsAll(sid, p, t0, t1) {                // 窗口内的全部序列：连续日均值（线）在前、人工采样（点）在后
    const out = [];
    const a = ptsDaily(sid, p, t0, t1), b = ptsSample(sid, p, t0, t1);
    if (a) out.push(a);
    if (b) out.push(b);
    return out.length ? out : null;
  }
  const pts = (sid, p, t0, t1) => ptsDaily(sid, p, t0, t1) || ptsSample(sid, p, t0, t1);
  function ptsDaily(sid, p, t0, t1) {
    const dl = daily(sid, p);
    if (dl) {
      const s0 = dayMs(dl.start);
      const i0 = Math.max(0, Math.floor((t0 - s0) / DAY)), i1 = Math.min(dl.n_days, Math.ceil((t1 - s0) / DAY));
      const xs = [], vs = [], qs = [];
      for (let i = i0; i < i1; i++) { xs.push(s0 + i * DAY + 12 * HOUR); vs.push(dl.values[i]); qs.push(dl.q ? dl.q[i] : null); }
      return { kind: 'daily', xs, vs, qs };
    }
    return null;
  }
  function ptsSample(sid, p, t0, t1) {
    const sm = samples(sid, p);
    if (sm) {
      const w = sm.filter(r => r[0] >= t0 && r[0] <= t1);
      return { kind: 'sample', xs: w.map(r => r[0]), vs: w.map(r => r[1]), qs: w.map(r => r[2]) };
    }
    return null;
  }
  function rainPts(sid, t0, t1, which = 'catchment', arr = null) {
    const a = arr || (S.rain && S.rain[which] && S.rain[which][sid]);
    if (!a) return null;
    const s0 = dayMs(S.rain.start) + 9 * HOUR;       // 第 i 天的值覆盖 [s0 + (i−1) 天, s0 + i 天]
    const i0 = Math.max(0, Math.floor((t0 - s0) / DAY)), i1 = Math.min(a.length, Math.ceil((t1 - s0) / DAY) + 1);
    const out = [];
    for (let i = i0; i < i1; i++) out.push([s0 + (i - 1) * DAY, s0 + i * DAY, a[i]]);
    return out;
  }
  S.rainPts = rainPts;
  // 行间信息行的区间降雨（D-42 R2）：a 到 b（b 在 a 流向河口的路径上）之间新增的土地 = 路径上 a 之后、到 b 为止各站的增量区间；
  // 不相邻时按各区间的面积（格子交集之和，export_rain 导出的 area_km2）加权合成，某天个别区间缺测按当天有值的重新归一——
  // 与 export_rain 算上游集水区降雨的口径相同（作者 09-30）。零面积区间（同河段相邻站）没有序列，自然不计入
  function pathRain(a, b) {
    const k = 'ir|' + a + '|' + b;
    if (S.cache.has(k)) return S.cache.get(k);
    const ids = [];
    for (const c of R.idx().st.get(a).down_chain) { ids.push(c.id); if (c.id === b) break; }
    const use = ids.filter(i => S.rain && S.rain.interval[i]);
    let out = null;
    if (use.length === 1) out = { arr: S.rain.interval[use[0]], ids: use, cells: S.rain.cells[use[0]] };
    else if (use.length > 1) {
      const n = S.rain.n_days, arr = new Array(n);
      for (let i = 0; i < n; i++) {
        let num = 0, den = 0;
        for (const id of use) { const v = S.rain.interval[id][i]; if (v != null) { const w = S.rain.area_km2[id]; num += w * v; den += w; } }
        arr[i] = den > 0 ? Math.round(num / den * 10) / 10 : null;
      }
      out = { arr, ids: use, cells: use.reduce((s_, id) => s_ + (S.rain.cells[id] || 0), 0) };
    }
    S.cache.set(k, out);
    return out;
  }
  S.pathRain = pathRain;
  function latest(sid, p) {                        // 悬停提示用的最新读数（窗口无关）
    const dl = daily(sid, p);
    let best = null;
    if (dl) for (let i = dl.n_days - 1; i >= 0; i--) if (dl.values[i] != null) {
      best = { t: dayMs(dl.start) + i * DAY + 12 * HOUR, v: dl.values[i], q: dl.q ? dl.q[i] : null, kind: 'daily' }; break;
    }
    const sm = samples(sid, p);
    if (sm && (!best || sm[sm.length - 1][0] > best.t)) { const r = sm[sm.length - 1]; best = { t: r[0], v: r[1], q: r[2], kind: 'sample' }; }
    return best;
  }
  S.latest = latest;
  const pname = p => T.param(p);                   // 参数名用界面术语（i18n.js），与悬停提示一致
  const punit = p => { const m = S.meta && S.meta.params[p]; return m ? m.unit : ''; };
  // 量程标注只写单位，测定条件（电导率的「(25 °C)」）不进量程，悬停的数值提示仍写全称（作者 10-01：与质量码一样，图上不标、悬停给）
  const punitShort = p => punit(p).replace(/\s*\([^)]*\)\s*$/, '');
  const qcText = q => (q == null ? '' : `${q} ${(S.meta && S.meta.quality_codes[String(q)]) || ''}`.trim());
  S.pname = pname; S.punit = punit; S.qcText = qcText;

  // ------------------------------------------------------------ ERS 目标（D-40、D-47；导出字段只读）
  // → { kind: 'line', seg, region, T: [{stat, op, v}] } 或 { kind: 'none', cat, why }；没有 ERS 数据时为 null
  //   cat：not_applicable 不适用（湖库）/ not_listed 未覆盖 / undetermined 无法判定 / param 该参数没有 ERS 指标
  function ersOf(sid, p) {
    const m = S.meta && S.meta.ers, st = R.idx() && R.idx().st.get(sid), e = st && st.ers;
    if (!m || !e) return null;
    if (m.no_ers_params[p]) return { kind: 'none', cat: 'param', why: m.no_ers_params[p] };
    if (e.status !== 'ok') return { kind: 'none', cat: e.status, why: e.reason, e };
    const row = m.rows[e.row], T = row.targets[p];
    if (!T) return { kind: 'none', cat: 'param', why: 'no_indicator' };
    return { kind: 'line', row: e.row, seg: row.segment, region: row.region, T };
  }
  // 百分位统计量：窗口满一年才算，取窗口最后 12 个月；选一个水文年时取整个水文年（作者 10-01 裁决：「最后 12 个月」是为滚动窗口设计的，
  // 闰水文年 366 天，按 365 天取会漏掉 7 月 1 日）；人工采样满 11 次用人工采样，否则日均值满 11 天用日均值（meta.ers.sample_rule）；
  // 百分位按线性插值（与 numpy 默认、Excel PERCENTILE.INC 相同）；只给数值，不下「达标 / 不达标」的结论（D-40）
  function ersStat(sid, p, E) {
    const m = S.meta.ers, [t0, t1] = window_();
    if (t1 - t0 < 365 * DAY - 2 * HOUR) return { why: 'short' };
    const wy = S.range.preset === 'wy' ? S.range.y : null;
    const a = wy != null ? t0 : t1 - 365 * DAY;
    const nn = P => P ? P.vs.filter(v => v != null) : [];
    const sm = nn(ptsSample(sid, p, a, t1)), dl = nn(ptsDaily(sid, p, a, t1));
    let vals, src;
    if (sm.length >= m.min_n) { vals = sm; src = 'sample'; } else if (dl.length >= m.min_n) { vals = dl; src = 'daily'; }
    else return { why: 'few', n: Math.max(sm.length, dl.length), src: sm.length >= dl.length ? 'sample' : 'daily', wy };
    const srt = vals.slice().sort((x, y) => x - y);
    const res = E.T.map(t => ({ ...t, x: t.stat === 'max' ? srt[srt.length - 1] : d3.quantileSorted(srt, t.stat === 'p75' ? 0.75 : 0.25) }));
    return { n: vals.length, src, res, from: a, to: t1, wy };
  }
  S.ersOf = ersOf; S.ersStat = ersStat;
  function ersLayer(g, E, y, W_, h, strong) {       // 超标区浅粉 + 红虚线（D-48：ERS 目标红虚线、超标区 #F4C0D1）
    if (!E || E.kind !== 'line' || !y) return;
    const [lo, hi] = y.range();                      // range 为 [底, 顶]
    for (const t of E.T) {
      const yy = y(t.v);
      const a = t.op === 'le' ? Math.min(hi, yy) : yy, b = t.op === 'le' ? yy : Math.max(lo, yy);
      const top = Math.max(0, Math.min(a, b)), bot = Math.min(h, Math.max(a, b));
      if (bot > top) g.append('rect').attr('class', 'ts-exceed').attr('x', 0).attr('y', top).attr('width', W_).attr('height', bot - top);
    }
    for (const t of E.T) g.append('line').attr('class', 'ts-ers' + (strong ? '' : ' thin')).attr('x1', 0).attr('x2', W_)
      .attr('y1', y(t.v)).attr('y2', y(t.v));
  }
  const ersShort = E => E.T.length === 2 && E.T[0].op === 'ge' && E.T[1].op === 'le' && E.T[1].stat !== 'max'
    ? `${d3.format('~g')(E.T[0].v)}–${d3.format('~g')(E.T[1].v)}`
    : E.T.map(t => `${t.op === 'le' ? '≤' : '≥'}${d3.format('~g')(t.v)}`).join(' ');
  // 卡片数据区底部的 ERS 一行：有线时写目标与统计量；没有线时写明原因（作者 09-30：不要静默地少一条线）
  function ersLine(sid) {
    const E = ersOf(sid, S.param);
    if (!E || !hasParam(sid, S.param)) return null;
    if (E.kind === 'none') return { cls: 'none', text: T.ersNone(E, pname(S.param)) };
    const st = ersStat(sid, S.param, E);
    return { cls: 'line', text: T.ersLine(pname(S.param), E.seg, E.T, punit(S.param), st), title: T.ersTitle(E.seg, E.region) };
  }
  S.ersLine = ersLine;

  // 稀疏站（作者 10-01）：当前参数在窗口内无数据或少于 3 个点、近五年内有数据时，在卡片数据区给一行「展开到五年」，
  // 点了把全局时间范围切到近五年（全局同步）；近五年也没有数据时只写「近五年无数据」。窗口已是五年或全部记录时不出
  const FIVE = 1826;
  function sparseInfo(sid) {
    const p = S.param;
    if (!hasParam(sid, p) || S.range.preset === '5y' || S.range.preset === 'all') return null;
    const [t0, t1] = window_();
    if (t1 - t0 >= (FIVE - 1) * DAY) return null;
    const nn = P => P ? P.vs.filter(v => v != null).length : 0;
    const nWin = (ptsAll(sid, p, t0, t1) || []).reduce((a, P) => a + nn(P), 0);
    if (nWin >= 3) return null;
    const a5 = S.end - FIVE * DAY;
    return { nWin, nS: nn(ptsSample(sid, p, a5, S.end)), nD: nn(ptsDaily(sid, p, a5, S.end)) };
  }
  S.sparseInfo = sparseInfo;

  // ------------------------------------------------------------ 共用纵轴量程（栈内各站、窗口内）
  function sharedDomains(ids) {
    const [t0, t1] = window_();
    const out = { param: null, flow: null, rain: 0 };
    const ext = (key, p) => {
      let lo = Infinity, hi = -Infinity;
      for (const sid of ids) for (const P of ptsAll(sid, p, t0, t1) || []) {
        for (const v of P.vs) if (v != null && isFinite(v)) {
          if (key === 'flow' && v <= 0) continue;
          lo = Math.min(lo, v); hi = Math.max(hi, v);
        }
      }
      return isFinite(lo) ? [lo, hi] : null;
    };
    out.param = ext('param', S.param);
    // ERS 目标线始终画出（D-47）：纵轴量程包含栈内各站当前参数的目标值
    for (const sid of ids) {
      const E = ersOf(sid, S.param);
      if (E && E.kind === 'line') for (const t of E.T) out.param = out.param ? [Math.min(out.param[0], t.v), Math.max(out.param[1], t.v)] : [t.v, t.v];
    }
    out.flow = ext('flow', 'flow');
    for (const sid of ids) for (const r of rainPts(sid, t0, t1) || []) if (r[2] != null) out.rain = Math.max(out.rain, r[2]);
    S.shared = out;
    return out;
  }
  function yLinear(p, dom, h, pad = 2) {
    if (!dom) return null;
    let [lo, hi] = dom;
    const zeroBased = !['ph', 'temp', 'do_mgl', 'do_sat', 'level', 'storage_level'].includes(p);
    if (zeroBased) lo = Math.min(0, lo);
    if (hi === lo) { hi += 1; lo -= zeroBased ? 0 : 1; }
    return d3.scaleLinear().domain([lo, hi]).range([h - pad, pad]).nice();
  }
  function yLog(dom, h, pad = 2) {
    if (!dom) return null;
    const lo = Math.max(0.1, dom[0]), hi = Math.max(lo * 10, dom[1]);
    return d3.scaleLog().domain([lo, hi]).range([h - pad, pad]).clamp(true);
  }

  // ------------------------------------------------------------ 画一层
  function layer(g, P, x, y, color, opts = {}) {
    if (!P) return;
    const [x0, x1] = x.range();
    if (P.kind === 'daily') {
      // 空档：连续的空日值画浅灰底（D-47：不跨档连线）
      let run = null;
      const gaps = [];
      P.vs.forEach((v, i) => {
        if (v == null) { if (run == null) run = i; }
        else if (run != null) { gaps.push([run, i - 1]); run = null; }
      });
      if (run != null) gaps.push([run, P.vs.length - 1]);
      for (const [a, b] of gaps) {
        const xa = Math.max(x0, x(P.xs[a] - 12 * HOUR)), xb = Math.min(x1, x(P.xs[b] + 12 * HOUR));
        if (xb > xa) g.append('rect').attr('class', 'ts-gap').attr('x', xa).attr('y', 0).attr('width', Math.max(0.5, xb - xa)).attr('height', opts.h);
      }
      const line = d3.line().defined((v, i) => v != null && (!opts.log || v > 0)).x((v, i) => x(P.xs[i])).y(v => y(v));
      g.append('path').attr('class', 'ts-line' + (opts.cls ? ' ' + opts.cls : '')).attr('d', line(P.vs)).attr('stroke', color)
        .attr('stroke-width', opts.w || 1.5);
    } else {
      const sym = d3.symbol().type(opts.shape || d3.symbolCircle).size(opts.size || 10);
      g.selectAll(null).data(P.vs.map((v, i) => [P.xs[i], v]).filter(r => r[1] != null && (!opts.log || r[1] > 0)))
        .enter().append('path').attr('class', 'ts-pt').attr('d', sym).attr('fill', color)
        .attr('transform', r => `translate(${x(r[0])},${y(r[1])})`);
    }
  }
  function rainLayer(g, rows, x, h, max) {
    if (!rows || !max) return;
    const y = d3.scaleLinear().domain([0, max]).range([h, 0]);
    for (const [a, b, v] of rows) {
      if (!v) continue;
      const xa = x(a), xb = x(b);
      if (xb < x.range()[0] || xa > x.range()[1]) continue;
      g.append('rect').attr('class', 'ts-rain').attr('x', xa).attr('y', y(v)).attr('width', Math.max(0.8, xb - xa - 0.2)).attr('height', h - y(v));
    }
  }

  // ------------------------------------------------------------ 图表：折叠行、卡片、刻度、其他参数、库水位
  function xScale() { const [t0, t1] = window_(); return d3.scaleTime().domain([t0, t1]).range([0, W]); }
  // 图表区底边的浅基线（作者 10-01）：1 px #E4E3DD，只起水平对齐作用——看点离底多近、几行之间是否可比、稀疏散点哪些挨着底。
  // 它是图表区的底边，不是零线（pH、水温、溶解氧、水位按数据范围缩放，底边不等于零），所以不标数值、浅到不像参考线；
  // 不画边框（折叠行已有卡片边框；框会与粉色超标带抢视觉）。画在超标带之后、数据之前。
  // 作者 10-01 定的标准：曲线和散点需要基线，柱状图不需要——柱子自己有底。所以「其他参数」小图与库水位图加；
  // 展开卡片的降雨层与行间的区间降雨小柱都是柱状图，不加（柱子的底边就是基线；层间有 4 px 间隔与各自的浅底色分开）
  const baseLine = (g, w, h) => g.append('line').attr('class', 'ts-base').attr('x1', 0).attr('x2', w).attr('y1', h - 0.5).attr('y2', h - 0.5);
  function drawRow(el, sid) {
    const x = xScale(), [t0, t1] = x.domain().map(Number), h = 28;
    const PL = ptsAll(sid, S.param, t0, t1);
    const svg = d3.select(el).html('').append('svg').attr('class', 'ts-svg').attr('width', W).attr('height', h);
    if (!PL || !PL.some(P => P.vs.some(v => v != null))) {
      // 窗口内无数据：ERS 目标线照样画（D-47 始终画出；纵轴量程已包含目标值）
      if (hasParam(sid, S.param)) ersLayer(svg, ersOf(sid, S.param), yLinear(S.param, S.shared.param, h), W, h, false);
      baseLine(svg, W, h);
      svg.append('text').attr('class', 'ts-empty').attr('x', 0).attr('y', h - 4)
        .text(hasParam(sid, S.param) ? T.tsNoneInWindow : T.tsNoParam(pname(S.param)));
      bindBrush(svg, x, h, sid, null);
      return;
    }
    const y = yLinear(S.param, S.shared.param, h);
    const E = ersOf(sid, S.param);
    ersLayer(svg, E, y, W, h, false);
    baseLine(svg, W, h);
    for (const P of PL) layer(svg, P, x, y, '#3B3B38', { h, w: 1.2, size: 8 });   // 折叠行全部同色（D-48）
    if (E && E.kind === 'none') el.title = T.ersNone(E, pname(S.param));        // 折叠行不放文字，原因放悬停
    bindBrush(svg, x, h, sid, [{ y0: 0, y1: h, kind: 'param', PL, y }]);
  }
  function drawCard(el, sid) {
    const x = xScale(), [t0, t1] = x.domain().map(Number);
    const rows = [];                               // 自上而下：降雨 → 流量 → 当前参数（§7.1、D-46）
    const rp = rainPts(sid, t0, t1);
    if (rp) rows.push({ kind: 'rain', h: 16, label: T.tsRain, P: rp });
    if (S.param !== 'flow' && hasParam(sid, 'flow')) rows.push({ kind: 'flow', h: 24, label: pname('flow'), PL: ptsAll(sid, 'flow', t0, t1) });
    if (hasParam(sid, S.param)) rows.push({ kind: 'param', h: 40, label: pname(S.param), PL: ptsAll(sid, S.param, t0, t1) });
    const H = rows.reduce((a, r) => a + r.h + 4, 0);
    const box = d3.select(el).html('');
    if (!rows.length) { box.style('display', 'none'); return; }
    const svg = box.append('svg').attr('class', 'ts-svg').attr('width', GUT + W).attr('height', H);
    let y0 = 0;
    const bands = [];
    let sparse = null;                             // 稀疏站：提示写在参数层里（见下）
    for (const r of rows) {
      const g = svg.append('g').attr('transform', `translate(${GUT},${y0})`).attr('data-kind', r.kind);
      g.append('rect').attr('class', 'ts-bg').attr('width', W).attr('height', r.h);
      let y = null, rng = '';
      if (r.kind === 'rain') {
        const mx = S.shared.rain || 1;
        rainLayer(g, r.P, x, r.h, mx);              // 柱状图不画基线（柱子自己有底，作者 10-01）
        rng = `0–${d3.format('.0f')(mx)} mm`;
        y = d3.scaleLinear().domain([0, mx]).range([r.h, 0]);
      } else if (r.kind === 'flow') {
        y = yLog(S.shared.flow, r.h);
        baseLine(g, W, r.h);
        if (y) for (const P of r.PL || []) layer(g, P, x, y, '#4A6E8A', { h: r.h, w: 1, log: true, size: 8 });
        rng = y ? `${d3.format('.2~s')(y.domain()[0])}–${d3.format('.2~s')(y.domain()[1])} ML/d` : '';
      } else {
        y = yLinear(S.param, S.shared.param, r.h);
        r.E = ersOf(sid, S.param);
        ersLayer(g, r.E, y, W, r.h, true);
        baseLine(g, W, r.h);
        if (y) for (const P of r.PL || []) layer(g, P, x, y, '#3B3B38', { h: r.h, w: 1.6, size: 12 });
        rng = y ? `${d3.format('~g')(y.domain()[0])}–${d3.format('~g')(y.domain()[1])} ${punitShort(S.param)}` : '';
      }
      // 稀疏站（作者 10-01 裁决：「展开到五年」并进原有的「窗口内无数据」提示，不另占一行——两者说的是同一件事）：
      // 参数层窗口内无数据或少于 3 个点、近五年有数据时，这一层里写「窗口内只有 N 个点 · 近五年有 M 个样本 — 展开到五年」；
      // 近五年也没有时写「窗口内无数据 · 近五年无数据」。用 HTML 叠在这一层上（图表内的点击留给拖选，链接要在 SVG 之外才点得到）
      const sp = r.kind === 'param' ? sparseInfo(sid) : null;
      if (sp) sparse = { y0, h: r.h, sp };
      else if (r.kind !== 'rain' && !(r.PL || []).some(P => P.vs.some(v => v != null))) {
        g.append('text').attr('class', 'ts-empty').attr('x', 2).attr('y', r.h / 2 + 4).text(T.tsNoneInWindow);
      }
      svg.append('text').attr('class', 'ts-lab').attr('x', 0).attr('y', y0 + Math.min(11, r.h - 3)).text(r.label);
      if (r.h >= 24) svg.append('text').attr('class', 'ts-rng').attr('x', 0).attr('y', y0 + Math.min(24, r.h - 2)).text(rng);
      if (r.E && r.E.kind === 'line' && y) svg.append('text').attr('class', 'ts-ers-lab').attr('x', 0).attr('y', y0 + 36).text('ERS ' + ersShort(r.E));
      bands.push({ y0, y1: y0 + r.h, kind: r.kind, P: r.P, PL: r.PL, y });
      y0 += r.h + 4;
    }
    bindBrush(svg, x, H, sid, bands, GUT);
    if (sparse) {
      const { sp } = sparse;
      box.append('div').attr('class', 'ts-sparse').style('left', (GUT + 2) + 'px').style('top', (sparse.y0 + 2) + 'px')
        .style('width', (W - 4) + 'px').style('height', (sparse.h - 4) + 'px')
        .html(`<span>${esc(T.sparseHead(sp.nWin))} · ${sp.nS + sp.nD > 0
          ? `${esc(T.sparseFive(sp.nS, sp.nD))} — <button class="link" data-act="five">${esc(T.sparseShow)}</button>` : esc(T.sparseNone)}</span>`);
    }
  }
  function methodLine(sid) {                       // 数据区底部一行说明采样方式（§9、D-47）
    const [t0, t1] = window_();
    const parts = [];
    // 当前参数：连续日均值与人工采样合成一句并给出窗口内的数量；流量只写种类（D-47：说明采样方式）
    const cnt = (p, kind) => { const P = (ptsAll(sid, p, t0, t1) || []).find(P => P.kind === kind); return P ? P.vs.filter(v => v != null).length : null; };
    if (hasParam(sid, S.param)) parts.push(T.tsMeth(pname(S.param), cnt(S.param, 'daily'), cnt(S.param, 'sample')));
    if (S.param !== 'flow' && hasParam(sid, 'flow')) parts.push(T.tsMethFlow(pname('flow'), !!daily(sid, 'flow'), !!samples(sid, 'flow')));
    // 作者 09-30（侧边栏高度 (c)）：压成一行，降雨的说明不再写（方法说明第七条里有），超出截断、完整文字悬停
    return parts.join(' · ');
  }
  S.methodLine = methodLine;
  function drawAxis(el) {
    const x = xScale();
    // 作者 10-04（反馈 F8）：轴宽与曲线区相同（247 px，原为 + 12 让末端刻度文字伸出去），左右端点与各行曲线严格一致；
    // 两端的刻度文字若会伸出曲线区，改为向里对齐（左端左对齐、右端右对齐）
    const svg = d3.select(el).html('').append('svg').attr('class', 'ts-svg ts-axis').attr('width', W).attr('height', 22);
    const g = svg.append('g').attr('transform', 'translate(0,1)');
    let tv = x.ticks(4);                           // 最多 4 个刻度，放得下 247 px
    while (tv.length > 4) tv = tv.filter((_, i) => i % 2 === 0);
    g.call(d3.axisBottom(x).tickValues(tv).tickSizeOuter(0).tickFormat(d3.timeFormat(tickFmt())));
    g.selectAll('.tick text').each(function (t) {
      const w = this.getComputedTextLength(), cx = x(t);
      if (cx - w / 2 < 0) d3.select(this).attr('text-anchor', 'start').attr('x', -cx);
      else if (cx + w / 2 > W) d3.select(this).attr('text-anchor', 'end').attr('x', W - cx);
    });
  }
  function tickFmt() {
    const [t0, t1] = window_();
    const span = (t1 - t0) / DAY;
    return span <= 62 ? '%d %b' : span <= 800 ? "%b '%y" : '%Y';
  }
  function drawMore(el, sid, p) {                  // 折叠区的其他参数小图：与卡片主图当前参数同色同形（作者 10-01 取消参数固定色）
    const x = xScale(), [t0, t1] = x.domain().map(Number), h = 30;
    const PL = ptsAll(sid, p, t0, t1) || [];
    const svg = d3.select(el).html('').append('svg').attr('class', 'ts-svg').attr('width', GUT + W).attr('height', h);
    svg.append('text').attr('class', 'ts-lab').attr('x', 0).attr('y', 11).text(pname(p));
    const g = svg.append('g').attr('transform', `translate(${GUT},0)`);
    g.append('rect').attr('class', 'ts-bg').attr('width', W).attr('height', h);
    baseLine(g, W, h);
    let dom = null;
    const vv = PL.flatMap(P => P.vs.filter(v => v != null));
    if (vv.length) dom = [d3.min(vv), d3.max(vv)];
    const y = yLinear(p, dom, h);
    if (y) {
      for (const P of PL) layer(g, P, x, y, '#3B3B38', { h, w: 1.3, size: 12 });
      svg.append('text').attr('class', 'ts-rng').attr('x', 0).attr('y', 24).text(`${d3.format('~g')(y.domain()[0])}–${d3.format('~g')(y.domain()[1])} ${punitShort(p)}`);
    } else g.append('text').attr('class', 'ts-empty').attr('x', 2).attr('y', 19).text(T.tsNoneInWindow);
    bindBrush(svg, x, h, sid, [{ y0: 0, y1: h, kind: 'param', PL, y, p }], GUT);
  }
  function drawLevel(el, fid) {                    // 设施临时卡片的库水位（D-31、D-55 ②：水头站变量 130）
    const f = R.idx().fac.get(fid);
    const sid = (f.level_sites || []).find(s => hasParam(s, 'storage_level') || hasParam(s, 'level'));
    if (!sid) { d3.select(el).style('display', 'none'); return; }
    const p = hasParam(sid, 'storage_level') ? 'storage_level' : 'level';
    const x = xScale(), [t0, t1] = x.domain().map(Number), h = 34;
    const P = pts(sid, p, t0, t1);
    const svg = d3.select(el).html('').append('svg').attr('class', 'ts-svg').attr('width', GUT + W).attr('height', h);
    svg.append('text').attr('class', 'ts-lab').attr('x', 0).attr('y', 11).text(pname(p));
    svg.append('text').attr('class', 'ts-rng').attr('x', 0).attr('y', 24).text(`${sid}`);
    const g = svg.append('g').attr('transform', `translate(${GUT},0)`);
    g.append('rect').attr('class', 'ts-bg').attr('width', W).attr('height', h);
    baseLine(g, W, h);
    let dom = null;
    if (P) { const v = P.vs.filter(v => v != null); if (v.length) dom = [d3.min(v), d3.max(v)]; }
    const y = yLinear(p, dom, h);
    if (y) layer(g, P, x, y, '#4A6E8A', { h, w: 1.3 });
    else g.append('text').attr('class', 'ts-empty').attr('x', 2).attr('y', 20).text(T.tsNoneInWindow);
    bindBrush(svg, x, h, sid, [{ y0: 0, y1: h, kind: 'param', PL: P ? [P] : [], y, p }], GUT);
  }
  // 行间信息行的区间降雨小柱（D-42 R2，T-14）：两站之间新增土地的降雨（相邻为下游站的增量区间，不相邻为路径上各区间按面积合成）；
  // 与曲线区对齐，量程为本行自身的最大值
  function drawIRain(el, a, b) {
    const x = xScale(), [t0, t1] = x.domain().map(Number), h = 11;
    const pr = pathRain(a, b);
    const svg = d3.select(el).html('').append('svg').attr('class', 'ts-svg').attr('width', W).attr('height', h);
    if (!pr) return;
    const rows = rainPts(b, t0, t1, 'interval', pr.arr);
    const mx = d3.max(rows, r => r[2] || 0) || 1;
    rainLayer(svg, rows, x, h, mx);
    el.title = T.infoRain(d3.format('.0f')(mx), pr.cells <= 2, pr.ids.length);
    el.dataset.ids = pr.ids.join(',');              // 自检：参与合成的区间
    bindBrush(svg, x, h, b, [{ y0: 0, y1: h, kind: 'rain', P: rows, which: 'interval' }]);
  }
  S.hasPathRain = (a, b) => !!pathRain(a, b);
  S.isSmallPath = (a, b) => { const pr = pathRain(a, b); return !!pr && pr.cells <= 2; };
  function qcList(sid) {                           // 折叠区的质量码明细（当前参数、窗口内）
    const [t0, t1] = window_();
    const c = new Map();
    for (const P of ptsAll(sid, S.param, t0, t1) || []) {
      P.vs.forEach((v, i) => { if (v != null && P.qs[i] != null) c.set(P.qs[i], (c.get(P.qs[i]) || 0) + 1); });
    }
    return [...c.entries()].sort((a, b) => b[1] - a[1]).map(([q, n]) => ({ q, n, text: qcText(q) }));
  }
  S.qcList = qcList;

  // 由 stack.js 在每次渲染后调用：把占位元素换成图表
  S.hydrate = root => {
    if (!S.ready) return;
    const t0 = performance.now();
    const ids = R.stack ? R.stack.state.ids : [];
    sharedDomains(ids);
    root.querySelectorAll('[data-chart]').forEach(el => {
      const k = el.dataset.chart, id = el.dataset.id;
      if (k === 'row') drawRow(el, id);
      else if (k === 'card') drawCard(el, id);
      else if (k === 'axis') drawAxis(el);
      else if (k === 'more') drawMore(el, id, el.dataset.p);
      else if (k === 'level') drawLevel(el, id);
      else if (k === 'irain') drawIRain(el, el.dataset.from, id);
      else if (k === 'ers') { const L = ersLine(id), row = el.parentNode; if (!L) row.style.display = 'none'; else {
        el.textContent = L.text; el.title = L.title ? L.text + '\n' + L.title : L.text; row.classList.add(L.cls); } }
    });
    S.hydrateMs = Math.round(performance.now() - t0);
    document.body.dataset.tsHydrateMs = S.hydrateMs;
  };

  // ------------------------------------------------------------ 拖选缩放、双击复原、悬停提示
  const tip = d3.select('body').append('div').attr('class', 'tip ts-tip').style('display', 'none').style('position', 'fixed');
  function bindBrush(svg, x, H, sid, bands, off = 0) {
    const node = svg.node();
    let down = null, rect = null;
    const px = ev => ev.clientX - node.getBoundingClientRect().left - off;
    node.addEventListener('pointerdown', ev => { down = px(ev); node.setPointerCapture(ev.pointerId); });
    node.addEventListener('pointermove', ev => {
      const p = px(ev);
      if (down != null && Math.abs(p - down) > 3) {           // 移动超过 3 px 才算拖选（§9）
        tip.style('display', 'none');
        if (!rect) rect = svg.append('rect').attr('class', 'ts-brush').attr('y', 0).attr('height', H);
        const a = Math.max(0, Math.min(down, p)), b = Math.min(W, Math.max(down, p));
        rect.attr('x', off + a).attr('width', b - a);
        return;
      }
      if (down == null && bands) hover(ev, p, x, bands, node);
    });
    node.addEventListener('pointerup', ev => {
      const p = px(ev);
      if (down != null && Math.abs(p - down) > 3) {
        const a = Math.max(0, Math.min(down, p)), b = Math.min(W, Math.max(down, p));
        if (b - a > 2) setRange({ preset: 'custom', t0: +x.invert(a), t1: +x.invert(b) });
      }
      down = null; if (rect) { rect.remove(); rect = null; }
    });
    node.addEventListener('pointerleave', () => tip.style('display', 'none'));
    node.addEventListener('dblclick', () => setRange({ preset: '1y' }));     // 双击复原（默认近一年）
  }
  function hover(ev, p, x, bands, node) {
    if (p < 0 || p > W) { tip.style('display', 'none'); return; }
    const yy = ev.clientY - node.getBoundingClientRect().top;
    const b = bands.find(b => yy >= b.y0 - 2 && yy <= b.y1 + 2);
    if (!b || (!b.P && !b.PL)) { tip.style('display', 'none'); return; }
    const t = +x.invert(p);
    let html = '';
    if (b.kind === 'rain') {
      const r = b.P.find(r => t >= r[0] && t < r[1]);
      if (!r || r[2] == null) { tip.style('display', 'none'); return; }
      const iv = b.which === 'interval';           // 行间小柱是区间平均，卡片降雨层是上游集水区平均（作者 09-30：都要注明不是站点所在处的雨量）
      html = `<div><b>${esc(T.tsRain)} ${esc(d3.format('.1f')(r[2]))} mm</b></div><div class="tt-note">${esc((iv ? T.tsRainSpanIv : T.tsRainSpan)(fmtTime(r[0]), fmtTime(r[1])))}</div>`
        + `<div class="tt-note">${esc(iv ? T.tsRainCaveatIv : T.tsRainCaveat)}</div>`;
    } else {
      let bi = -1, bd = Infinity, BP = null;
      for (const P of b.PL || (b.P ? [b.P] : [])) {
        P.xs.forEach((xs, i) => { if (P.vs[i] == null) return; const dd = Math.abs(x(xs) - p); if (dd < bd) { bd = dd; bi = i; BP = P; } });
      }
      if (bi < 0 || bd > 12) { tip.style('display', 'none'); return; }
      const par = b.p || (b.kind === 'flow' ? 'flow' : S.param);
      html = `<div><b>${esc(pname(par))} ${esc(d3.format(',~g')(+(+BP.vs[bi]).toPrecision(4)))} ${esc(punit(par))}</b></div>` +
        `<div class="tt-note">${esc(BP.kind === 'daily' ? T.tsDayMean(fmtDate(BP.xs[bi])) : T.tsSampleAt(fmtTime(BP.xs[bi])))}</div>` +
        (BP.qs[bi] != null ? `<div class="tt-note">${esc(T.tsQuality(qcText(BP.qs[bi])))}</div>` : '');
    }
    tip.html(html).style('display', 'block');
    const w = tip.node().offsetWidth;
    let lx = ev.clientX - w - 14;
    if (lx < 4) lx = ev.clientX + 14;
    tip.style('left', lx + 'px').style('top', (ev.clientY + 12) + 'px');
  }
  function setRange(r) {
    S.range = { preset: r.preset, t0: r.t0 || null, t1: r.t1 || null, y: r.y != null ? r.y : null };
    controls(); R.emit('sidebar');
  }
  // 作者 10-01：删去范围按钮两侧的前后移动箭头——滚动预设锚定在「现在」，与前后移动语义冲突（「近一年」点 ← 后变成
  // 「自定义」，→ 随即变灰，回不去）。看相邻时段改选水文年或重填自定义日期。水文年保留：ERS 按年度百分位定义，
  // 滚动的「近一年」跨两个水文年，水文年是唯一能正确对应 ERS 的选法
  S.setRange = setRange;

  // ------------------------------------------------------------ 顶部栏：参数、时间范围（D-46、D-47）
  const psel = document.getElementById('param-select'), rbtn = document.getElementById('range-btn');
  const isoDay = ms => fmtDate(ms);
  const menu = d3.select('#topbar .grp-filters').append('div').attr('class', 'range-menu').style('display', 'none');
  function controls() {
    const grp = document.querySelector('#topbar .grp-filters');
    grp.style.display = S.failed ? 'none' : '';       // 退化：隐藏参数与时间范围控件（§10）
    if (!S.ready) return;
    psel.disabled = false; rbtn.disabled = false;
    psel.removeAttribute('title'); rbtn.removeAttribute('title');
    const [w0, w1] = window_();
    const wys = waterYears();
    const avail = S.meta.params_available || [];
    d3.select(psel).selectAll('option').data(avail, p => p).join('option').attr('value', p => p).text(p => pname(p));
    psel.value = S.param;
    const pr = S.range.preset;
    const lab = pr === 'custom' ? T.rangeCustom : pr === 'wy' ? T.rangeYearBtn(S.range.y) : T.rangeName[pr];
    rbtn.innerHTML = pr === 'custom' || pr === 'wy' ? `${esc(lab)} · <span class="rr">${esc(T.rangeReset)}</span>` : `${esc(lab)} ▾`;
    // 菜单：预设 → 选一个年度（7 月至次年 6 月，有数据的年份）→ 自定义日期（两个日期框）；拖选缩放与双击复原照旧（验收修订 10-01）。
    // 作者 10-04（反馈 F6）：年度改为分组标题加纯年份——标题灰色小字、不可选，口径写在括号里；每项只写年份，界面上不再出现
    // 「water year」。口径不改成日历年：ERS 目标按 7 月至次年 6 月的年度百分位定义
    menu.html(PRESETS.map(([k]) => `<button data-k="${k}" class="${pr === k ? 'on' : ''}">${esc(T.rangeName[k])}</button>`).join('')
      // 年份多（Goulburn 浊度人工采样回溯到 1975–76，52 个）：放进约 8 行高的滚动框，选中的年份打开菜单时滚到可见
      + `<div class="rm-sec">${esc(T.rangeYearHead)}</div><div class="rm-years">${
        wys.map(y => `<button data-wy="${y}" class="rm-y${pr === 'wy' && S.range.y === y ? ' on' : ''}">${esc(T.rangeYear(y))}</button>`).join('')}</div>`
      + `<div class="rm-sec">${esc(T.rangeDatesHead)}</div><div class="rm-row"><input type="date" data-rm="d0" value="${isoDay(w0)}">`
      + `<span>–</span><input type="date" data-rm="d1" value="${isoDay(w1 - DAY)}"><button data-rm="apply">${esc(T.rangeApply)}</button></div>`
      + `<div class="rm-note">${esc(T.rangeAllNote)}</div>`);
  }
  psel.addEventListener('change', () => { S.param = psel.value; dim(); R.emit('sidebar'); document.body.dataset.param = S.param; });
  rbtn.addEventListener('click', ev => {
    if (ev.target.classList.contains('rr')) { setRange({ preset: '1y' }); return; }
    const open = menu.style('display') === 'none';
    menu.style('display', open ? 'block' : 'none');
    const on = open && menu.select('.rm-years .on').node();
    if (on) { const box = on.parentNode; box.scrollTop = on.offsetTop - box.offsetTop - box.clientHeight / 2 + on.offsetHeight / 2; }
  });
  menu.on('click', ev => {
    if (ev.target.closest('[data-rm="apply"]')) {
      const a = menu.select('[data-rm="d0"]').property('value'), b = menu.select('[data-rm="d1"]').property('value');
      if (a && b && b >= a) { menu.style('display', 'none'); setRange({ preset: 'custom', t0: dayMs(a), t1: dayMs(b) + DAY }); }
      return;
    }
    const y = ev.target.closest('button[data-wy]');
    if (y) { menu.style('display', 'none'); setRange({ preset: 'wy', y: +y.dataset.wy }); return; }
    const b = ev.target.closest('button[data-k]');
    if (!b) return;
    menu.style('display', 'none');
    setRange({ preset: b.dataset.k });
  });
  document.addEventListener('click', ev => { if (!ev.target.closest('.grp-filters')) menu.style('display', 'none'); });

  // 画布：没有当前参数数据的站淡显（§4.2 第二层）。作者 09-30：改为不透明的浅灰实心 #B0AFA8 加白边，不用透明度——
  // 0.28 的透明度压在 9.5 px 干流上会与河道糊成一片；这个颜色在 D-56 去掉「灰 = 已停测」后空出来，不会撞车
  function dim() {
    if (!S.ready) return;
    R.layer.stations.selectAll('g').attr('opacity', null).classed('faded', st => !hasParam(st.id, S.param));
  }
  R.on('draw', () => dim());

  // 调试参数：&param=、&range=1m|3m|1y|5y|all|t0,t1（ISO 日期）
  let debugDone = false;
  R.on('layout', () => {
    if (debugDone) return;                         // 只在首次就绪时应用（否则每次缩放结束都会覆盖用户的选择）
    debugDone = true;
    const Q = R.Q;
    const apply = () => {
      if (Q.get('param')) S.param = Q.get('param');
      const rg = Q.get('range');
      if (rg) {
        if (rg.includes(',')) { const [a, b] = rg.split(','); S.range = { preset: 'custom', t0: dayMs(a), t1: dayMs(b) }; }
        else if (rg.startsWith('wy')) S.range = { preset: 'wy', y: +rg.slice(2) };      // &range=wy2024：2024–25 水文年
        else S.range = { preset: rg };
      }
      if (Q.get('checked')) { const [sid, ps] = Q.get('checked').split(':'); S.checked.set(sid, new Set(ps.split(/[+ ~]/))); }   // URL 里的 + 会被解成空格
    };
    const openMenu = () => { if (Q.get('rangemenu')) menu.style('display', 'block'); };   // &rangemenu=1：截图用
    if (S.ready) { apply(); controls(); dim(); R.emit('sidebar'); openMenu(); }
    else { const iv = setInterval(() => { if (S.ready || S.failed) { clearInterval(iv); if (S.ready) { apply(); controls(); dim(); R.emit('sidebar'); openMenu(); } } }, 20); }
  });
})();
