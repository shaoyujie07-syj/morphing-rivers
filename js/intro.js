/*
 * intro.js — 画布上常驻的说明块（作者 10-04，同行反馈 F1–F5）
 *
 * 内容：标题 Morphing Rivers（卡片标题字号加粗）与右上角的 Hide；两行说明（正体）；两条操作提示（斜体、次要文字色，
 * 与说明在排版上区分，反馈 F5；斜体灰字在全页都表示操作说明），两块之间一条浅色分隔线（界面约定：区块用分隔线分组）。
 * 宽 230 px，高随内容。分工（作者 10-04）：说明块回答「这是什么」，「怎么用」留给侧边栏空栈时的三条操作提示。
 * 外观与图例一致：半透明白底、同样的圆角与边框；收起后变成与图例同样的小标签，可再展开。收起状态不记忆（刷新即恢复展开）。
 *
 * 位置：与图例、小地图一起选（legend.js 的 arrange，作者 10-04）——不压站点、存根、坝标记，线可以压，取三块总代价最小的
 * 组合；说明块自己的角落顺序是左上、右上、左下、右下。只在载入流域、切换视图时选一次，缩放、平移不重算（D-59、D-60）。
 * 选位置时按说明块「展开时」的尺寸算，收起后仍贴在同一个角，展开收起不会让图例与小地图挪位。
 * 地图视图下右上角的比例尺、指北针与数据署名不可进入（署名是许可要求，不能被盖住），对三块都一样（fixedRects）。
 *
 * 调试参数（只供自检的反向对照）：&introCorner=tl|tr|bl|br（强制角落）
 *
 * 作者标注：本文件由 Claude Code（2026-10-04）编写，见 docs/plan.md §11。
 */
(function () {
  'use strict';
  const R = window.River;
  const T = R.T;
  const canvas = document.getElementById('canvas');
  const box = d3.select(canvas).append('div').attr('id', 'intro').attr('class', 'intro open');
  const I = { open: true, corner: null, key: null, full: null, rect: null, reserved: null };
  const ORDER = ['tl', 'tr', 'bl', 'br'];
  const PAD = 8;                                       // 不可进入区外扩（与小地图避开图例同一外扩）

  function render() {
    box.classed('open', I.open).classed('collapsed', !I.open);
    box.html(I.open
      ? `<div class="in-head"><b>${T.introTitle}</b><button class="in-hide" data-in="hide">${T.introHide}</button></div>
        <p class="in-desc">${T.introDesc}</p>
        <ul class="in-hints">${T.introHints.map(h => `<li>${h}</li>`).join('')}</ul>`
      : `<button class="lg-tag in-tag" data-in="open">${T.introTitle} ▸</button>`);
    const el = box.node();
    if (I.open) I.full = [el.offsetWidth, el.offsetHeight];   // 展开时的尺寸：收起后仍按它预留位置
  }

  // 地图视图右上角的比例尺、指北针与署名（deco.js：top 8、right 12；图形 150 × 46，署名一行）
  let attrW = null;
  function decoRect(view = R.state.view) {
    if (view !== 'map') return null;
    if (attrW === null) {
      const c = document.createElement('canvas').getContext('2d');
      c.font = `11px ${getComputedStyle(document.body).fontFamily}`;
      attrW = c.measureText(T.attribution).width + 4;
    }
    const cw = canvas.clientWidth, w = Math.max(150, attrW);
    return [cw - 12 - w, 8, cw - 12, 8 + 46 + 2 + 16];
  }
  const grow = r => [r[0] - PAD, r[1] - PAD, r[2] + PAD, r[3] + PAD];

  // 一起选位置时要的两样：展开时的尺寸、不可进入的固定区域（外扩 8 px）
  function size() { if (!I.full) render(); return I.full; }
  function fixedRects(view) { const d = decoRect(view); return d ? [grow(d)] : []; }
  // legend.js 一起选完后交回本块的位置：a = { id, v, slid, scores }；ob 为当时的障碍物
  function setPlace(a, ob) {
    I.corner = a.id; I.slid = a.slid; I.scores = a.scores;
    const forced = R.Q.get('introCorner');             // 调试（自检的反向对照）：&introCorner=tl|tr|bl|br 强制角落
    if (ORDER.includes(forced)) { I.corner = forced; I.slid = null; }
    I.reserved = R.corners.placeAt(I.corner, I.full[0], I.full[1]);
    apply(ob);
  }
  function apply(ob) {
    const el = box.node();
    const r = R.corners.placeAt(I.corner, el.offsetWidth, el.offsetHeight);
    I.rect = r;
    if (ob) I.overlapCats = R.corners.overlapCats(I.reserved, ob);
    box.style('left', r[0] + 'px').style('top', r[1] + 'px');
    document.body.dataset.intro = JSON.stringify({ open: I.open, corner: I.corner, slid: I.slid || null,
      rect: r.map(v => Math.round(v * 10) / 10), reserved: I.reserved.map(v => Math.round(v * 10) / 10), full: I.full,
      overlap_cats: I.overlapCats, scores: I.scores, deco: (r => r && r.map(v => Math.round(v * 10) / 10))(decoRect()),
      cw: canvas.clientWidth, ch: canvas.clientHeight });
  }

  box.on('click', ev => {
    const b = ev.target.closest('[data-in]');
    if (!b) return;
    I.open = b.dataset.in === 'open';
    render();
    if (I.corner) apply(null);                         // 只按原位置重新贴边，不重选，也不牵动图例与小地图
  });
  render();
  R.intro = { state: I, ORDER, size, fixedRects, setPlace, reserved: () => I.reserved && grow(I.reserved), decoRect: () => { const d = decoRect(); return d && grow(d); } };
})();
