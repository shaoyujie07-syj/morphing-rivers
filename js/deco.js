/*
 * deco.js — 「可以」档：地图视图的比例尺、指北针与数据署名（impl-spec §5.2、§4.7；D-38）
 *
 * 画布右上角的叠加层。静止时只在地图视图显示；形变中作为地图专属元素（D-52），与流域轮廓、背景河网、城镇
 * 同一段淡出淡入——不透明度取当前帧的 mapA（作者 10-01；原为形变一开始就瞬间隐藏）。比例尺按当前缩放取整
 * （1、2、5 × 10ⁿ km，长度 60–130 px）；指北针（北向上，EPSG:3111）；署名写数据源与许可。
 * 城镇（OpenStreetMap）未做：本地没有 OSM 数据。
 *
 * 作者标注：本文件由 Claude Code（M4，2026-09-24）编写，见 docs/plan.md §11。
 */
(function () {
  'use strict';
  const R = window.River;
  const T = R.T;
  const box = d3.select('#canvas').append('div').attr('id', 'mapdeco').style('display', 'none');

  const alpha = s => (s.busy ? (s.frame ? s.frame.mapA : 0) : (s.view === 'map' ? 1 : 0));
  let shown = null;                                               // 已画的内容（比例尺长度、文字），形变中每帧只改不透明度
  function update() {
    const s = R.state, d = s.d, a = d ? alpha(s) : 0;
    if (a <= 0) { box.style('display', 'none'); return; }
    const pxPerKm = d.basin.map_scale_px_per_km * s.fit.k;       // 数据坐标 px/km × 当前缩放
    let km = 1;
    for (const c of [1, 2, 5, 10, 20, 50, 100, 200]) { if (c * pxPerKm <= 130) km = c; }
    const w = km * pxPerKm;
    box.style('display', null).style('opacity', a < 1 ? a : null);
    const key = `${d.basin.id}|${km}|${w.toFixed(1)}`;
    if (key === shown) return;
    shown = key;
    box.html(`
      <svg width="150" height="46" class="deco-svg">
        <g transform="translate(128,4)"><path class="deco-n" d="M0,0L5,13L0,10L-5,13Z"/><text x="0" y="24" text-anchor="middle">N</text></g>
        <g transform="translate(4,36)"><rect class="deco-bar" x="0" y="0" width="${w.toFixed(1)}" height="4"/>
          <rect class="deco-bar2" x="0" y="0" width="${(w / 2).toFixed(1)}" height="4"/>
          <text x="0" y="-4">0</text><text x="${w.toFixed(1)}" y="-4" text-anchor="middle">${km} km</text></g>
      </svg>
      <div class="deco-attr">${T.attribution}</div>`);
  }
  R.on('layout', update);
  R.on('zoom', update);
  R.on('build', () => setTimeout(update, 0));
  R.on('draw', () => { if (R.state.busy) update(); });           // 形变中每帧：跟随 mapA
  R.deco = { update, box };
})();
