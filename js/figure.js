/*
 * figure.js — T-17 论文插图：把画布导出为独立的矢量 SVG（只在 ?figure=1 时运行，不影响正常使用）
 *
 * 插图模式：隐藏顶部栏、侧边栏、图例、小地图与叠加层，画布固定为导出坐标的参考画布（W0 × H0，验收修订后 1280 × 900，四流域统一）；
 * 数据取 web/data_fig/（src/export_basin.py --row 44 --out web/data_fig：固定行距 44 px，不用自适应行距）。
 * 就绪后在 SVG 内加图题（流域、视图、方向说明）；地图另加比例尺、指北针与数据署名；
 * 把每个元素计算后的样式写成属性（脱离 CSS 仍能正确显示），序列化后放进 <textarea id="svgout">，
 * 由 tools/figures.py 读出写成 outputs/figures/*.svg。
 *
 * 作者标注：本文件由 Claude Code（M4 T-17，2026-09-24）编写，见 docs/plan.md §11。
 */
(function () {
  'use strict';
  const R = window.River;
  if (!R || !R.Q.get('figure')) return;
  document.body.classList.add('figure');
  const T = R.T;
  const PROPS = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin',
    'stroke-dasharray', 'opacity', 'font-size', 'font-family', 'font-weight', 'font-style', 'paint-order'];

  function caption(svg, d, view) {
    const g = svg.append('g').attr('class', 'fig-cap');
    const orient = d.basin.axis_direction.orient === 'h' ? T.figOrientH : T.figOrientV;
    const lines = view === 'map' ? [T.figTitle(d.basin.name, T.map), T.figMapNote]
      : [T.figTitle(d.basin.name, T.schematic), T.figSchNote(orient, R.state.d.basin.row_px, d.basin.outlet_to)];
    lines.forEach((t, i) => g.append('text').attr('x', 16).attr('y', 24 + i * 16).attr('class', i ? 'fig-sub' : 'fig-title').text(t));
  }
  function mapDeco(svg, d) {
    const pxPerKm = d.basin.map_scale_px_per_km * R.state.fit.k;
    let km = 1;
    for (const c of [1, 2, 5, 10, 20, 50, 100]) if (c * pxPerKm <= 130) km = c;
    const w = km * pxPerKm, x0 = R.W0 - 24 - 150, y0 = R.H0 - 40;
    const g = svg.append('g').attr('class', 'fig-deco');
    g.append('rect').attr('x', x0).attr('y', y0).attr('width', w).attr('height', 4).attr('fill', '#fff').attr('stroke', '#6B6A64').attr('stroke-width', 0.8);
    g.append('rect').attr('x', x0).attr('y', y0).attr('width', w / 2).attr('height', 4).attr('fill', '#6B6A64');
    g.append('text').attr('x', x0).attr('y', y0 - 4).text('0');
    g.append('text').attr('x', x0 + w).attr('y', y0 - 4).attr('text-anchor', 'middle').text(`${km} km`);
    g.append('path').attr('d', `M${R.W0 - 30},${y0 - 44}l5,13l-5,-3l-5,3Z`).attr('fill', '#6B6A64');
    g.append('text').attr('x', R.W0 - 30).attr('y', y0 - 20).attr('text-anchor', 'middle').text('N');
    g.append('text').attr('x', R.W0 - 24).attr('y', R.H0 - 14).attr('text-anchor', 'end').attr('class', 'fig-attr').text(T.attribution);
  }
  function serialize() {
    const d = R.state.d;
    const src = document.getElementById('svg');
    const view = R.Q.get('morph') ? 'morph' : R.state.view;
    const svg = d3.select(src);
    svg.selectAll('.fig-cap, .fig-deco').remove();
    if (view !== 'morph') caption(svg, d, view);
    if (view === 'map') mapDeco(svg, d);
    const clone = src.cloneNode(true);
    // 逐个元素写入计算后的样式；隐藏的（display:none）直接去掉
    const orig = src.querySelectorAll('*'), copy = clone.querySelectorAll('*');
    for (let i = orig.length - 1; i >= 0; i--) {
      const cs = getComputedStyle(orig[i]);
      if (cs.display === 'none' || orig[i].getAttribute('display') === 'none') { copy[i].remove(); continue; }
      for (const p of PROPS) {
        const v = cs.getPropertyValue(p);
        if (v && !(p === 'stroke-dasharray' && v === 'none')) copy[i].setAttribute(p, v);
      }
      copy[i].removeAttribute('class');
    }
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', R.W0); clone.setAttribute('height', R.H0); clone.setAttribute('viewBox', `0 0 ${R.W0} ${R.H0}`);
    clone.removeAttribute('style'); clone.removeAttribute('class'); clone.removeAttribute('id');
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bg.setAttribute('width', R.W0); bg.setAttribute('height', R.H0); bg.setAttribute('fill', '#ffffff');
    clone.insertBefore(bg, clone.firstChild);
    const ta = document.createElement('textarea');
    ta.id = 'svgout';
    ta.textContent = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);   // textContent：--dump-dom 才读得到
    document.body.appendChild(ta);
    document.body.dataset.figure = JSON.stringify({ basin: d.basin.id, view, row_px: d.basin.row_px, tracks: d.basin.tracks,
      canvas: [R.state.fit.cw, R.state.fit.ch], k: R.state.fit.k });
  }
  let done = false;
  R.on('layout', () => { if (!done) { done = true; setTimeout(serialize, 50); } });
  R.on('draw', () => { if (R.Q.get('morph') && !done) { done = true; setTimeout(serialize, 50); } });
})();
