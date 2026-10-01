/*
 * search.js — 「可以」档：按站号、站名搜索（impl-spec §11；D-44 的「存在等效控件」例外之一）
 *
 * 顶部栏右侧的输入框：输入站号前缀或站名的一部分，列出当前流域最多 8 个匹配的站；
 * 点结果或按 Enter 选第一个 → 加入卡片栈（与在画布上点站相同）；Esc 关闭列表。
 * 地图上重合、点不开的站可以由此加入栈。
 *
 * 作者标注：本文件由 Claude Code（M4，2026-09-24）编写，见 docs/plan.md §11。
 */
(function () {
  'use strict';
  const R = window.River;
  const T = R.T;
  const input = document.getElementById('search');
  const list = d3.select('#topbar .grp-search').append('div').attr('class', 'search-list').style('display', 'none');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let hits = [];

  function enable() {
    input.disabled = false;
    input.removeAttribute('title');
    input.setAttribute('placeholder', T.topSearch);
  }
  function find(q) {
    const d = R.state.d;
    q = q.trim().toLowerCase();
    if (!d || !q) return [];
    return d.stations.filter(s => s.id.startsWith(q) || (s.name || '').toLowerCase().includes(q) || (s.short_name || '').toLowerCase().includes(q))
      .sort((a, b) => (b.id.startsWith(q) - a.id.startsWith(q)) || a.id.localeCompare(b.id)).slice(0, 8);
  }
  function show() {
    hits = find(input.value);
    if (!input.value.trim()) { list.style('display', 'none'); return; }
    list.style('display', 'block').html(hits.length ? hits.map((s, i) => `<button data-i="${i}"><b>${esc(s.id)}</b> ${esc(s.short_name || s.name)}</button>`).join('')
      : `<div class="aux">${esc(T.searchNone)}</div>`);
  }
  function pick(s) {
    if (!s || R.state.busy) return;
    if (R.clearSel) R.clearSel();
    R.stack.add(s.id, {});
    list.style('display', 'none'); input.value = ''; input.blur();
  }
  input.addEventListener('input', show);
  input.addEventListener('keydown', ev => {
    if (ev.key === 'Enter') pick(hits[0]);
    else if (ev.key === 'Escape') { list.style('display', 'none'); input.blur(); ev.stopPropagation(); }
  });
  list.on('mousedown', ev => { const b = ev.target.closest('button[data-i]'); if (b) { ev.preventDefault(); pick(hits[+b.dataset.i]); } });
  input.addEventListener('blur', () => setTimeout(() => list.style('display', 'none'), 150));
  list.on('mouseover', ev => { const b = ev.target.closest('button[data-i]'); if (b && R.preview) R.preview('station:' + hits[+b.dataset.i].id); });
  list.on('mouseleave', () => R.preview && R.preview(null));
  R.on('build', () => { enable(); input.value = ''; list.style('display', 'none'); });
  R.on('layout', () => {                            // 调试参数：&search=文字
    const q = R.Q.get('search');
    if (q && !R._searchDone) { R._searchDone = true; input.value = q; show(); }
  });
})();
