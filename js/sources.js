/*
 * sources.js — T-14 数据来源与取舍（impl-spec §4.6、§4.7、§7；D-39、D-47、D-53）
 *
 * 侧边栏最底部，默认收起，点开后在本区内滚动：
 *   ① 各数据源与截取日期；② 站点取舍汇总「显示 n 个站，排除 m 个」，可展开看原因与清单（与 data/special_cases.csv 同一批数据）；
 *   ③ 人工整理说明（调节设施名单、位置人工核对）；④ 许可署名；⑤ 方法说明全部七条（三段式，§4.6）。
 * 界面不出现 snap 一词（§4.5）：「snap > 500 m」写成「离最近的河道超过 500 m」。
 *
 * 作者标注：本文件由 Claude Code（M4 T-14，2026-09-24）编写，见 docs/plan.md §11。
 */
(function () {
  'use strict';
  const R = window.River;
  const T = R.T;
  const box = document.getElementById('sources');
  const S = { open: false, sel: false, list: false, method: new Set() };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const EXCL = ['非 active（未导出）', '不在流域多边形内', '雨量站', 'snap > 500 m', '不在选站口径内', '位于次要出口'];

  function render() {
    const d = R.state.d;
    if (!d) return;
    const m = d.meta, b = d.basin;
    const nEx = EXCL.reduce((a, k) => a + (m.excluded[k] || 0), 0);
    const head = `<button class="src-h${S.open ? ' open' : ''}" data-src="open">${esc(T.srcTitle)} <span class="aux">${esc(T.srcSel(b.n_stations, nEx))}</span> ${S.open ? '▴' : '▾'}</button>`;
    if (!S.open) { box.innerHTML = head; return; }
    const src = m.sources.map(s => `<li class="kv"><span class="k">${esc(T.srcName(s.name))}</span><span class="v aux">${esc(s.by)} · ${esc(s.licence.split('；')[0])}</span></li>`).join('');
    const dates = Object.entries(m.snapshot_dates).map(([k, v]) => `<li class="kv aux"><span class="k">${esc(T.srcDateKey[k] || k)}</span><span class="v">${esc(v)}</span></li>`).join('');
    const reasons = EXCL.filter(k => m.excluded[k]).map(k => `<li class="kv aux"><span class="k">${esc(T.excl[k] || k)}</span><span class="v">${m.excluded[k]}</span></li>`).join('');
    const rows = m.special_cases.filter(r => r['类别'].startsWith('被排除') || r['类别'].startsWith('非 active'));
    const list = rows.map(r => `<li class="kv aux"><span class="k"><b>${esc(r['站号'])}</b> ${esc(r['站名'])}</span><span class="v">${esc(T.exclCat(r['类别']))}</span></li>`).join('');
    const nChecked = d.stations.filter(s => s.position_checked).length;
    const nUnver = d.facilities.filter(f => !f.verified).length;
    const methods = ['incr', 'share', 'coverage', 'position', 'layout', 'compression', 'rain', 'ers'].map(k =>
      `<li><button class="link" data-src="m" data-k="${k}">${esc(T.methodTitle[k])}</button>${S.method.has(k)
        ? `<div class="method">${T.method[k].map(p => `<p>${esc(typeof p === 'function' ? p(d) : p)}</p>`).join('')}</div>` : ''}</li>`).join('');
    box.innerHTML = head + `<div class="src-body">
      <div class="blk"><div class="fh">${esc(T.srcSources)}</div><ul class="klist">${src}</ul><ul class="klist">${dates}</ul></div>
      <div class="blk"><div class="fh">${esc(T.srcSelection)}</div>
        <div>${esc(T.srcSelLong(b.n_stations, nEx))} <button class="link" data-src="sel">${esc(S.sel ? T.srcHide : T.srcWhy)}</button></div>
        ${S.sel ? `<ul class="klist">${reasons}</ul><button class="link" data-src="list">${esc(S.list ? T.srcHideList : T.srcShowList(rows.length))}</button>
          ${S.list ? `<ul class="klist src-list">${list}</ul>` : ''}` : ''}</div>
      <div class="blk"><div class="fh">${esc(T.srcCuration)}</div><p class="aux">${esc(T.srcCurFac(d.facilities.length, nUnver))}</p>
        <p class="aux">${esc(T.srcCurPos(nChecked))}</p></div>
      <div class="blk"><div class="fh">${esc(T.srcLicence)}</div>${T.srcLicences.map(t => `<p class="aux">${esc(t)}</p>`).join('')}</div>
      <div class="blk"><div class="fh">${esc(T.srcMethods)}</div><ul class="mlist">${methods}</ul></div>
      <div class="blk src-hosting"><p class="aux">${esc(T.srcHosting[0])}</p>
        <p class="aux">${esc(T.srcHosting[1])}<br>${esc(T.srcRepoLabel)} <a href="https://${esc(T.srcRepo)}" target="_blank" rel="noopener">${esc(T.srcRepo)}</a></p></div>
    </div>`;
  }
  box.addEventListener('click', ev => {
    const el = ev.target.closest('[data-src]');
    if (!el) return;
    const a = el.dataset.src;
    if (a === 'open') S.open = !S.open;
    else if (a === 'sel') S.sel = !S.sel;
    else if (a === 'list') S.list = !S.list;
    else if (a === 'm') { const k = el.dataset.k; if (S.method.has(k)) S.method.delete(k); else S.method.add(k); }
    render();
  });
  R.on('build', () => setTimeout(render, 0));
  R.on('layout', () => {                            // 调试参数：&sources=open|sel|list
    const q = R.Q.get('sources');
    if (q && !S.debug) { S.debug = true; S.open = true; S.sel = q !== 'open'; S.list = q === 'list'; render(); }
  });
  R.sources = { render, state: S };
})();
