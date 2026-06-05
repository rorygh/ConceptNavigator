'use strict';

// ═══════════════════════════════════════════════════════════════
// CANVAS + DIMENSIONS
// ═══════════════════════════════════════════════════════════════

const canvas = document.getElementById('canvas');
const ctx    = canvas.getContext('2d');
let W = 0, H = 0;

function resize() {
  W = canvas.width  = window.innerWidth;
  H = canvas.height = window.innerHeight;
}
resize();
window.addEventListener('resize', () => { resize(); if (VIEW === 'GALAXY') startGalaxy(); });


// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════

let VIEW     = 'GALAXY';   // GALAXY | SEARCH | SELECTED
let nodes    = [];
let edges    = [];
let nodeById = {};
let courseDetails = {};

let selected     = null;
let hovered      = null;
let searchScores = {};
let prereqDepths = new Map();   // id → depth (0=selected, 1=direct prereq, …)
let selSuccIds   = new Set();
let selRelEdges  = [];

let searchQuery     = '';
let searchQueryNode = null;     // virtual X node pinned at center in SEARCH view
let searchEdges     = [];       // virtual edges: queryNode → matched courses
let searchHitIds    = new Set(); // top-N course IDs that get labels + edges in SEARCH
let searchHitRanks  = new Map(); // id → rank (0 = best match) for sizing
let filterHitIds    = new Set(); // filter-mode matches — overlaid on any view
let activeFilters   = null;     // current Filters dict when filter mode is active
let searchTopics    = [];       // LLM-extracted topics from the last search

let T   = d3.zoomIdentity;
let sim = null;

const simCache = {}; // course id → similar dict (null while in-flight)
let qt  = null;


// ═══════════════════════════════════════════════════════════════
// COLOR SYSTEM
// ═══════════════════════════════════════════════════════════════

const deptScale = d3.scaleOrdinal(d3.schemeTableau10);

const COLOR_MODES = {
  department: n => deptScale(n.dept),
  level:      n => ({ U: '#3b82f6', G: '#8b5cf6' }[n.level] ?? '#94a3b8'),
  units:      n => d3.interpolateYlOrRd(Math.min(n.units || 9, 24) / 24),
};
let colorMode = 'department';

function baseColor(n) {
  return COLOR_MODES[colorMode]?.(n) ?? '#94a3b8';
}

function ghostColor(n) {
  const c = d3.hsl(baseColor(n));
  c.s = c.s * 0.3;
  c.l = Math.min(c.l + 0.12, 0.82);
  return c + '';
}

function nodeColor(n) {
  if (VIEW === 'SELECTED') {
    const d = prereqDepths.get(n.id);
    if (d === 0) return '#2563eb';
    if (d !== undefined) return PREREQ_COLORS[Math.min(d - 1, PREREQ_COLORS.length - 1)];
    if (selSuccIds.has(n.id)) return '#d97706';
    if (filterHitIds.size > 0) return filterHitIds.has(n.id) ? baseColor(n) : ghostColor(n);
    return ghostColor(n);
  }
  if (filterHitIds.size > 0) {
    return filterHitIds.has(n.id) ? baseColor(n) : ghostColor(n);
  }
  if (VIEW === 'SEARCH') {
    return searchHitIds.has(n.id) ? baseColor(n) : ghostColor(n);
  }
  return baseColor(n);
}


// ═══════════════════════════════════════════════════════════════
// ZOOM / PAN
// ═══════════════════════════════════════════════════════════════

const zoomBehavior = d3.zoom()
  .scaleExtent([0.04, 14])
  .on('zoom', ev => { T = ev.transform; draw(); });

d3.select(canvas).call(zoomBehavior).on('dblclick.zoom', null);


// ═══════════════════════════════════════════════════════════════
// SIMULATION HELPERS
// ═══════════════════════════════════════════════════════════════

function stopSim() { if (sim) { sim.stop(); sim = null; } }

function updateQt() {
  qt = d3.quadtree().x(d => d.x).y(d => d.y).addAll(nodes);
}

function tick() { updateQt(); draw(); }

function resetZoom() {
  d3.select(canvas).transition().duration(650)
    .call(zoomBehavior.transform, d3.zoomIdentity);
}

function buildPrereqDepths(rootId, maxDepth = Infinity) {
  const depths = new Map();
  const queue  = [[rootId, 0]];
  while (queue.length) {
    const [id, d] = queue.shift();
    if (depths.has(id)) continue;
    depths.set(id, d);
    if (d < maxDepth) {
      edges.forEach(e => {
        if (e.target.id === id && !depths.has(e.source.id))
          queue.push([e.source.id, d + 1]);
      });
    }
  }
  return depths;
}


// ═══════════════════════════════════════════════════════════════
// VIEW: GALAXY
// ═══════════════════════════════════════════════════════════════

