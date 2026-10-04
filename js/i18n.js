/*
 * i18n.js — 界面文字。托管版只保留英文：中文文案与 ?lang=zh 已移除（开发仓库仍保留中文版，供本地调试）
 *
 * 白话措辞按 impl-spec §4.5：面积一律写「集水面积」，不写「水量」；snap 一词不出现在界面上；
 * 按钮文字用英文（Upstream sites、Downstream to outlet、Clear、… added · Undo）。
 *
 * 作者标注：本文件由 Claude Code（M1 T-06，2026-09-23；M2 T-09–T-11，2026-09-24）编写，见 docs/plan.md §11。
 */
(function () {
  'use strict';
  const km = v => (v >= 100 ? Math.round(v) : v >= 10 ? v.toFixed(1) : v.toFixed(2)).toLocaleString('en-US');
  const km2 = v => v >= 100 ? Math.round(v).toLocaleString('en-US') : v >= 10 ? v.toFixed(1) : v.toFixed(2);
  const pct = s => (s * 100 >= 10 ? Math.round(s * 100) : (s * 100).toFixed(1)) + '%';
  const PARAM = {
    en: { turbidity: 'Turbidity', do_mgl: 'Dissolved oxygen', do_sat: 'DO saturation', tp: 'Total phosphorus',
      tn: 'Total nitrogen', ec: 'Conductivity', ph: 'pH', temp: 'Water temperature', flow: 'Flow',
      level: 'Water level', storage_level: 'Storage level' },
  };

  window.RIVER_TXT = {
    en: {
      title: 'River network schematic · monitoring sites', basinSelect: 'Basin',
      schematic: 'Schematic', map: 'Map', subtitle: 'Data: Geofabric V3.3 · WMIS · SILO · EPA ERS · GeoNames',
      viewHint: 'Switch views — the map morphs into the schematic',
      // ---- 画布上常驻的说明块（优先左上角；作者 10-04，反馈 F1–F5）：回答「这是什么」，两条读图前必须知道的事；
      //      「怎么用」（点站、点河道、Esc）留给侧边栏空栈时的操作提示，不在这里重复（作者 10-04）
      introTitle: 'Morphing Rivers', introHide: 'Hide',
      introDesc: "Victoria's river-monitoring networks as schematics — and as maps.",
      introHints: ['Schematic / Map switch views and start the morph', "The left dropdown chooses a basin (a river's catchment)"],
      outlet: to => `Outlet · flows into ${to}`, source: 'Upstream',
      summary: (n, x) => `${n} active monitoring sites shown. ${x}% of the catchment has no active monitoring site.`,
      note: 'Discontinued sites are not counted.',
      km, km2, pct, param: k => PARAM.en[k] || k,
      unnamed: 'Unnamed tributary', unnamedA: a => `Unnamed tributary (${km2(a)} km²)`,
      tipToOutlet: v => `${km(v)} km to the outlet`,
      tipMeasures: ps => `Measures: ${ps.join(', ')}`,
      tipRegistered: ps => `Registered: ${ps.join(', ')} (no time series in this version)`,
      tipNoParams: 'No time series in this version',
      tipInRes: n => `Inside ${n}`,
      tipPosChecked: note => `Location checked by hand${note ? ': ' + note : ''}`,
      tipPosAuto: m => `Location not checked by hand (${Math.round(m)} m from the registered point to the river)`,
      tipMore: n => `${n} more site${n > 1 ? 's' : ''} at this spot; each can be picked in the schematic`,
      tipEdge: (river, up, down, d) => `${river} · ${up} → ${down} · ${km(d)} km`,
      outletWord: 'outlet',
      facType: { storage: 'Storage', weir: 'Weir' },
      tipOperator: o => `Operator: ${o || 'not recorded'}`,
      tipFacSites: (u, i, dn) => `Sites: ${u} upstream · ${i} in storage · ${dn} downstream`,
      tipStub: 'Tributary with no monitoring site of its own',
      tipArea: a => `Land draining here: ${km2(a)} km²`,
      tipShare: (n, s) => `${n} comprises ${pct(s)} of the catchment area below this junction`,
      tipStubFlag: 'Regulating structure upstream',
      tipConf: (trib, into) => `${trib} joins ${into}`,
      tipOutlet: to => `Outlet · flows into ${to}`,
      tipOutflow: to => `Natural outflow: some water leaves here towards ${to || 'another channel'} (share not given)`,
    },
  };

  // ---------------------------------------------------------------- T-10 卡片栈、T-11 空栈与图例
  const PABBR = {
    en: { turbidity: 'Turb', do_mgl: 'DO', do_sat: 'DO%', tp: 'TP', tn: 'TN', ec: 'EC', ph: 'pH', temp: 'Temp',
      flow: 'Flow', level: 'Level', storage_level: 'Storage' },
  };
  Object.assign(window.RIVER_TXT.en, {
    pabbr: k => PABBR.en[k] || k,
    stackTitle: (b, n) => n ? `${b} · ${n} site${n > 1 ? 's' : ''} in stack` : b,
    sumInRes: r => `Inside ${r}: storage water, not directly comparable with river sites.`,
    sumSameReach: up => `On the same reach as the upstream site ${up}.`,
    sumBelowFac: (d, f) => `${km(d)} km below ${f}`,
    sumFacOther: (f, d, r) => `${f} is ${km(d)} km upstream, on ${r}`,
    upperReach: n => `${n} (upper reach)`,
    sumBelowSite: (d, s) => `${km(d)} km below site ${s}`,
    sumMore: (a, n) => `${km2(a)} km² more land than the upstream site${n > 1 ? 's' : ''}`,
    sumLeaf: (r, a) => `Top site on ${r}; ${km2(a)} km² of land drains here`,
    sumJoin: (a, b) => `${a}; ${b}.`,
    overstate: 'Upstream structure or outflow: area may overstate the water.',   // 作者 09-30 侧边栏高度：压成一行
    netLabArea: 'Drains here', netLabNew: 'New since upstream', netLabUp: 'Nearest site up',
    netArea: a => `${km2(a)} km²`, netNew: a => `+${km2(a)} km²`, netUp: (s, d) => `${s} · ${km(d)} km`,
    netTop: 'none (top site)',
    fInflow: 'Flows via',
    fOutletWord: 'outlet',
    fNearest: 'Nearest junction upstream',
    fNearestTxt: (n, d, s) => `${n} joins ${km(d)} km upstream and comprises ${pct(s)} of the catchment area below this junction`,
    fNearestNone: 'No drawn tributary joins between this site and the upstream site',
    fBetween: 'New land since the upstream site',
    fBetweenOutlet: d => `Between this site and the outlet (${km(d)} km)`,
    fRestK: n => `${n} smaller tributar${n > 1 ? 'ies' : 'y'}`, fLocalK: 'Land draining straight to the river',
    a2: a => `${km2(a)} km²`, d2: d => `${km(d)} km`,
    fNoStubs: 'Tributaries with no monitoring site: none',
    fFacs: 'Nearest regulating structures',
    fFacUpK: n => `Upstream · ${n}`, fFacDownK: n => `Downstream · ${n}`, fFacIn: n => `Inside ${n}`,
    fFacNone: 'No drawn regulating structure upstream or downstream',
    btnUp: 'Upstream sites', btnDown: 'Downstream to outlet', btnClear: 'Clear',
    added: n => `${n} site${n > 1 ? 's' : ''} added · `, undo: 'Undo',
    full: n => `The stack is full (${n} sites). Remove a site before adding another.`,
    over: (n, m) => `That would add ${n} sites, over the limit of 10.`,
    addNearest: m => `Add the nearest ${m}`, cancel: 'Cancel',
    none: 'No sites to add (all already in the stack, or none in that direction).',
    infoSame: 'Same reach: no new land between the two sites',
    infoOther: n => `Another tributary · ${n}`,
    infoJoins: id => ` (joins ${id} below)`,
    infoDist: d => `${km(d)} km`,
    infoTribs: (names, n, a) => names ? `${names}${n ? ` and ${n} small tributar${n > 1 ? 'ies' : 'y'}` : ''} join (${km2(a)} km²)`
      : `${n} small tributar${n > 1 ? 'ies' : 'y'} join (${km2(a)} km²)`,
    infoFacs: ns => `passes ${ns}`,
    infoOut: to => `outflow to ${to}`,
    facTemp: 'temporary',
    facUse: u => `Use: ${u || 'not recorded'}`,
    facTabs: { up: 'Upstream', in: 'In storage', down: 'Downstream' },
    facAll: n => `Show all (${n})`,
    facNone: 'None',
    facBelow: (s, d) => `Nearest site below the dam: ${s} (${km(d)} km)`,
    methodTitle: { incr: 'New land since the upstream site', share: 'Share of the catchment area below a junction',
      coverage: 'How much land has no monitoring of its own' },
    method: {
      incr: ['How: the land draining to this site, minus the land draining to the sites immediately upstream. Two neighbouring sites on the same reach have no new land between them (0).',
        'What it is: the land added between the sites, called incremental catchment area. It shows how much land drains in between; it is a spatial stand-in for local inflow, not a measured amount of water. With a regulating structure, diversion or outflow upstream, the area may overstate the actual water.',
        'Data: Geofabric V3.3 surface network, catchment area field (UpstrDArea; BoM, CC BY 4.0); site locations from the WMIS site list, 2026-09-20.'],
      share: ['How: the land draining to this tributary at the junction, divided by the total land just below the junction (the sum over all rivers flowing into it).',
        'What it is: called the confluence ratio. It is a ratio of land area, not of flow; the two can differ a lot where storages regulate either river. The same ratio is used for tributaries with and without a monitoring site.',
        'Data: Geofabric V3.3 surface network (BoM, CC BY 4.0).'],
      coverage: ['How: add up the land of tributaries that have no monitoring site of their own, and divide by the land draining to the outlet; discontinued sites are not counted. Two groups of tributaries count: those joining between two sites, and those joining between the lowest site and the outlet. Shown as “X% of the catchment has no active monitoring site”.',
        'What it is: expressed technically as coverage (= 1 − that share). Tributaries joining between the lowest site and the outlet are often the largest. Only tributaries without their own site are counted; land draining straight to the river is not, and land above the top site is monitored by that site.',
        'Data: Geofabric V3.3 (BoM, CC BY 4.0); WMIS site list, active sites only, 2026-09-20.'],
    },
    emptyCount: (n, x) => `${n} active monitoring sites shown. ${x}% of the catchment has no active monitoring site.`,
    tips: ['Click a site to add it to the card stack', 'Click a river or tributary tick for a summary (not added to the stack)',
      'Hover for names and numbers; Esc clears the highlight'],
    tipMap: 'Hover a pale river for its name; the schematic shows the structure',
    covDetail: 'Coverage detail: the 5 largest tributaries with no monitoring site (area · share of catchment)',
    covArea: (a, s) => `${km2(a)} km² · ${pct(s)}`,
    multiOutlet: n => `Parts flowing to other outlets are not shown; ${n} sites are left out.`,
    legend: 'Legend', legendClose: 'Hide',
    lgStation: 'Monitoring site', lgStBy: ' (by selected parameter)', lgWq: 'measures this parameter', lgFlow: 'flow or level only', lgFaded: 'does not measure it',
    lgRiver: 'Line width = order of magnitude of catchment area, not a proportion',
    lgStorage: 'Storage (reservoir)', lgWeir: 'Weir',
    lgStub: 'Tributary with no monitoring site', lgStubW: 'Width as for rivers: order of magnitude of catchment area', lgMore: 'More symbols', lgLess: 'Fewer symbols',
    lgOutflow: 'Natural outflow', lgOutlet: 'Outlet', lgFlowDir: 'Flow direction', lgFlag: 'Regulating structure up this tributary',
    lgInStack: 'In the card stack',
    lgMapOutline: 'Catchment boundary', lgMapWater: 'Water body', lgMapBg: 'Other rivers (hover for names)',
    lgRatio: 'Junction share symbols (wedge = the share of the catchment area below the junction that the tributary comprises)', lgRatioShort: 'Junction share',
    lgFlagShort: 'Unmonitored tributary with a dam or weir upstream', searchNone: 'No matching site',
    attribution: 'Geofabric V3.3 © BoM · WMIS © DEECA · SILO © Qld · CC BY 4.0 · Towns: GeoNames, CC BY',
    figTitle: (b, v) => `${b} — ${v}`, figOrientH: 'long axis horizontal', figOrientV: 'long axis vertical',
    figSchNote: (o, row, to) => `Schematic, ${o}; main river by true channel distance, tracks ${Math.round(row)} px apart; outlet flows into ${to}`,
    figMapNote: 'Map view, north up, EPSG:3111; line width = schematic width × 0.7',
    topParam: 'Parameter', topRange: 'Time range', topRangeVal: 'Last year', topSearch: 'Search site name or number',
    topLater: 'Loading time series…', topSearchLater: 'Search is an optional feature, not built yet',
  });

  // ---------------------------------------------------------------- M3 时间序列、降雨、参数与时间范围
  Object.assign(window.RIVER_TXT.en, {
    tsLoading: 'Loading time series…', noTs: 'This version has no time series data.',
    tsRain: 'Rainfall', tsNoneInWindow: 'No data in this window', tsNoParam: p => `${p} not measured here`,
    tsMeth: (p, d, s) => `${p}: ` + [d != null ? `${d} daily means` : null, s != null ? `${s} grab samples` : null].filter(Boolean).join(' + '),
    tsMethFlow: (p, d, s) => `${p}: ` + [d ? 'daily means' : null, s ? 'at sampling' : null].filter(Boolean).join(' + '),
    tsRainNote: 'Rain: catchment average (SILO)',
    tsRainSpan: (a, b) => `24 h from ${a} to ${b} (AEST) · upstream catchment average`,
    tsRainSpanIv: (a, b) => `24 h from ${a} to ${b} (AEST) · average over the land added between the sites`,
    tsRainCaveat: 'Catchment average; rainfall varies with terrain, so the amount at the site itself may be noticeably lower or higher',
    tsRainCaveatIv: 'Average over the section; rainfall varies with terrain, so the amount at a site may be noticeably lower or higher',
    tsDayMean: d => `Daily mean, ${d}`, tsSampleAt: t => `Sampled ${t}`, tsQuality: q => `Quality code ${q}`,
    rangeName: { '1m': 'Last month', '3m': 'Last quarter', '1y': 'Last year', '5y': 'Last 5 years', all: 'All records' },
    rangeCustom: 'Custom', rangeReset: 'Reset',
    sparseHead: n => n ? `Only ${n} point${n > 1 ? 's' : ''} in this window` : 'No data in this window',
    sparseFive: (s, d) => [s ? `${s} sample${s > 1 ? 's' : ''}` : '', d ? `${d} daily mean${d > 1 ? 's' : ''}` : ''].filter(Boolean).join(' and ') + ' in the last 5 years',
    sparseShow: 'show 5 years', sparseNone: 'none in the last 5 years',
    // 「water year」不再出现在界面上（作者 10-04，反馈 F6：这个词看不懂）；口径写在分组标题的括号里
    rangeYear: y => `${y}–${String(y + 1).slice(2)}`, rangeYearBtn: y => `Year ${y}–${String(y + 1).slice(2)}`, rangeYearHead: 'Choose a year (Jul–Jun)',
    rangeDatesHead: 'Custom dates', rangeApply: 'Apply',
    rangeAllNote: 'All records: grab samples go back to their first record; continuous series cover the last 10 years. Drag across any chart for a custom range; double-click to reset.',
    fOtherP: 'Other parameters (this card only)', fQc: p => `Quality codes for ${p} in this window (count)`,
    stackNoParam: (n, p) => `${n} site${n > 1 ? 's' : ''} in the stack ${n > 1 ? 'have' : 'has'} no ${p} data (faded)`,
    navSkipped: (n, p) => `${n} site${n > 1 ? 's' : ''} without ${p} data skipped`,
    tipLatest: (p, v, u, when) => `Latest ${p}: ${v} ${u} (${when})`,
    infoRain: (mx, small, n) => `Daily rainfall on the land added between the two sites (${n > 1 ? `${n} sections combined by area, ` : ''}max ${mx} mm)` + (small ? '; small area estimated from 1–2 grid cells' : ''),
    infoSmall: 'small area, 1–2 grid cells',
  });

  // ---------------------------------------------------------------- M4 T-14 数据来源与取舍；方法说明其余四条（待作者审）
  Object.assign(window.RIVER_TXT.en.methodTitle, { position: 'Site locations', layout: 'Sides and layout', compression: 'Tributary lengths', rain: 'Rainfall between sites' });
  Object.assign(window.RIVER_TXT.en.method, {
    position: ['How: each WMIS registered site is placed on the nearest river reach; sites more than 500 m from any river line are not shown. Coordinates are all used as WGS84. The datum labels recorded in WMIS are unreliable, and converting by label would misplace some sites, so no conversion is made.',
      'What it is: the position on the map is where the site was placed on the river, not its exact location; the distance from the registered point to the river is in each site\'s tooltip. Sites checked by hand and moved to the right reach say so in the tooltip. For a few sites, an older datum may add about 200 m of error.',
      'Data: WMIS site list (DEECA, 2026-09-20); Geofabric V3.3 surface network.'],
    layout: ['How: the main river runs end to end by true channel distance to the outlet; each tributary is drawn on the side it lies on geographically, keeping only its upstream-to-downstream order; lines never overlap or cross; neighbouring sites keep at least one site-width apart.',
      d => `What it is: the schematic is not to scale. To keep every site visible, sites may be pushed along their line, here by up to ${d.basin.layout_metrics.max_shift_km.toFixed(1)} km. Pushing happens mostly where sites are dense, such as several sites on one reach or sites clustered near a weir or dam. The upstream-to-downstream order never changes, and overall positions stay close to true distance; read channel distances from tooltips and cards.`,
      'Data: Geofabric V3.3 surface network.'],
    compression: ['How: tributary lengths are not compressed in this version; sites on tributaries are also placed by true channel distance to the junction, pushed only to avoid overlaps.',
      'What it is: all four basins fit within the track limit, so no compression was needed; if lengths were ever compressed, the legend would say “tributary lengths not to scale”.',
      'Data: Geofabric V3.3 surface network.'],
    rain: ['How: SILO daily gridded rainfall (0.05°, about 5 km), averaged with each cell weighted by its area inside the region. The rainfall in a card averages all the land draining to that site; the small bars between two sites average the land added between them; when the two sites are not neighbours, the sections in between are combined, weighted by area.',
      'What it is: rainfall only; no runoff or water volume is derived. The chart shows an average over the section (or the upstream catchment), not the rainfall at the site. A SILO daily value is the 24 hours to 9 am that day and is drawn over those 24 hours.',
      'Grid values are interpolated from rain gauge measurements across the region; they are not measurements made in the area itself. Rainfall varies with terrain, so the amount at a site may be noticeably lower or higher. Checked against 5 WMIS rain gauges in Goulburn sections: for 4 of them the section average was 1.14–1.41 times the gauge record, and all of them sit in the driest corner of their section. Small regions estimated from one or two grid cells are less reliable and are marked.',
      'Data: SILO daily gridded rainfall (Queensland Government, CC BY 4.0), 2016-09-22 to 2026-09-23; checked against 5 WMIS rain gauges over the same period.'],
  });
  Object.assign(window.RIVER_TXT.en, {
    srcTitle: 'Data sources & site selection', srcSel: (n, m) => `${n} shown · ${m} left out`,
    srcSources: 'Sources', srcSelection: 'Site selection', srcCuration: 'Curated by hand', srcLicence: 'Licences and attribution',
    srcMethods: 'How the numbers are made (8 notes)',
    srcName: n => ({ 'Geofabric V3.3 地表水河网': 'Geofabric V3.3 surface network', 'WMIS 站点清单（snap 到河网）': 'WMIS site list (placed on the river network)',
      'WMIS 时间序列': 'WMIS time series', 'SILO 逐日格网降雨': 'SILO daily gridded rainfall',
      'EPA ERS 水体分段与目标值': 'EPA ERS water segments and objectives', 'GeoNames 地名（城镇）': 'GeoNames place names (towns)',
      '墨尔本城市增长边界': 'Melbourne urban growth boundary' }[n] || n),
    srcDateKey: { geofabric: 'River network', stations_snap: 'Site locations', timeseries: 'Time series downloaded', rainfall: 'Rainfall' },
    srcSelLong: (n, m) => `${n} active monitoring sites are shown; ${m} sites are left out.`,
    srcWhy: 'Why?', srcHide: 'Hide', srcShowList: n => `List all ${n}`, srcHideList: 'Hide list',
    excl: { '非 active（未导出）': 'Discontinued (not shown)', '不在流域多边形内': 'Outside the catchment boundary', '雨量站': 'Rain gauge only',
      'snap > 500 m': 'More than 500 m from any river line', '不在选站口径内': 'Registered to another basin', '位于次要出口': 'On a secondary outlet' },
    exclCat: c => { const k = c.replace(/^被排除·/, ''); return ({ '非 active（未导出）': 'Discontinued', '不在流域多边形内': 'Outside boundary', '雨量站': 'Rain gauge only',
      'snap > 500 m': '> 500 m from river', '不在选站口径内': 'Other basin', '位于次要出口': 'Secondary outlet' }[k] || k); },
    srcCurFac: (n, u) => `Regulating structures: ${n} drawn, taken from Geofabric water bodies; ${u} not yet checked against the DEECA storage list.`,
    srcCurPos: n => n ? `Site locations: ${n} checked by hand.` : 'Site locations: none checked by hand yet.',
    srcLicences: ['Geofabric V3.3 © Bureau of Meteorology, CC BY 4.0.',
      'WMIS site list and time series © State of Victoria (DEECA), CC BY 4.0; records supplied by other agencies (quality code 65) are not covered.',
      'SILO gridded rainfall © State of Queensland, CC BY 4.0.',
      'ERS water segments © EPA Victoria, CC BY 4.0; objectives from Victoria Government Gazette S 245 (2021), Table 5.8.',
      'Melbourne urban growth boundary © State of Victoria (Vicmap Planning), CC BY 4.0; used only to decide the ERS urban segment.',
      'Town names and locations: GeoNames, CC BY.'],
    // 托管版署名与声明（hosting-credits.md 第二节英文两段，照原文）；第二段末行的仓库地址在 sources.js 里做成链接
    srcHosting: ["This prototype was built for a Master's minor thesis and is not an operational tool. Values shown are derived for research purposes and should not be used for water management decisions.",
      'Some WMIS records are supplied by partner organisations rather than by DEECA (quality code 65) and are reproduced here for research with attribution.'],
    srcRepoLabel: 'Source code and full credits:', srcRepo: 'github.com/shaoyujie07-syj/morphing-rivers',
  });
  // ---------------------------------------------------------------- M3+M4 增补：ERS 目标线（D-40、D-47）与地图城镇（D-38）
  const fg = v => d3.format('~g')(+(+v).toPrecision(3));
  const STAT = { en: { p75: '75th percentile', p25: '25th percentile', max: 'maximum' } };
  const OP = { le: '≤', ge: '≥' };
  Object.assign(window.RIVER_TXT.en, {
    ersNone: (E, p) => {
      const e = E.e || {};
      if (E.cat === 'param') return E.why === 'do_unit' ? 'ERS dissolved-oxygen objectives are in % saturation; no line for this parameter' : `ERS has no objective for ${p}`;
      if (E.cat === 'not_applicable') return E.why === 'non_natural'
        ? `Not applicable: ${({ channel: 'this site is on an artificial channel', drain: 'this site is on a drain', pipe: 'this site is on a pipe' })[e.kind] || 'checked by hand, this site is not on a natural watercourse'}; ERS river objectives do not apply`
        : 'Not applicable: ERS has separate objectives for lakes and storages; not shown here';
      if (E.cat === 'not_listed') return 'Not covered: ERS lists no objectives for this basin' + (E.why === 'broken_lowlands' ? ' (Broken basin lowlands)' : '');
      if (E.why === 'segment_boundary') return `Undetermined: within 500 m of the ERS ${e.other_segment} segment, so which objectives apply is unclear; no line drawn`;
      if (E.why === 'elev_200') return `Undetermined: elevation ${Math.round(e.elev_m)} m is close to the 200 m ERS uses to split uplands and lowlands; no line drawn`;
      if (E.why === 'ugb_boundary') return 'Undetermined: within 500 m of the Melbourne urban growth boundary, so whether urban objectives apply is unclear; no line drawn';
      return 'Undetermined: which ERS objectives apply is unclear; no line drawn';
    },
    ersLine: (p, seg, T_, u, st) => `ERS objective · ${p} · ${seg}: ` + T_.map(t => `${STAT.en[t.stat]} ${OP[t.op]} ${fg(t.v)}`).join(', ') + ` ${u}; `
      + (st.why === 'short' ? 'window shorter than a year, no percentile computed'
        : st.why === 'few' ? `only ${st.n} data points in ${st.wy != null ? `year ${st.wy}–${String(st.wy + 1).slice(2)}` : 'the last 12 months of the window'} (fewer than 11), not computed`
          : (st.wy != null ? `year ${st.wy}–${String(st.wy + 1).slice(2)}: ` : 'last 12 months of the window: ') + st.res.map(r => `${STAT.en[r.stat]} ${fg(r.x)}`).join(', ') + ` (n = ${st.n}, ${st.src === 'sample' ? 'grab samples' : 'daily means'})`),
    ersTitle: (seg, region) => `ERS = Victoria's Environment Reference Standard (2021). Segment: ${seg}; applies to: ${region}. Statistics only; no pass/fail judgement.`,
    lgMapTown: 'Town (GeoNames)',
    netClosed: 'Network position and details',
    tmpStubType: 'tributary with no monitoring site', tmpEdgeType: 'river between two sites',
    tmpArea: 'Catchment area', tmpAreaShare: (a, sh) => `${km2(a)} km² · comprises ${pct(sh)} of the catchment area below this junction`,
    tmpFacUp: 'Regulating structure upstream', tmpFacUpYes: 'yes',
    tmpWhere: 'Joins', tmpBetween: (u, d) => `between ${u} and ${d}`, tmpBetweenOutlet: u => `between ${u} and the outlet`,
    tmpOpen: s => `Open the card for ${s}`,
    tmpUp: 'Upstream site', tmpDown: 'Downstream site', tmpDist: 'Channel distance',
    tmpJoins: n => `${n} tributar${n === 1 ? 'y joins' : 'ies join'} on the way`, tmpFacs: 'Passes regulating structures',
    tmpEdgeTitle: (u, d) => `${u} → ${d}`, tmpEdgeTitleOut: u => `${u} → outlet`,
  });
  // ---------------------------------------------------------------- 方法说明第八条：ERS 目标线（作者 09-30：自定的两个判据必须写明）
  Object.assign(window.RIVER_TXT.en.methodTitle, { ers: 'ERS objective lines' });
  Object.assign(window.RIVER_TXT.en.method, {
    ers: ['How: the site is first matched to the ERS segment it falls in (EPA segment map, 2020); the row of objectives is then chosen by the basin the site is registered to. '
      + 'In the Werribee foothills, ERS splits uplands and lowlands at 200 m elevation (site elevation from WMIS); tributaries of the Yarra and Werribee inside '
      + 'Melbourne\u2019s urban growth boundary use the urban objectives. Statistics use the last 12 months of the current window (the whole July–June year when one is selected), at least 11 data points, '
      + 'with the percentile ERS specifies.',
      'What it is: the line is a reference only; this chart makes no pass/fail judgement.',
      'Three criteria are our own, not ERS rules: the Melbourne urban growth boundary is used to delimit the urban segment (ERS does not specify which boundary to use); and a site less than 500 m from a '
      + 'segment boundary or the urban growth boundary (the largest distance allowed when placing sites on rivers), or within 25 m of 200 m elevation, is treated '
      + 'as undetermined and gets no line. Reservoir head gauges, and sites not on a natural watercourse (named as a channel, drain or pipe, or so judged by hand), are not given river objectives, because ERS river objectives assume a natural channel; ERS lists no objectives '
      + 'for the Broken basin lowlands.',
      'Data: EPA Victoria ERS water segments (2020, CC BY 4.0) and the ERS itself (Victoria Government Gazette S 245, 2021, Table 5.8); Melbourne urban growth '
      + 'boundary (Vicmap Planning, CC BY 4.0); WMIS registered site elevations.'],
  });
})();