function deptCentroids() {
  const depts = [...new Set(nodes.map(n => n.dept))].sort();
  const cx = W / 2, cy = H / 2, r = Math.min(W, H) * 0.3;
  const out = {};
  depts.forEach((d, i) => {
    const a = (i / depts.length) * 2 * Math.PI - Math.PI / 2;
    out[d] = { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });
  return out;
}

function startGalaxy() {
  VIEW = 'GALAXY';
  selected = null; searchScores = {}; searchHitIds = new Set(); searchHitRanks = new Map();
  filterHitIds = new Set();
  activeFilters = null;
  prereqDepths = new Map(); selSuccIds = new Set(); selRelEdges = [];
  searchQuery = ''; searchQueryNode = null; searchEdges = [];
  nodes.forEach(n => { n.fx = null; n.fy = null; });

  const c = deptCentroids();
  stopSim();
  sim = d3.forceSimulation(nodes)
    .force('x',      d3.forceX(n => c[n.dept]?.x ?? W/2).strength(0.07))
    .force('y',      d3.forceY(n => c[n.dept]?.y ?? H/2).strength(0.07))
    .force('charge', d3.forceManyBody().strength(-2).distanceMax(80))
    .force('coll',   d3.forceCollide(3.5).strength(0.6))
    .alphaDecay(0.025)
    .on('tick', tick);

  searchTopics = [];
  setHint(null);
  intentTagsEl.innerHTML = '';
  filterPanelEl.hidden = true;
  document.getElementById('detail').classList.remove('open');
}


// ═══════════════════════════════════════════════════════════════
// VIEW: SEARCH — X marker at centre, matched courses radiate out
// ═══════════════════════════════════════════════════════════════

function startSearch(results, allScores, query, intent = null) {
  VIEW = 'SEARCH';
  selected = null;
  prereqDepths = new Map(); selSuccIds = new Set(); selRelEdges = [];

  searchQuery  = query;
  searchScores = allScores;

  searchHitIds   = new Set(results.map(c => c.id));
  searchHitRanks = new Map(results.map((c, i) => [c.id, i]));

  searchQueryNode = { id: '__query__', x: W/2, y: H/2, fx: W/2, fy: H/2 };

  searchEdges = results
    .map(c => ({ source: searchQueryNode, target: nodeById[c.id] }))
    .filter(e => e.target);

  nodes.forEach(n => { n.fx = null; n.fy = null; });
  resetZoom();

  const outerR = Math.min(W, H) * 0.46;
  const djb2 = n => { let h = 5381; for (let i = 0; i < n.id.length; i++) h = ((h << 5) + h + n.id.charCodeAt(i)) | 0; return h; };

  const ringR = n => {
    const rank = searchHitRanks.get(n.id);
    if (rank !== undefined) {
      const base = 60 + (rank / Math.max(1, results.length - 1)) * 180;
      return Math.max(30, base + ((djb2(n) & 0xff) / 127.5 - 1) * 15);
    }
    return Math.max(outerR * 0.85, outerR + ((djb2(n) & 0xff) / 127.5 - 1) * 28);
  };

  nodes.forEach(n => {
    const r = ringR(n);
    const angle = Math.random() * 2 * Math.PI;
    n.x = W / 2 + Math.cos(angle) * r;
    n.y = H / 2 + Math.sin(angle) * r;
    n.vx = 0; n.vy = 0;
  });

  stopSim();
  sim = d3.forceSimulation(nodes)
    .force('radial', d3.forceRadial(n => ringR(n), W/2, H/2).strength(n => {
      return searchHitIds.has(n.id) ? 0.85 : 0.15;
    }))
    .force('charge', d3.forceManyBody()
      .strength(n => searchHitIds.has(n.id) ? -80 : -1))
    .force('coll',   d3.forceCollide(n => searchHitIds.has(n.id) ? 42 : 4)
      .strength(0.8))
    .alphaDecay(0.016)
    .on('tick', tick);

  searchTopics = intent?.topics || [];
  setFilterChips(intent?.filters || {}, searchTopics);
  setHint(intent?.explanation || `${results.length} courses matched — click to explore`);
}


// ═══════════════════════════════════════════════════════════════
// VIEW: SELECTED — focal course + full prereq chain + successors
// ═══════════════════════════════════════════════════════════════

function prefetchSimilarity(id) {
  if (id in simCache) return;
  simCache[id] = null;
  fetch(`/api/similar/${encodeURIComponent(id)}`)
    .then(r => r.json())
    .then(({ similar }) => { simCache[id] = similar; })
    .catch(() => { delete simCache[id]; });
}

function startSelected(id) {
  // Filter chips in SEARCH mode are part of the search context — clear on entry.
  // Galaxy-mode filterHitIds persist into SELECTED view.
  if (VIEW === 'SEARCH') {
    filterHitIds = new Set();
    activeFilters = null;
    searchTopics = [];
    intentTagsEl.innerHTML = '';
    filterPanelEl.hidden = true;
  }

  VIEW = 'SELECTED';
  searchQuery = ''; searchQueryNode = null; searchEdges = [];
  searchHitIds = new Set(); searchHitRanks = new Map();
  selected = nodeById[id];
  if (!selected) return;

  prereqDepths = buildPrereqDepths(id);
  selSuccIds   = new Set(edges.filter(e => e.source.id === id).map(e => e.target.id));
  const relIds = new Set([...prereqDepths.keys(), ...selSuccIds]);
  selRelEdges  = edges.filter(e => relIds.has(e.source.id) && relIds.has(e.target.id));

  nodes.forEach(n => { n._simScore = 0; });
  const outerR = Math.min(W, H) * 0.46;
  const djb2 = n => { let h = 5381; for (let i = 0; i < n.id.length; i++) h = ((h << 5) + h + n.id.charCodeAt(i)) | 0; return h; };

  function buildRingFns() {
    const bgScores = nodes
      .filter(n => !prereqDepths.has(n.id) && !selSuccIds.has(n.id))
      .map(n => n._simScore).sort((a, b) => a - b);
    const pct = s => { let lo = 0, hi = bgScores.length; while (lo < hi) { const m = (lo + hi) >> 1; bgScores[m] < s ? lo = m + 1 : hi = m; } return lo / bgScores.length; };
    const ringR = n => { const p = pct(n._simScore ?? 0); const base = p > 0.7 ? 60 + (1 - p) / 0.3 * 220 : outerR; return Math.max(30, base + ((djb2(n) & 0xff) / 127.5 - 1) * 28); };
    const strength = n => { if (prereqDepths.has(n.id) || selSuccIds.has(n.id)) return 0; const p = pct(n._simScore ?? 0); return p > 0.7 ? Math.min(0.85, 0.3 + (p - 0.7) * 2.75) : 0.15; };
    return { ringR, strength };
  }

  function applySimForces(similar) {
    const fns = buildRingFns();
    const relSet = new Set([...prereqDepths.keys(), ...selSuccIds]);
    const relLinks = [];
    Object.entries(similar).forEach(([sid, score]) => {
      if (relSet.has(sid) && sid !== id && nodeById[sid])
        relLinks.push({ source: nodeById[sid], target: selected, score });
    });
    if (relLinks.length)
      sim.force('similarity', d3.forceLink(relLinks).strength(e => e.score * 0.12).distance(e => (1 - e.score) * 200 + 50));
    sim.force('charge', d3.forceManyBody().strength(n => {
      const d = prereqDepths.get(n.id);
      if (d === 0) return -25; if (d === 1) return -100;
      if (d !== undefined) return -55;
      if (selSuccIds.has(n.id)) return -100;
      return -1;
    }));
    sim.force('sim-radial', d3.forceRadial(n => prereqDepths.has(n.id) || selSuccIds.has(n.id) ? 0 : fns.ringR(n), W / 2, H / 2).strength(fns.strength));
    return fns;
  }

  const cached = simCache[id];
  let ringFns = null;
  if (cached) {
    nodes.forEach(n => { n._simScore = cached[n.id] ?? 0; });
    ringFns = buildRingFns();
  }

  nodes.forEach(n => {
    n.fx = null; n.fy = null;
    const d = prereqDepths.get(n.id);
    if (d !== undefined && d > 0) {
      const tx = W / 2 - Math.min(d * 200, W * 0.38);
      n.x = tx + (Math.random() - 0.5) * 140;
      n.y = H / 2 + (Math.random() - 0.5) * H * 0.65;
    } else if (selSuccIds.has(n.id)) {
      n.x = W / 2 + 200 + Math.random() * 120;
      n.y = H / 2 + (Math.random() - 0.5) * H * 0.55;
    } else {
      const r = ringFns ? ringFns.ringR(n) : outerR * (0.9 + Math.random() * 0.25);
      const angle = Math.random() * 2 * Math.PI;
      n.x = W / 2 + Math.cos(angle) * r;
      n.y = H / 2 + Math.sin(angle) * r;
    }
  });

  selected.x = W / 2; selected.y = H / 2; selected.fx = W / 2; selected.fy = H / 2;

  const selScale = 1.1;
  d3.select(canvas).call(zoomBehavior.transform,
    d3.zoomIdentity.translate(W / 2 * (1 - selScale), H / 2 * (1 - selScale)).scale(selScale));

  stopSim();
  sim = d3.forceSimulation(nodes)
    .force('x', d3.forceX(n => {
      const d = prereqDepths.get(n.id);
      if (d === 0) return W / 2;
      if (d !== undefined) return W / 2 - Math.min(d * 200, W * 0.38);
      if (selSuccIds.has(n.id)) return W / 2 + 240;
      return n.x;
    }).strength(n => prereqDepths.has(n.id) || selSuccIds.has(n.id) ? (n === selected ? 1 : 0.45) : 0))
    .force('y', d3.forceY(H / 2).strength(n => prereqDepths.has(n.id) || selSuccIds.has(n.id) ? 0.18 : 0))
    .force('charge', d3.forceManyBody().strength(n => {
      const d = prereqDepths.get(n.id);
      if (d === 0) return cached ? -25 : -200;
      if (d === 1) return -100;
      if (d !== undefined) return -55;
      if (selSuccIds.has(n.id)) return -100;
      return -1;
    }))
    .force('coll', d3.forceCollide(n => {
      const d = prereqDepths.get(n.id);
      if (d === 0) return 52; if (d === 1) return 42;
      if (d !== undefined) return 13;
      if (selSuccIds.has(n.id)) return 40;
      return 4;
    }))
    .alphaDecay(0.02)
    .on('tick', tick);

  if (ringFns) applySimForces(cached);

  const total = prereqDepths.size - 1;
  setHint(`${selected.id}  ·  ${total} prerequisite${total !== 1 ? 's' : ''}  ·  enables ${selSuccIds.size}`);

  if (!cached) {
    const snapId = id;
    fetch(`/api/similar/${encodeURIComponent(id)}`).then(r => r.json()).then(({ similar }) => {
      simCache[id] = similar;
      if (VIEW !== 'SELECTED' || selected?.id !== snapId || !sim) return;
      nodes.forEach(n => { n._simScore = similar[n.id] ?? 0; });
      const fns = buildRingFns();
      nodes.forEach(n => {
        if (prereqDepths.has(n.id) || selSuccIds.has(n.id)) return;
        const r = fns.ringR(n), angle = Math.random() * 2 * Math.PI;
        n.x = W / 2 + Math.cos(angle) * r; n.y = H / 2 + Math.sin(angle) * r;
        n.vx = 0; n.vy = 0;
      });
      applySimForces(similar);
      sim.alpha(0.35).restart();
    }).catch(() => {});
  }
}


// ═══════════════════════════════════════════════════════════════
// DRAWING
// ═══════════════════════════════════════════════════════════════

const PREREQ_COLORS = ['#059669', '#0891b2', '#7c3aed'];

function nodeR(n) {
  if (VIEW === 'SELECTED') {
    const d = prereqDepths.get(n.id);
    if (d === 0) return 14;
    if (d === 1) return 10;
    if (d !== undefined) return 7;
    if (selSuccIds.has(n.id)) return 9;
    return 3;
  }
  if (VIEW === 'SEARCH') {
    const rank = searchHitRanks.get(n.id);
    if (rank !== undefined) return Math.max(7, 14 - rank * 0.37);
    return 3;
  }
  if (filterHitIds.size > 0) return filterHitIds.has(n.id) ? 5 : 3;
  return 3;
}

function drawEdges() {
  if (selected && selRelEdges.length) {
    ctx.save();
    ctx.lineCap = 'round';
    selRelEdges.forEach(e => {
      const s = e.source, t = e.target;
      if (!isFinite(s.x) || !isFinite(t.x)) return;
      let color = '#cbd5e1', lw = 1, alpha = 0.45;
      if (hovered) {
        if (t === hovered) { color = '#059669'; lw = 2; alpha = 0.9; }
        else if (s === hovered) { color = '#d97706'; lw = 2; alpha = 0.9; }
      }
      if (s === selected || t === selected) { lw = Math.max(lw, 1.5); alpha = Math.max(alpha, 0.55); }
      ctx.beginPath();
      ctx.moveTo(s.x, s.y); ctx.lineTo(t.x, t.y);
      ctx.strokeStyle = color;
      ctx.lineWidth   = lw / T.k;
      ctx.globalAlpha = alpha;
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  if (VIEW === 'SEARCH' && searchQueryNode && searchEdges.length) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 1 / T.k;
    searchEdges.forEach(e => {
      const t = e.target;
      if (!isFinite(t.x)) return;
      const score = searchScores[t.id] ?? 0;
      ctx.globalAlpha = 0.2 + score * 0.6;
      ctx.beginPath();
      ctx.moveTo(searchQueryNode.x, searchQueryNode.y);
      ctx.lineTo(t.x, t.y);
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
    ctx.restore();
  }
}

function nodeVisible(n) {
  if (filterHitIds.size === 0) return true;
  if (filterHitIds.has(n.id)) return true;
  return VIEW === 'SELECTED' && (prereqDepths.has(n.id) || selSuccIds.has(n.id));
}

function drawNodes() {
  const groups = new Map();
  nodes.forEach(n => {
    if (!isFinite(n.x) || !isFinite(n.y)) return;
    if (!nodeVisible(n)) return;
    const r = nodeR(n), c = nodeColor(n);
    const key = c + '|' + r;
    if (!groups.has(key)) groups.set(key, { c, r, list: [] });
    groups.get(key).list.push(n);
  });
  groups.forEach(({ c, r, list }) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    list.forEach(n => { ctx.moveTo(n.x + r, n.y); ctx.arc(n.x, n.y, r, 0, 2 * Math.PI); });
    ctx.fill();
  });

  [hovered, selected].forEach((n, i) => {
    if (!n || !isFinite(n.x)) return;
    const r = nodeR(n) + (i === 1 ? 4 : 2.5);
    ctx.beginPath();
    ctx.arc(n.x, n.y, r, 0, 2 * Math.PI);
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth   = (i === 1 ? 2 : 1.5) / T.k;
    ctx.stroke();
  });

  if (VIEW === 'SEARCH' && searchQueryNode) {
    const { x, y } = searchQueryNode;
    const sz = 10;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, sz * 1.8, 0, 2 * Math.PI);
    ctx.strokeStyle = 'rgba(37,99,235,0.12)';
    ctx.lineWidth = 1.5 / T.k;
    ctx.stroke();
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth   = 2.5 / T.k;
    ctx.lineCap     = 'round';
    ctx.beginPath();
    ctx.moveTo(x - sz, y - sz); ctx.lineTo(x + sz, y + sz);
    ctx.moveTo(x + sz, y - sz); ctx.lineTo(x - sz, y + sz);
    ctx.stroke();
    ctx.restore();
  }
}

function halo(text, x, y) {
  ctx.save();
  ctx.lineJoin    = 'round';
  ctx.lineWidth   = 3 / T.k;
  ctx.strokeStyle = 'rgba(255,255,255,0.92)';
  ctx.strokeText(text, x, y);
  ctx.restore();
}

function wrapText(text, maxPx, maxLines = 2) {
  const words = text.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? cur + ' ' + w : w;
    if (ctx.measureText(test).width > maxPx && cur) {
      if (lines.length + 1 >= maxLines) { lines.push(cur + ' …'); return lines; }
      lines.push(cur);
      cur = w;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function drawLabels() {
  const toLabel = [];

  if (VIEW === 'SELECTED') {
    nodes.forEach(n => {
      const d     = prereqDepths.get(n.id);
      const isSucc = selSuccIds.has(n.id);
      if (d === 0 || d === 1 || d === 2 || isSucc)
        toLabel.push({ n, big: d === 0, labelDepth: d ?? -1 });
    });
  } else if (VIEW === 'SEARCH') {
    nodes.forEach(n => {
      if (searchHitIds.has(n.id)) toLabel.push({ n, big: false, labelDepth: 0 });
    });
  } else if (hovered && T.k > 2) {
    toLabel.push({ n: hovered, big: false, labelDepth: 0 });
  }

  if (!toLabel.length && !(VIEW === 'SEARCH' && searchQueryNode)) return;

  ctx.textAlign = 'center';
  const LINE_H = 13;

  toLabel.forEach(({ n, big, labelDepth }) => {
    const r        = nodeR(n);
    const fontSize = big ? 12 : 10;
    const idSize   = big ? 10 : 8.5;
    const idY      = n.y - r - 3;

    ctx.font = `700 ${idSize}px -apple-system, sans-serif`;
    halo(n.id, n.x, idY);
    ctx.fillStyle = '#2563eb';
    ctx.fillText(n.id, n.x, idY);

    const showTitle = big || labelDepth === 1 || labelDepth === -1 || VIEW === 'SEARCH';
    if (showTitle) {
      const maxLines = big ? 2 : 1;
      const wrapPx   = big ? 160 : (VIEW === 'SEARCH' ? 130 : 120);
      ctx.font = `500 ${fontSize}px -apple-system, sans-serif`;
      const lines = wrapText(n.title, wrapPx, maxLines);
      lines.forEach((line, i) => {
        const y = n.y + r + fontSize + 2 + i * LINE_H;
        halo(line, n.x, y);
        ctx.fillStyle = '#0f172a';
        ctx.fillText(line, n.x, y);
      });
    }
  });

  if (VIEW === 'SEARCH' && searchQueryNode && searchQuery) {
    ctx.font      = `600 11px -apple-system, sans-serif`;
    ctx.textAlign = 'center';
    const { x, y } = searchQueryNode;
    const ly = y + 24;
    halo(searchQuery, x, ly);
    ctx.fillStyle = '#2563eb';
    ctx.fillText(searchQuery, x, ly);
  }
}

function draw() {
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.translate(T.x, T.y);
  ctx.scale(T.k, T.k);
  drawEdges();
  drawNodes();
  drawLabels();
  ctx.restore();
}


// ═══════════════════════════════════════════════════════════════
// MOUSE
// ═══════════════════════════════════════════════════════════════

function simXY(ev) { return T.invert([ev.clientX, ev.clientY]); }

canvas.addEventListener('mousemove', ev => {
  if (!qt) return;
  const [mx, my] = simXY(ev);
  const candidate = qt.find(mx, my, 50 / T.k);
  const found = candidate && nodeVisible(candidate) ? candidate : null;
  if (found !== hovered) { hovered = found; draw(); if (found) prefetchSimilarity(found.id); }
  found ? showTip(ev, found) : hideTip();
});

canvas.addEventListener('click', ev => {
  if (!qt) return;
  const [mx, my] = simXY(ev);
  const n = qt.find(mx, my, 20 / T.k);
  if (n && nodeVisible(n)) { openDetail(n.id); startSelected(n.id); }
});

canvas.addEventListener('mouseleave', () => { hovered = null; hideTip(); draw(); });


// ═══════════════════════════════════════════════════════════════
// TOOLTIP
// ═══════════════════════════════════════════════════════════════

const tipEl = document.getElementById('tooltip');

const DEPT_NAMES = {
  '1':'Civil & Env. Eng.','2':'Mech. Eng.','3':'Materials Sci.',
  '4':'Architecture','5':'Chemistry','6':'EECS','7':'Biology',
  '8':'Physics','9':'Brain & Cog. Sci.','10':'Chem. Eng.',
  '11':'Urban Studies','12':'Earth & Planetary Sci.','14':'Economics',
  '15':'Sloan (Management)','16':'AeroAstro','17':'Political Sci.',
  '18':'Mathematics','20':'Biological Eng.',
  '21':'Humanities','21A':'Anthropology','21G':'Global Languages',
  '21H':'History','21L':'Literature','21M':'Music & Theater Arts',
  '21T':'Theater Arts','21W':'Writing',
  '22':'Nuclear Sci. & Eng.','24':'Philosophy',
  'AS':'Air Force ROTC','CC':'Concourse',
  'CMS':'Comparative Media Studies','CSB':'Computational Systems Bio.',
  'CSE':'Computational Sci. & Eng.','EC':'Edgerton Center',
  'EM':'Engineering Management','ES':'Experimental Study',
  'HST':'Health Sci. & Tech.','IDS':'Data, Systems & Society',
  'MAD':'Design','MAS':'Media Arts & Sci.',
  'MS':'Army ROTC','NS':'Naval Science',
  'SCM':'Supply Chain Mgmt.','SP':'Special Programs',
  'STS':'Science, Tech. & Society','SWE':'Software Engineering',
  'WGS':'Women\'s & Gender Studies',
};

function showTip(ev, n) {
  let rel = '';
  if (VIEW === 'SELECTED' && selected) {
    const d = prereqDepths.get(n.id);
    if (d === 0)              rel = ' · selected';
    else if (d === 1)         rel = ' · direct prerequisite';
    else if (d !== undefined) rel = ` · prereq (depth ${d})`;
    else if (selSuccIds.has(n.id)) rel = ' · enabled by this';
    if (d !== 0 && n._simScore > 0) rel += ` · ${Math.round(n._simScore * 100)}% similar`;
  } else if (VIEW === 'SEARCH') {
    const s = searchScores[n.id];
    if (s > 0) rel = ` · ${Math.round(s * 100)}% match`;
  }
  const dept = DEPT_NAMES[n.dept] ? `${n.dept} — ${DEPT_NAMES[n.dept]}` : `Dept. ${n.dept}`;
  document.getElementById('tt-id').textContent    = n.id;
  document.getElementById('tt-title').textContent = n.title;
  document.getElementById('tt-meta').textContent  = `${n.units} units · ${dept}${rel}`;
  tipEl.style.opacity = '1';
  tipEl.style.left = Math.min(ev.clientX + 14, W - 230) + 'px';
  tipEl.style.top  = Math.min(ev.clientY - 10, H - 90)  + 'px';
}
function hideTip() { tipEl.style.opacity = '0'; }


// ═══════════════════════════════════════════════════════════════
// DETAIL PANEL
// ═══════════════════════════════════════════════════════════════

async function openDetail(id) {
  const n = nodeById[id];
  if (n) {
    document.getElementById('d-id').textContent    = n.id;
    document.getElementById('d-title').textContent = n.title;
    document.getElementById('d-meta').textContent  = `${n.units} units · ${n.level || '—'}`;
    document.getElementById('d-desc').textContent  = 'Loading…';
    document.getElementById('d-prereqs').innerHTML = '';
    document.getElementById('d-related').innerHTML = '';
  }
  document.getElementById('detail').classList.add('open');

  let c = courseDetails[id];
  if (!c) {
    c = await fetch(`/api/course/${id}`).then(r => r.json());
    courseDetails[id] = c;
  }

  document.getElementById('d-meta').textContent = [
    c.units && `${c.units} units`,
    c.level,
    c.instructors?.length ? c.instructors.join(', ') : null,
  ].filter(Boolean).join(' · ');

  document.getElementById('d-desc').textContent = c.description;

  function chips(ids, cls) {
    if (!ids?.length) return '<span class="d-none">None listed</span>';
    return ids.filter(id => nodeById[id]).map(pid =>
      `<span class="chip ${cls}" data-id="${pid}">${pid}</span>`
    ).join('') || '<span class="d-none">None in catalog</span>';
  }

  document.getElementById('d-prereqs').innerHTML = chips(c.prereqs_flat, 'pre');
  document.getElementById('d-related').innerHTML = chips(c.related_subjects, '');

  document.querySelectorAll('.chip[data-id]').forEach(el => {
    el.onclick = () => { openDetail(el.dataset.id); startSelected(el.dataset.id); };
  });

  if (c.url) {
    const existing = document.getElementById('d-url-link');
    if (existing) existing.remove();
    const link = document.createElement('a');
    link.id = 'd-url-link';
    link.href = c.url; link.target = '_blank';
    link.textContent = 'View on MIT website →';
    link.style.cssText = 'display:block;margin-top:16px;font-size:13px;color:#2563eb;text-decoration:none;';
    document.querySelector('.d-body').appendChild(link);
  }
}

document.getElementById('detail-close').addEventListener('click', () => {
  document.getElementById('detail').classList.remove('open');
  startGalaxy();
});


// ═══════════════════════════════════════════════════════════════
// SEARCH INPUT
// ═══════════════════════════════════════════════════════════════

const searchInput = document.getElementById('search-input');

function applyFilter(filterIds, intent) {
  if (VIEW === 'SEARCH') startGalaxy();
  searchTopics = [];
  filterHitIds = new Set(filterIds);
  setFilterChips(intent?.filters ?? {});
  setHint(intent?.explanation || `${filterIds.length} courses matched`);
  draw();
}

async function doSearch(q) {
  searchInput.blur();
  setHint('Searching…');
  intentTagsEl.innerHTML = '';
  const data = await fetch('/api/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q, n: 20 }),
  }).then(r => r.json());
  const { courses, scores, intent } = data;
  if (intent?.action === 'filter') {
    if (VIEW === 'SEARCH' && searchTopics.length > 0) {
      await applyFilterObj(intent.filters);
    } else {
      applyFilter(data.filter_ids?.length ? data.filter_ids : courses.map(c => c.id), intent);
    }
  } else {
    filterHitIds = new Set();
    activeFilters = null;
    startSearch(courses, scores, q, intent);
  }
}

searchInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && searchInput.value.trim()) doSearch(searchInput.value.trim());
  if (e.key === 'Escape') { searchInput.value = ''; startGalaxy(); }
});


// ═══════════════════════════════════════════════════════════════
// HINT + FILTER CHIPS
// ═══════════════════════════════════════════════════════════════

const hintEl        = document.getElementById('hint');
const intentTagsEl  = document.getElementById('intent-tags');
const filterPanelEl = document.getElementById('filter-panel');
const fpType        = document.getElementById('fp-type');
const fpValue       = document.getElementById('fp-value');

function setHint(t) { hintEl.textContent = t ?? ''; hintEl.style.opacity = t ? '1' : '0'; }

const _esc = s => String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');

const FP_NO_VALUE = new Set(['level_G', 'level_U', 'has_prereqs_true', 'has_prereqs_false']);

function toggleFilterPanel() {
  filterPanelEl.hidden = !filterPanelEl.hidden;
  if (!filterPanelEl.hidden) {
    fpType.value = ''; fpValue.hidden = true; fpValue.value = ''; fpType.focus();
  }
}

fpType.addEventListener('change', () => {
  const needsVal = fpType.value && !FP_NO_VALUE.has(fpType.value);
  fpValue.hidden = !needsVal;
  fpValue.value = '';
  if (needsVal) fpValue.focus();
});

async function submitFilterPanel() {
  const type = fpType.value;
  if (!type) return;
  if (!FP_NO_VALUE.has(type) && !fpValue.value.trim()) return;
  const val = fpValue.value.trim();

  const f = activeFilters ? JSON.parse(JSON.stringify(activeFilters)) : {};
  switch (type) {
    case 'level_G':           f.level = 'G'; break;
    case 'level_U':           f.level = 'U'; break;
    case 'has_prereqs_true':  f.has_prereqs = true; break;
    case 'has_prereqs_false': f.has_prereqs = false; break;
    case 'dept':       f.depts            = [...(f.depts || []), val]; break;
    case 'max_units':  f.max_units        = parseInt(val, 10); break;
    case 'min_rating': f.min_rating       = parseFloat(val); break;
    case 'instructor': f.instructors      = [...(f.instructors || []), val]; break;
    case 'exclude':    f.exclude_keywords = [...(f.exclude_keywords || []), val]; break;
  }

  filterPanelEl.hidden = true;
  await applyFilterObj(f);
}

document.getElementById('fp-add').addEventListener('click', submitFilterPanel);
fpValue.addEventListener('keydown', e => { if (e.key === 'Enter') submitFilterPanel(); });
document.getElementById('fp-cancel').addEventListener('click', () => { filterPanelEl.hidden = true; });

function setFilterChips(filters, topics = []) {
  activeFilters = filters;
  const chips = [];
  if (filters.level === 'G') chips.push({ key: 'level', label: 'grad' });
  if (filters.level === 'U') chips.push({ key: 'level', label: 'undergrad' });
  (filters.depts || []).forEach(d => chips.push({ key: `dept:${d}`, label: `dept ${d}` }));
  if (filters.max_units   != null) chips.push({ key: 'max_units',   label: `≤ ${filters.max_units} units` });
  if (filters.min_rating  != null) chips.push({ key: 'min_rating',  label: `rating ≥ ${filters.min_rating}` });
  if (filters.has_prereqs === true)  chips.push({ key: 'has_prereqs', label: 'has prereqs' });
  if (filters.has_prereqs === false) chips.push({ key: 'has_prereqs', label: 'no prereqs' });
  (filters.instructors       || []).forEach(i => chips.push({ key: `instr:${i}`, label: `by ${i}` }));
  (filters.exclude_keywords  || []).forEach(k => chips.push({ key: `excl:${k}`,  label: `not "${k}"` }));
  (filters.requires_courses  || []).forEach(c => chips.push({ key: `req:${c}`,   label: `needs ${c}` }));

  const chipsHtml = chips.length
    ? chips.map(({ key, label }) =>
        `<span class="filter-chip"><span>${_esc(label)}</span><span class="fc-x" data-key="${_esc(key)}">×</span></span>`
      ).join('')
    : topics.map(t => `<span class="intent-tag">${_esc(t)}</span>`).join('');

  intentTagsEl.innerHTML = chipsHtml + `<span class="add-chip" id="fp-open" title="Add filter">+</span>`;
  intentTagsEl.querySelectorAll('.fc-x').forEach(x =>
    x.addEventListener('click', () => removeFilterChip(x.dataset.key)));
  document.getElementById('fp-open').addEventListener('click', toggleFilterPanel);
}

async function removeFilterChip(key) {
  if (!activeFilters) return;
  const f = JSON.parse(JSON.stringify(activeFilters));
  if      (key === 'level')       delete f.level;
  else if (key === 'max_units')   delete f.max_units;
  else if (key === 'min_rating')  delete f.min_rating;
  else if (key === 'has_prereqs') delete f.has_prereqs;
  else if (key.startsWith('dept:'))  f.depts            = (f.depts || []).filter(d => d !== key.slice(5));
  else if (key.startsWith('instr:')) f.instructors       = (f.instructors || []).filter(i => i !== key.slice(6));
  else if (key.startsWith('excl:'))  f.exclude_keywords  = (f.exclude_keywords || []).filter(k => k !== key.slice(5));
  else if (key.startsWith('req:'))   f.requires_courses  = (f.requires_courses || []).filter(c => c !== key.slice(4));
  await applyFilterObj(f);
}

function hasActiveFilters(f) {
  return !!(f?.level || f?.depts?.length || f?.max_units != null ||
    f?.min_rating != null || f?.has_prereqs != null ||
    f?.instructors?.length || f?.exclude_keywords?.length || f?.requires_courses?.length);
}

async function applyFilterObj(f) {
  if (VIEW === 'SEARCH' && searchTopics.length > 0) {
    setHint('Searching…');
    const data = await fetch('/api/refilter', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topics: searchTopics, filters: f, n: 20 }),
    }).then(r => r.json());
    startSearch(data.courses, data.scores, searchQuery, {
      action: 'search', topics: searchTopics, filters: f,
      explanation: `${data.courses.length} courses matched`,
    });
  } else if (!hasActiveFilters(f)) {
    filterHitIds = new Set();
    activeFilters = null;
    intentTagsEl.innerHTML = '';
    filterPanelEl.hidden = true;
    setHint(null);
    draw();
  } else {
    setHint('Filtering…');
    const data = await fetch('/api/filter', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filters: f }),
    }).then(r => r.json());
    filterHitIds = new Set(data.course_ids);
    setFilterChips(f);
    setHint(`${data.count} courses matched`);
    draw();
  }
}


// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════

async function init() {
  const [coursesData, graphData] = await Promise.all([
    fetch('/api/courses').then(r => r.json()),
    fetch('/api/graph').then(r => r.json()),
  ]);

  nodes = coursesData.map(c => ({
    id: c.id, title: c.title, units: c.units, level: c.level, dept: c.dept,
    x: W/2 + (Math.random() - 0.5) * W * 0.7,
    y: H/2 + (Math.random() - 0.5) * H * 0.7,
  }));
  nodeById = Object.fromEntries(nodes.map(n => [n.id, n]));

  edges = graphData.edges
    .map(e => ({ source: nodeById[e.source], target: nodeById[e.target] }))
    .filter(e => e.source && e.target);

  updateQt();
  startGalaxy();
  searchInput.focus();
}

init();
