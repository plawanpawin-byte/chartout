'use strict';
// ---------- helpers ----------
const $ = (s, r = document) => r.querySelector(s);
const h = (tag, props = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
};
const NS = 'http://www.w3.org/2000/svg';
const sv = (tag, attrs = {}) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
const uid = () => Math.random().toString(36).slice(2, 9);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const toast = (m) => { const t = h('div', { class: 'toast', text: m }); document.body.append(t); setTimeout(() => t.remove(), 2400); };

// ---------- model ----------
const SHAPES = [
  ['process', 'Process'], ['rounded', 'Rounded'], ['decision', 'Decision'], ['terminator', 'Start / End'], ['data', 'Data'],
  ['ellipse', 'Ellipse'], ['document', 'Document'], ['database', 'Database'], ['subprocess', 'Subprocess'], ['note', 'Note'],
  ['actor', 'Actor'], ['cloud', 'Cloud'], ['hexagon', 'Hexagon'], ['triangle', 'Triangle'], ['star', 'Star'], ['text', 'Text'],
];
const LIBS = [
  ['Flowchart', SHAPES.map((x) => x.slice())],
  ['UML', [['class', 'Class'], ['interface', 'Interface'], ['package', 'Package'], ['component', 'Component'], ['usecase', 'Use case'], ['lifeline', 'Lifeline'], ['activation', 'Activation'], ['state', 'State']]],
  ['Network', [['server', 'Server'], ['router', 'Router'], ['netswitch', 'Switch'], ['firewall', 'Firewall'], ['laptop', 'Laptop']]],
  ['Circuit', [['resistor', 'Resistor'], ['capacitor', 'Capacitor'], ['inductor', 'Inductor'], ['battery', 'Battery'], ['diode', 'Diode'], ['ground', 'Ground'], ['cswitch', 'Switch']]],
];
LIBS.slice(1).forEach(([, l]) => l.forEach((x) => SHAPES.push(x)));
const SIZES = { actor: [60, 90], text: [120, 40], class: [150, 110], interface: [150, 80], package: [150, 100], component: [140, 70], usecase: [150, 70], lifeline: [110, 220], activation: [16, 90], state: [130, 70], server: [70, 90], router: [80, 80], netswitch: [100, 50], firewall: [90, 80], laptop: [100, 70], resistor: [90, 36], capacitor: [60, 50], inductor: [100, 36], battery: [60, 50], diode: [90, 40], ground: [40, 40], cswitch: [90, 40] };
const LABEL_BELOW = new Set(['server', 'router', 'netswitch', 'firewall', 'laptop', 'resistor', 'capacitor', 'inductor', 'battery', 'diode', 'ground', 'cswitch']);
const HEADER_TEXT = { class: 0.17, interface: 0.2, lifeline: 0.07, package: 0.3, state: 0.2 };
const FILLS = ['#ffffff', '#e6e6e6', '#c4c4c4', '#8f8f8f', '#555555', '#262626', '#dfe6ec', '#e8e2d4', '#dde8dd', '#ecdcdc'];
let doc = { shapes: [], edges: [], title: 'Untitled' };
let sel = new Set();          // ids (shapes or edges)
let tool = 'select';
let zoom = 1, panX = 0, panY = 0;
let grid = true, snap = true;
let undoS = [], redoS = [];
let clip = null;
let fileName = '';
let style = { fill: '#ffffff', stroke: '#3a3a3a', fs: 14 };

const snapshot = () => JSON.stringify(doc);
function commit() { undoS.push(snapshot()); if (undoS.length > 100) undoS.shift(); redoS = []; }
function undo() { if (!undoS.length) return; redoS.push(snapshot()); doc = JSON.parse(undoS.pop()); sel.clear(); render(); }
function redo() { if (!redoS.length) return; undoS.push(snapshot()); doc = JSON.parse(redoS.pop()); sel.clear(); render(); }

// ---------- UI ----------
const app = $('#app');
const toolbar = h('div', { class: 'toolbar' });
const left = h('div', { class: 'sidebar' });
const stage = h('div', { class: 'stage', style: 'overflow:hidden;cursor:default' });
const right = h('div', { class: 'sidebar right' });
const status = h('div', { class: 'status' });
app.append(toolbar, h('div', { class: 'main' }, left, stage, right), status);
const btn = (label, fn, cls = '') => h('button', { class: 'btn ' + cls, onclick: fn, text: label });
const bSelect = btn('Select', () => setTool('select'));
const bConn = btn('Connector', () => setTool('connect'));
const bPan = btn('Hand', () => setTool('pan'));
toolbar.append(btn('New', newDoc), btn('Templates', openTemplates), btn('Open', openDoc), btn('Save', saveDoc, 'primary'), h('span', { class: 'sep' }), bSelect, bConn, bPan, h('span', { class: 'sep' }),
  btn('Undo', undo), btn('Redo', redo), h('span', { class: 'sep' }), btn('Copy', copy), btn('Paste', paste), btn('Duplicate', dupe), btn('Delete', del), h('span', { class: 'sep' }),
  btn('Front', () => order(1)), btn('Back', () => order(-1)), h('span', { class: 'sep' }),
  btn('-', () => zoomBy(1 / 1.2), 'icon'), btn('+', () => zoomBy(1.2), 'icon'), btn('Fit', fit), h('span', { class: 'grow' }),
  btn('Export PNG', () => exportImg('png')), btn('Export SVG', () => exportImg('svg')));
function setTool(t) { tool = t; [[bSelect, 'select'], [bConn, 'connect'], [bPan, 'pan']].forEach(([b, k]) => b.classList.toggle('on', k === t)); stage.style.cursor = t === 'pan' ? 'grab' : t === 'connect' ? 'crosshair' : 'default'; }
setTool('select');

// left palette
LIBS.forEach(([gname, list]) => {
left.append(h('h3', { text: gname }));
const pal = h('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px' });
list.forEach(([k, n]) => {
  const prev = sv('svg', { viewBox: '0 0 60 40', width: 60, height: 40 });
  prev.append(shapeEl({ type: k, x: 5, y: 5, w: 50, h: 30, preview: 1, fill: '#d0d0d0', stroke: '#8a8a8a', text: '', fs: 10 }, true));
  const c = h('div', { class: 'btn', style: 'display:flex;flex-direction:column;align-items:center;gap:3px;padding:8px 2px 6px;font-size:11px;height:auto', draggable: 'true', onclick: () => addShape(k) }, prev, h('span', { text: n }));
  c.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', 'shape:' + k));
  pal.append(c);
});
left.append(pal);
});
left.append(h('h3', { text: 'Canvas' }),
  h('label', { class: 'row' }, h('input', { type: 'checkbox', checked: true, onchange: (e) => { grid = e.target.checked; render(); } }), 'Show grid'),
  h('label', { class: 'row' }, h('input', { type: 'checkbox', checked: true, onchange: (e) => { snap = e.target.checked; } }), 'Snap to grid'));

// canvas
const svg = sv('svg', { width: '100%', height: '100%', style: 'display:block;touch-action:none' });
const defs = sv('defs');
defs.innerHTML = '<marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="context-stroke"/></marker><pattern id="gridp" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="#3a3a3a" stroke-width="0.6"/></pattern>';
const world = sv('g');
const gridRect = sv('rect', { x: -20000, y: -20000, width: 40000, height: 40000, fill: 'url(#gridp)' });
const gShapes = sv('g'), gEdges = sv('g'), gUI = sv('g');
world.append(gridRect, gEdges, gShapes, gUI);
svg.append(defs, world);
stage.append(svg);
stage.ondragover = (e) => e.preventDefault();
stage.ondrop = (e) => { e.preventDefault(); const d = e.dataTransfer.getData('text/plain'); if (d.startsWith('shape:')) { const p = toWorld(e); addShape(d.slice(6), p.x, p.y); } };

const toWorld = (e) => { const r = svg.getBoundingClientRect(); return { x: (e.clientX - r.left - panX) / zoom, y: (e.clientY - r.top - panY) / zoom }; };
const sn = (v) => (snap ? Math.round(v / 10) * 10 : v);
function applyView() { world.setAttribute('transform', `translate(${panX} ${panY}) scale(${zoom})`); gridRect.style.display = grid ? '' : 'none'; renderStatus(); }
function zoomBy(f, cx, cy) { const r = svg.getBoundingClientRect(); cx = cx ?? r.width / 2; cy = cy ?? r.height / 2; const nz = clamp(zoom * f, 0.1, 5); panX = cx - (cx - panX) * (nz / zoom); panY = cy - (cy - panY) * (nz / zoom); zoom = nz; applyView(); }
function fit() {
  if (!doc.shapes.length) { zoom = 1; panX = 40; panY = 40; applyView(); return; }
  const b = bounds(doc.shapes); const r = svg.getBoundingClientRect();
  zoom = clamp(Math.min((r.width - 80) / b.w, (r.height - 80) / b.h), 0.1, 2);
  panX = (r.width - b.w * zoom) / 2 - b.x * zoom; panY = (r.height - b.h * zoom) / 2 - b.y * zoom; applyView();
}
const bounds = (list) => { const x0 = Math.min(...list.map((s) => s.x)), y0 = Math.min(...list.map((s) => s.y)), x1 = Math.max(...list.map((s) => s.x + s.w)), y1 = Math.max(...list.map((s) => s.y + s.h)); return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; };

// ---------- shapes ----------
function shapeEl(s, preview = false) {
  const g = sv('g'); const { x, y, w, h: hh } = s;
  const f = { fill: s.fill, stroke: s.stroke, 'stroke-width': 1.6, 'stroke-linejoin': 'round' };
  const add = (tag, a) => { const e = sv(tag, { ...f, ...a }); g.append(e); return e; };
  switch (s.type) {
    case 'rounded': add('rect', { x, y, width: w, height: hh, rx: Math.min(14, hh / 3) }); break;
    case 'decision': add('path', { d: `M${x + w / 2} ${y}L${x + w} ${y + hh / 2}L${x + w / 2} ${y + hh}L${x} ${y + hh / 2}Z` }); break;
    case 'terminator': add('rect', { x, y, width: w, height: hh, rx: hh / 2 }); break;
    case 'data': add('path', { d: `M${x + w * 0.15} ${y}H${x + w}L${x + w * 0.85} ${y + hh}H${x}Z` }); break;
    case 'ellipse': add('ellipse', { cx: x + w / 2, cy: y + hh / 2, rx: w / 2, ry: hh / 2 }); break;
    case 'document': add('path', { d: `M${x} ${y}H${x + w}V${y + hh * 0.85}C${x + w * 0.75} ${y + hh * 0.7} ${x + w * 0.6} ${y + hh * 1.05} ${x + w * 0.5} ${y + hh * 0.9}S${x + w * 0.15} ${y + hh * 0.75} ${x} ${y + hh * 0.9}Z` }); break;
    case 'database': { const ry = Math.min(12, hh / 5); add('path', { d: `M${x} ${y + ry}V${y + hh - ry}A${w / 2} ${ry} 0 0 0 ${x + w} ${y + hh - ry}V${y + ry}A${w / 2} ${ry} 0 0 0 ${x} ${y + ry}Z` }); add('path', { d: `M${x} ${y + ry}A${w / 2} ${ry} 0 0 0 ${x + w} ${y + ry}`, fill: 'none' }); break; }
    case 'subprocess': add('rect', { x, y, width: w, height: hh }); add('path', { d: `M${x + 10} ${y}V${y + hh}M${x + w - 10} ${y}V${y + hh}`, fill: 'none' }); break;
    case 'note': add('path', { d: `M${x} ${y}H${x + w - 14}L${x + w} ${y + 14}V${y + hh}H${x}Z` }); add('path', { d: `M${x + w - 14} ${y}V${y + 14}H${x + w}`, fill: 'none' }); break;
    case 'actor': { const cx = x + w / 2; add('circle', { cx, cy: y + hh * 0.18, r: Math.min(w, hh) * 0.14 }); add('path', { d: `M${cx} ${y + hh * 0.32}V${y + hh * 0.65}M${x + w * 0.2} ${y + hh * 0.45}H${x + w * 0.8}M${cx} ${y + hh * 0.65}L${x + w * 0.25} ${y + hh}M${cx} ${y + hh * 0.65}L${x + w * 0.75} ${y + hh}`, fill: 'none' }); break; }
    case 'cloud': add('path', { d: `M${x + w * 0.25} ${y + hh * 0.85}A${w * 0.2} ${hh * 0.3} 0 0 1 ${x + w * 0.2} ${y + hh * 0.4}A${w * 0.22} ${hh * 0.3} 0 0 1 ${x + w * 0.5} ${y + hh * 0.18}A${w * 0.22} ${hh * 0.3} 0 0 1 ${x + w * 0.8} ${y + hh * 0.4}A${w * 0.2} ${hh * 0.3} 0 0 1 ${x + w * 0.75} ${y + hh * 0.85}Z` }); break;
    case 'hexagon': add('path', { d: `M${x + w * 0.25} ${y}H${x + w * 0.75}L${x + w} ${y + hh / 2}L${x + w * 0.75} ${y + hh}H${x + w * 0.25}L${x} ${y + hh / 2}Z` }); break;
    case 'triangle': add('path', { d: `M${x + w / 2} ${y}L${x + w} ${y + hh}H${x}Z` }); break;
    case 'star': { const cx = x + w / 2, cy = y + hh / 2; const pts = []; for (let i = 0; i < 10; i++) { const r = i % 2 ? 0.2 : 0.5; const a = -Math.PI / 2 + (i * Math.PI) / 5; pts.push(`${cx + Math.cos(a) * r * w * 2 * 0.5 * 1},${cy + Math.sin(a) * r * hh * 2 * 0.5}`); } add('polygon', { points: pts.join(' ') }); break; }
    case 'text': add('rect', { x, y, width: w, height: hh, fill: 'none', stroke: 'none' }); break;

    case 'class': case 'interface': { add('rect', { x, y, width: w, height: hh }); const l1 = y + hh * 0.3; add('path', { d: `M${x} ${l1}H${x + w}` + (s.type === 'class' ? `M${x} ${y + hh * 0.62}H${x + w}` : ''), fill: 'none' }); break; }
    case 'package': add('rect', { x, y, width: w * 0.4, height: Math.min(18, hh * 0.2) }); add('rect', { x, y: y + Math.min(18, hh * 0.2), width: w, height: hh - Math.min(18, hh * 0.2) }); break;
    case 'component': add('rect', { x: x + 8, y, width: w - 8, height: hh }); add('rect', { x, y: y + hh * 0.25, width: 16, height: 9 }); add('rect', { x, y: y + hh * 0.6, width: 16, height: 9 }); break;
    case 'usecase': add('ellipse', { cx: x + w / 2, cy: y + hh / 2, rx: w / 2, ry: hh / 2 }); break;
    case 'lifeline': { const hd = Math.min(36, hh * 0.18); add('rect', { x, y, width: w, height: hd }); add('path', { d: `M${x + w / 2} ${y + hd}V${y + hh}`, fill: 'none', 'stroke-dasharray': '6 5' }); break; }
    case 'activation': add('rect', { x, y, width: w, height: hh }); break;
    case 'state': add('rect', { x, y, width: w, height: hh, rx: Math.min(18, hh / 3) }); add('path', { d: `M${x} ${y + hh * 0.38}H${x + w}`, fill: 'none' }); break;
    case 'server': add('rect', { x: x + w * 0.1, y, width: w * 0.8, height: hh }); for (let i = 0; i < 3; i++) { add('path', { d: `M${x + w * 0.1} ${y + hh * (i + 1) / 4}H${x + w * 0.9}`, fill: 'none' }); add('circle', { cx: x + w * 0.24, cy: y + hh * (i + 0.5) / 4 + hh / 8 - hh / 8, r: 2, fill: s.stroke }); } break;
    case 'router': { const cx = x + w / 2, cy = y + hh / 2, r = Math.min(w, hh) / 2; add('circle', { cx, cy, r }); add('path', { d: `M${cx - r * 0.6} ${cy}H${cx + r * 0.6}M${cx} ${cy - r * 0.6}V${cy + r * 0.6}M${cx + r * 0.6} ${cy}l-5 -4M${cx + r * 0.6} ${cy}l-5 4M${cx - r * 0.6} ${cy}l5 -4M${cx - r * 0.6} ${cy}l5 4M${cx} ${cy - r * 0.6}l-4 5M${cx} ${cy - r * 0.6}l4 5M${cx} ${cy + r * 0.6}l-4 -5M${cx} ${cy + r * 0.6}l4 -5`, fill: 'none' }); break; }
    case 'netswitch': add('rect', { x, y: y + hh * 0.2, width: w, height: hh * 0.6, rx: 3 }); add('path', { d: `M${x + w * 0.15} ${y + hh * 0.4}H${x + w * 0.4}l-5 -4M${x + w * 0.4} ${y + hh * 0.4}l-5 4M${x + w * 0.85} ${y + hh * 0.6}H${x + w * 0.6}l5 -4M${x + w * 0.6} ${y + hh * 0.6}l5 4`, fill: 'none' }); break;
    case 'firewall': { add('rect', { x, y, width: w, height: hh }); for (let i = 1; i < 4; i++) add('path', { d: `M${x} ${y + hh * i / 4}H${x + w}`, fill: 'none' }); for (let i = 0; i < 4; i++) { const o = i % 2 ? w * 0.25 : w * 0.5; add('path', { d: `M${x + o} ${y + hh * i / 4}V${y + hh * (i + 1) / 4}`, fill: 'none' }); if (i % 2) add('path', { d: `M${x + w * 0.75} ${y + hh * i / 4}V${y + hh * (i + 1) / 4}`, fill: 'none' }); } break; }
    case 'laptop': add('rect', { x: x + w * 0.14, y, width: w * 0.72, height: hh * 0.72, rx: 3 }); add('path', { d: `M${x} ${y + hh}H${x + w}L${x + w * 0.9} ${y + hh * 0.72}H${x + w * 0.1}Z` }); break;
    case 'resistor': case 'capacitor': case 'inductor': case 'battery': case 'diode': case 'ground': case 'cswitch': {
      g.append(sv('rect', { x, y, width: w, height: hh, fill: 'transparent', stroke: 'none' }));
      const m = y + hh / 2, c = { fill: 'none', 'stroke-linecap': 'round' }; let d = '';
      if (s.type === 'resistor') { const a = x + w * 0.2, b = x + w * 0.8, n = 6, st = (b - a) / n; d = `M${x} ${m}H${a}`; for (let i = 0; i < n; i++) d += `L${a + st * (i + 0.5)} ${m + (i % 2 ? hh * 0.32 : -hh * 0.32)}`; d += `L${b} ${m}H${x + w}`; }
      else if (s.type === 'capacitor') { const cx = x + w / 2; d = `M${x} ${m}H${cx - 5}M${cx - 5} ${y + 2}V${y + hh - 2}M${cx + 5} ${y + 2}V${y + hh - 2}M${cx + 5} ${m}H${x + w}`; }
      else if (s.type === 'inductor') { const a = x + w * 0.15, b = x + w * 0.85, n = 4, r = (b - a) / n / 2; d = `M${x} ${m}H${a}`; for (let i = 0; i < n; i++) d += `a${r} ${r} 0 0 1 ${r * 2} 0`; d += `M${b} ${m}H${x + w}`; }
      else if (s.type === 'battery') { const cx = x + w / 2; d = `M${x} ${m}H${cx - 6}M${cx - 6} ${y + 2}V${y + hh - 2}M${cx + 6} ${y + hh * 0.3}V${y + hh * 0.7}M${cx + 6} ${m}H${x + w}`; }
      else if (s.type === 'diode') { const a = x + w * 0.35, b = x + w * 0.65; d = `M${x} ${m}H${a}M${a} ${y + 2}V${y + hh - 2}L${b} ${m}Z M${b} ${y + 2}V${y + hh - 2}M${b} ${m}H${x + w}`; }
      else if (s.type === 'ground') { const cx = x + w / 2; d = `M${cx} ${y}V${y + hh * 0.4}M${x} ${y + hh * 0.4}H${x + w}M${x + w * 0.2} ${y + hh * 0.65}H${x + w * 0.8}M${x + w * 0.4} ${y + hh * 0.9}H${x + w * 0.6}`; }
      else { d = `M${x} ${m}H${x + w * 0.25}L${x + w * 0.72} ${y + 3}M${x + w * 0.75} ${m}H${x + w}`; add('circle', { cx: x + w * 0.25, cy: m, r: 2.5, fill: s.stroke }); add('circle', { cx: x + w * 0.75, cy: m, r: 2.5, fill: s.stroke }); }
      add('path', { d, ...c }); break; }
    default: add('rect', { x, y, width: w, height: hh });
  }
  if (s.text && !preview) {
    const below = LABEL_BELOW.has(s.type), hd = HEADER_TEXT[s.type];
    const ty = below ? y + hh + s.fs * 0.9 : hd !== undefined ? y + Math.max(hh * hd, s.fs * 0.9 + 4) : y + hh / 2;
    const t = sv('text', { x: x + w / 2, y: ty, 'text-anchor': 'middle', 'dominant-baseline': 'central', fill: below ? '#e4e4e4' : textColor(s.fill, s.type), 'font-size': s.fs, 'font-family': 'Segoe UI, Arial, sans-serif', style: 'pointer-events:none' });
    const lines = wrap(s.text, w - 12, s.fs);
    lines.forEach((ln, i) => { const ts = sv('tspan', { x: x + w / 2, dy: i === 0 ? (below || hd !== undefined ? 0 : -((lines.length - 1) * s.fs * 1.2) / 2) : s.fs * 1.2 }); ts.textContent = ln || ' '; t.append(ts); });
    g.append(t);
  }
  return g;
}
function textColor(fill, type) {
  if (type === 'text' || fill === 'none') return '#e4e4e4';
  const n = parseInt(fill.slice(1), 16); const l = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return l > 140 ? '#1a1a1a' : '#f2f2f2';
}
const meas = document.createElement('canvas').getContext('2d');
function wrap(text, maxW, fs) {
  meas.font = `${fs}px Segoe UI, Arial, sans-serif`;
  const out = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const t = line ? line + ' ' + word : word;
      if (meas.measureText(t).width > maxW && line) { out.push(line); line = word; } else line = t;
    }
    out.push(line);
  }
  return out;
}

// ---------- edges ----------
const centerOf = (s) => ({ x: s.x + s.w / 2, y: s.y + s.h / 2 });
function edgePoint(s, toward) {
  const c = centerOf(s); const dx = toward.x - c.x, dy = toward.y - c.y;
  if (!dx && !dy) return c;
  const hw = s.w / 2, hh = s.h / 2; let t;
  if (s.type === 'ellipse' || s.type === 'actor' || s.type === 'usecase' || s.type === 'router') t = 1 / Math.sqrt((dx * dx) / (hw * hw) + (dy * dy) / (hh * hh));
  else if (s.type === 'decision') t = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
  else t = Math.min(hw / Math.abs(dx || 1e-9), hh / Math.abs(dy || 1e-9));
  return { x: c.x + dx * t, y: c.y + dy * t };
}
function edgePath(e) {
  const a = doc.shapes.find((s) => s.id === e.from), b = doc.shapes.find((s) => s.id === e.to); if (!a || !b) return null;
  const ca = centerOf(a), cb = centerOf(b);
  if (e.kind === 'ortho') {
    const vgap = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h)), hgap = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
    const horiz = (hgap > 0 && vgap <= 0) || (hgap > 0 && vgap > 0 && hgap > vgap) || (hgap <= 0 && vgap <= 0 && Math.abs(cb.x - ca.x) > Math.abs(cb.y - ca.y));
    const mx = hgap > 0 ? (cb.x > ca.x ? (a.x + a.w + b.x) / 2 : (b.x + b.w + a.x) / 2) : (ca.x + cb.x) / 2;
    const my = vgap > 0 ? (cb.y > ca.y ? (a.y + a.h + b.y) / 2 : (b.y + b.h + a.y) / 2) : (ca.y + cb.y) / 2;
    const mid = horiz ? [{ x: mx, y: ca.y }, { x: mx, y: cb.y }] : [{ x: ca.x, y: my }, { x: cb.x, y: my }];
    const p0 = edgePoint(a, mid[0]), p3 = edgePoint(b, mid[1]);
    return { d: `M${p0.x} ${p0.y}L${mid[0].x} ${mid[0].y}L${mid[1].x} ${mid[1].y}L${p3.x} ${p3.y}`, label: { x: (mid[0].x + mid[1].x) / 2, y: (mid[0].y + mid[1].y) / 2 } };
  }
  const p0 = edgePoint(a, cb), p1 = edgePoint(b, ca);
  return { d: `M${p0.x} ${p0.y}L${p1.x} ${p1.y}`, label: { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 } };
}

// ---------- render ----------
function render() {
  gShapes.textContent = ''; gEdges.textContent = ''; gUI.textContent = '';
  for (const e of doc.edges) {
    const p = edgePath(e); if (!p) continue;
    const g = sv('g'); g.dataset.id = e.id; g.dataset.kind = 'edge';
    g.append(sv('path', { d: p.d, fill: 'none', stroke: 'transparent', 'stroke-width': 12 }));
    g.append(sv('path', { d: p.d, fill: 'none', stroke: sel.has(e.id) ? '#ffffff' : e.stroke || '#9a9a9a', 'stroke-width': sel.has(e.id) ? 2.6 : 1.8, 'marker-end': e.arrow === 'none' ? '' : 'url(#arr)', 'stroke-dasharray': e.dash ? '6 4' : '' }));
    if (e.label) {
      const w = e.label.length * 7 + 10;
      g.append(sv('rect', { x: p.label.x - w / 2, y: p.label.y - 10, width: w, height: 20, fill: '#262626', rx: 3 }));
      const t = sv('text', { x: p.label.x, y: p.label.y, 'text-anchor': 'middle', 'dominant-baseline': 'central', fill: '#d6d6d6', 'font-size': 12, 'font-family': 'Segoe UI, Arial, sans-serif' }); t.textContent = e.label; g.append(t);
    }
    gEdges.append(g);
  }
  for (const s of doc.shapes) {
    const g = shapeEl(s); g.dataset.id = s.id; g.dataset.kind = 'shape';
    if (sel.has(s.id)) g.append(sv('rect', { x: s.x - 3, y: s.y - 3, width: s.w + 6, height: s.h + 6, fill: 'none', stroke: '#e0e0e0', 'stroke-dasharray': '4 3', 'pointer-events': 'none' }));
    gShapes.append(g);
  }
  drawHandles();
  applyView(); renderRight(); renderStatus();
}
function drawHandles() {
  const ss = doc.shapes.filter((s) => sel.has(s.id)); if (ss.length !== 1) return;
  const s = ss[0];
  const pts = { nw: [s.x, s.y], n: [s.x + s.w / 2, s.y], ne: [s.x + s.w, s.y], e: [s.x + s.w, s.y + s.h / 2], se: [s.x + s.w, s.y + s.h], s: [s.x + s.w / 2, s.y + s.h], sw: [s.x, s.y + s.h], w: [s.x, s.y + s.h / 2] };
  const cur = { nw: 'nwse', se: 'nwse', ne: 'nesw', sw: 'nesw', n: 'ns', s: 'ns', e: 'ew', w: 'ew' };
  for (const [k, [px, py]] of Object.entries(pts)) { const r = sv('rect', { x: px - 4 / zoom, y: py - 4 / zoom, width: 8 / zoom, height: 8 / zoom, fill: '#e6e6e6', stroke: '#222', 'stroke-width': 1 / zoom, style: `cursor:${cur[k]}-resize` }); r.dataset.handle = k; gUI.append(r); }
}
function renderStatus() {
  status.textContent = '';
  status.append(h('span', { text: (fileName || 'Untitled') }), h('span', { class: 'grow' }), h('span', { text: `${doc.shapes.length} shapes, ${doc.edges.length} connectors` }), h('span', { text: Math.round(zoom * 100) + '%' }));
}
function renderRight() {
  right.textContent = '';
  right.append(h('h3', { text: 'Diagram' }), h('label', { class: 'field' }, 'Title', h('input', { type: 'text', value: doc.title, oninput: (e) => { doc.title = e.target.value; } })));
  const items = [...sel].map((id) => doc.shapes.find((s) => s.id === id) || doc.edges.find((e) => e.id === id)).filter(Boolean);
  if (!items.length) { right.append(h('h3', { text: 'Tips' }), h('div', { class: 'muted', text: 'Drag shapes from the left. Use Connector to draw lines between shapes. Double-click a shape to type text. Hold Space and drag to pan.' })); return; }
  const shapes = items.filter((i) => i.type), edges = items.filter((i) => i.from);
  if (shapes.length) {
    right.append(h('h3', { text: 'Fill' }));
    right.append(h('div', { class: 'swatches' }, FILLS.map((c) => h('button', { style: `background:${c}`, onclick: () => { commit(); shapes.forEach((s) => (s.fill = c)); style.fill = c; render(); } }))));
    right.append(h('h3', { text: 'Outline' }), h('div', { class: 'swatches' }, ['#3a3a3a', '#8a8a8a', '#d0d0d0', '#ffffff'].map((c) => h('button', { style: `background:${c}`, onclick: () => { commit(); shapes.forEach((s) => (s.stroke = c)); render(); } }))));
    const fs = h('input', { type: 'range', min: 8, max: 48, value: shapes[0].fs, oninput: () => { shapes.forEach((s) => (s.fs = +fs.value)); render(); }, onchange: () => {} });
    fs.addEventListener('pointerdown', commit);
    right.append(h('h3', { text: 'Text size' }), fs);
    right.append(h('h3', { text: 'Size' }), h('div', { class: 'row' }, numField('W', shapes[0].w, (v) => shapes.forEach((s) => (s.w = v))), numField('H', shapes[0].h, (v) => shapes.forEach((s) => (s.h = v)))));
    right.append(h('h3', { text: 'Align' }), h('div', { class: 'ptools', style: 'display:grid;grid-template-columns:repeat(3,1fr);gap:6px' }, ['Left', 'Center', 'Right', 'Top', 'Middle', 'Bottom'].map((a) => btn(a, () => align(a.toLowerCase())))), h('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:6px' }, btn('Distribute H', () => distribute('x')), btn('Distribute V', () => distribute('y'))));
  }
  if (edges.length) {
    right.append(h('h3', { text: 'Connector' }),
      h('div', { class: 'col' }, btn('Straight / Elbow', () => { commit(); edges.forEach((e) => (e.kind = e.kind === 'ortho' ? 'line' : 'ortho')); render(); }), btn('Dashed', () => { commit(); edges.forEach((e) => (e.dash = !e.dash)); render(); }), btn('Arrow on/off', () => { commit(); edges.forEach((e) => (e.arrow = e.arrow === 'none' ? 'end' : 'none')); render(); }), btn('Edit label', () => editLabel(edges[0]))));
  }
}
function numField(label, val, set) { const i = h('input', { type: 'number', value: Math.round(val), style: 'width:70px', onchange: () => { commit(); set(Math.max(10, +i.value || 10)); render(); } }); return h('label', { class: 'field' }, label, i); }

// ---------- editing ----------
function addShape(type, x, y) {
  const r = svg.getBoundingClientRect();
  const cx = x ?? ((r.width / 2 - panX) / zoom - 60), cy = y ?? ((r.height / 2 - panY) / zoom - 35);
  commit();
  const s = { id: uid(), type, x: sn(cx), y: sn(cy), w: (SIZES[type] || [120, 70])[0], h: (SIZES[type] || [120, 70])[1], text: type === 'text' ? 'Text' : '', fill: type === 'text' ? 'none' : style.fill, stroke: style.stroke, fs: style.fs };
  if (type === 'class') s.text = 'ClassName'; if (type === 'state') s.text = 'State'; if (type === 'lifeline') s.text = 'Object'; if (type === 'package') s.text = 'package'; if (type === 'interface') s.text = '<<interface>>';
  doc.shapes.push(s); sel = new Set([s.id]); render();
}
function del() { if (!sel.size) return; commit(); doc.shapes = doc.shapes.filter((s) => !sel.has(s.id)); const ids = new Set(doc.shapes.map((s) => s.id)); doc.edges = doc.edges.filter((e) => !sel.has(e.id) && ids.has(e.from) && ids.has(e.to)); sel.clear(); render(); }
function copy() { const ss = doc.shapes.filter((s) => sel.has(s.id)); if (!ss.length) return; const ids = new Set(ss.map((s) => s.id)); clip = JSON.stringify({ shapes: ss, edges: doc.edges.filter((e) => ids.has(e.from) && ids.has(e.to)) }); toast('Copied'); }
function paste(offset = 30) {
  if (!clip) return; const c = JSON.parse(clip); const map = {}; commit(); sel.clear();
  for (const s of c.shapes) { const id = uid(); map[s.id] = id; doc.shapes.push({ ...s, id, x: s.x + offset, y: s.y + offset }); sel.add(id); }
  for (const e of c.edges) doc.edges.push({ ...e, id: uid(), from: map[e.from], to: map[e.to] });
  render();
}
function dupe() { copy(); paste(); }
function order(dir) { const ss = doc.shapes.filter((s) => sel.has(s.id)); if (!ss.length) return; commit(); const rest = doc.shapes.filter((s) => !sel.has(s.id)); doc.shapes = dir > 0 ? [...rest, ...ss] : [...ss, ...rest]; render(); }
function align(a) {
  const ss = doc.shapes.filter((s) => sel.has(s.id)); if (ss.length < 2) return; commit(); const b = bounds(ss);
  for (const s of ss) { if (a === 'left') s.x = b.x; else if (a === 'right') s.x = b.x + b.w - s.w; else if (a === 'center') s.x = b.x + (b.w - s.w) / 2; else if (a === 'top') s.y = b.y; else if (a === 'bottom') s.y = b.y + b.h - s.h; else if (a === 'middle') s.y = b.y + (b.h - s.h) / 2; }
  render();
}
function distribute(axis) {
  const ss = doc.shapes.filter((s) => sel.has(s.id)).sort((a, b) => a[axis] - b[axis]); if (ss.length < 3) return; commit();
  const size = axis === 'x' ? 'w' : 'h'; const first = ss[0][axis], last = ss[ss.length - 1][axis] + ss[ss.length - 1][size];
  const total = ss.reduce((t, s) => t + s[size], 0); const gap = (last - first - total) / (ss.length - 1); let pos = first;
  for (const s of ss) { s[axis] = pos; pos += s[size] + gap; }
  render();
}
function editText(s) {
  const ta = h('textarea', { rows: 4, style: 'width:300px' }); ta.value = s.text;
  const back = h('div', { class: 'modal-back' }, h('div', { class: 'modal' }, h('h2', { text: 'Shape text' }), ta, h('div', { class: 'row', style: 'justify-content:flex-end' }, btn('Cancel', () => back.remove()), btn('OK', () => { commit(); s.text = ta.value; back.remove(); render(); }, 'primary'))));
  document.body.append(back); ta.focus(); ta.select();
}
function editLabel(e) {
  const i = h('input', { type: 'text', value: e.label || '', style: 'width:260px' });
  const back = h('div', { class: 'modal-back' }, h('div', { class: 'modal' }, h('h2', { text: 'Connector label' }), i, h('div', { class: 'row', style: 'justify-content:flex-end' }, btn('Cancel', () => back.remove()), btn('OK', () => { commit(); e.label = i.value; back.remove(); render(); }, 'primary'))));
  document.body.append(back); i.focus();
}

// ---------- pointer interaction ----------
let drag = null, spaceDown = false;
svg.addEventListener('pointerdown', (ev) => {
  if (ev.button === 1 || tool === 'pan' || spaceDown) { drag = { mode: 'pan', sx: ev.clientX, sy: ev.clientY, px: panX, py: panY }; svg.setPointerCapture(ev.pointerId); stage.style.cursor = 'grabbing'; return; }
  const p = toWorld(ev);
  const hd = ev.target.dataset.handle;
  const node = ev.target.closest('[data-id]');
  if (hd) { const s = doc.shapes.find((x) => sel.has(x.id)); commit(); drag = { mode: 'resize', hd, s, o: { ...s }, p }; svg.setPointerCapture(ev.pointerId); return; }
  if (tool === 'connect') {
    const from = node && node.dataset.kind === 'shape' ? node.dataset.id : null;
    if (!from) return;
    const line = sv('line', { stroke: '#e0e0e0', 'stroke-dasharray': '5 4', 'stroke-width': 1.6 }); gUI.append(line);
    drag = { mode: 'connect', from, line }; svg.setPointerCapture(ev.pointerId); return;
  }
  if (node) {
    const id = node.dataset.id;
    if (ev.shiftKey) { sel.has(id) ? sel.delete(id) : sel.add(id); }
    else if (!sel.has(id)) sel = new Set([id]);
    render();
    const moving = doc.shapes.filter((s) => sel.has(s.id));
    if (!moving.length) return;
    commit(); drag = { mode: 'move', p, orig: moving.map((s) => ({ s, x: s.x, y: s.y })) }; svg.setPointerCapture(ev.pointerId);
  } else {
    if (!ev.shiftKey) sel.clear();
    const r = sv('rect', { fill: 'rgba(200,200,200,.12)', stroke: '#bdbdbd', 'stroke-dasharray': '4 3' }); gUI.append(r);
    drag = { mode: 'marquee', p, r, add: ev.shiftKey }; svg.setPointerCapture(ev.pointerId); render();
    gUI.append(r);
  }
});
svg.addEventListener('pointermove', (ev) => {
  if (!drag) return;
  if (drag.mode === 'pan') { panX = drag.px + ev.clientX - drag.sx; panY = drag.py + ev.clientY - drag.sy; applyView(); return; }
  const p = toWorld(ev);
  if (drag.mode === 'move') { const dx = p.x - drag.p.x, dy = p.y - drag.p.y; for (const o of drag.orig) { o.s.x = sn(o.x + dx); o.s.y = sn(o.y + dy); } renderLive(); }
  else if (drag.mode === 'resize') {
    const { s, o, hd } = drag; const dx = p.x - drag.p.x, dy = p.y - drag.p.y;
    let { x, y, w, h: hh } = o;
    if (hd.includes('e')) w = Math.max(20, sn(o.w + dx)); if (hd.includes('s')) hh = Math.max(20, sn(o.h + dy));
    if (hd.includes('w')) { const nx = sn(o.x + dx); w = Math.max(20, o.w + (o.x - nx)); x = o.x + o.w - w; }
    if (hd.includes('n')) { const ny = sn(o.y + dy); hh = Math.max(20, o.h + (o.y - ny)); y = o.y + o.h - hh; }
    Object.assign(s, { x, y, w, h: hh }); renderLive();
  } else if (drag.mode === 'connect') {
    const a = doc.shapes.find((s) => s.id === drag.from); const c = centerOf(a);
    drag.line.setAttribute('x1', c.x); drag.line.setAttribute('y1', c.y); drag.line.setAttribute('x2', p.x); drag.line.setAttribute('y2', p.y);
  } else if (drag.mode === 'marquee') {
    const x = Math.min(p.x, drag.p.x), y = Math.min(p.y, drag.p.y), w = Math.abs(p.x - drag.p.x), hh = Math.abs(p.y - drag.p.y);
    drag.r.setAttribute('x', x); drag.r.setAttribute('y', y); drag.r.setAttribute('width', w); drag.r.setAttribute('height', hh); drag.box = { x, y, w, h: hh };
  }
});
function renderLive() { render(); }
svg.addEventListener('pointerup', (ev) => {
  if (!drag) return;
  const d = drag; drag = null; stage.style.cursor = tool === 'pan' ? 'grab' : tool === 'connect' ? 'crosshair' : 'default';
  if (d.mode === 'connect') {
    d.line.remove(); const t = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-id]');
    if (t && t.dataset.kind === 'shape' && t.dataset.id !== d.from) { commit(); const e = { id: uid(), from: d.from, to: t.dataset.id, kind: 'line', label: '', arrow: 'end', stroke: '#9a9a9a' }; doc.edges.push(e); sel = new Set([e.id]); }
    render();
  } else if (d.mode === 'marquee') {
    d.r.remove();
    if (d.box && d.box.w > 3) { for (const s of doc.shapes) if (s.x < d.box.x + d.box.w && s.x + s.w > d.box.x && s.y < d.box.y + d.box.h && s.y + s.h > d.box.y) sel.add(s.id); }
    render();
  } else if (d.mode === 'move' || d.mode === 'resize') render();
});
svg.addEventListener('dblclick', (ev) => {
  const node = ev.target.closest('[data-id]'); if (!node) return;
  if (node.dataset.kind === 'shape') editText(doc.shapes.find((s) => s.id === node.dataset.id));
  else editLabel(doc.edges.find((e) => e.id === node.dataset.id));
});
svg.addEventListener('wheel', (ev) => { ev.preventDefault(); const r = svg.getBoundingClientRect(); if (ev.ctrlKey || ev.metaKey) zoomBy(ev.deltaY < 0 ? 1.1 : 1 / 1.1, ev.clientX - r.left, ev.clientY - r.top); else { panX -= ev.deltaX; panY -= ev.deltaY; applyView(); } }, { passive: false });
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input,textarea')) return;
  const k = e.key.toLowerCase();
  if (e.code === 'Space') { spaceDown = true; e.preventDefault(); }
  else if (e.key === 'Delete' || e.key === 'Backspace') del();
  else if (e.ctrlKey && k === 'z') { e.shiftKey ? redo() : undo(); e.preventDefault(); }
  else if (e.ctrlKey && k === 'y') { redo(); e.preventDefault(); }
  else if (e.ctrlKey && k === 'c') copy();
  else if (e.ctrlKey && k === 'v') paste();
  else if (e.ctrlKey && k === 'd') { dupe(); e.preventDefault(); }
  else if (e.ctrlKey && k === 'a') { sel = new Set([...doc.shapes.map((s) => s.id)]); render(); e.preventDefault(); }
  else if (e.ctrlKey && k === 's') { saveDoc(); e.preventDefault(); }
  else if (e.ctrlKey && k === 'o') { openDoc(); e.preventDefault(); }
  else if (e.key === 'Escape') { sel.clear(); setTool('select'); render(); }
  else if (e.key.startsWith('Arrow') && sel.size) { const d = e.shiftKey ? 10 : 1; commit(); doc.shapes.filter((s) => sel.has(s.id)).forEach((s) => { if (e.key === 'ArrowLeft') s.x -= d; if (e.key === 'ArrowRight') s.x += d; if (e.key === 'ArrowUp') s.y -= d; if (e.key === 'ArrowDown') s.y += d; }); render(); e.preventDefault(); }
  else if (k === 'v') setTool('select'); else if (k === 'c' && !e.ctrlKey) setTool('connect'); else if (k === 'h') setTool('pan');
});
document.addEventListener('keyup', (e) => { if (e.code === 'Space') spaceDown = false; });

// ---------- files ----------
function newDoc() { if (doc.shapes.length && !confirm('Discard the current diagram?')) return; doc = { shapes: [], edges: [], title: 'Untitled' }; sel.clear(); undoS = []; savedSnap = snapshot(); redoS = []; fileName = ''; fit(); render(); }
async function openDoc() {
  const f = (await window.host.openFiles({ filters: [['Chartout diagram', ['chartout', 'json']]] }))[0]; if (!f) return;
  try { const d = JSON.parse(new TextDecoder().decode(f.data)); if (!Array.isArray(d.shapes) || !Array.isArray(d.edges)) throw new Error('Not a Chartout file'); doc = { title: String(d.title || 'Untitled'), shapes: d.shapes.map(cleanShape), edges: d.edges }; fileName = f.name; sel.clear(); undoS = []; savedSnap = snapshot(); fit(); render(); }
  catch (e) { toast('Cannot open: ' + e.message); }
}
const cleanShape = (s) => ({ id: String(s.id), type: SHAPES.some((x) => x[0] === s.type) ? s.type : 'process', x: +s.x || 0, y: +s.y || 0, w: Math.max(10, +s.w || 100), h: Math.max(10, +s.h || 60), text: String(s.text || ''), fill: /^#[0-9a-f]{6}$/i.test(s.fill) ? s.fill : 'none', stroke: /^#[0-9a-f]{6}$/i.test(s.stroke) ? s.stroke : '#3a3a3a', fs: clamp(+s.fs || 14, 6, 96) });
async function saveDoc() {
  const r = await window.host.saveFile({ name: (doc.title || 'diagram') + '.chartout', filters: [['Chartout diagram', ['chartout']]], data: new TextEncoder().encode(JSON.stringify(doc, null, 1)) });
  if (r) { savedSnap = snapshot(); fileName = r.name; toast('Saved ' + r.name); renderStatus(); }
}
function exportSvgString() {
  const b = doc.shapes.length ? bounds(doc.shapes) : { x: 0, y: 0, w: 200, h: 100 }; const pad = 30;
  const root = sv('svg', { xmlns: NS, width: b.w + pad * 2, height: b.h + pad * 2, viewBox: `${b.x - pad} ${b.y - pad} ${b.w + pad * 2} ${b.h + pad * 2}` });
  root.append(sv('rect', { x: b.x - pad, y: b.y - pad, width: b.w + pad * 2, height: b.h + pad * 2, fill: '#ffffff' }));
  const d2 = defs.cloneNode(true); d2.querySelector('#gridp')?.remove(); root.append(d2);
  const ge = gEdges.cloneNode(true); ge.querySelectorAll('path[stroke="transparent"]').forEach((n) => n.remove()); ge.querySelectorAll('rect[fill="#262626"]').forEach((n) => n.setAttribute('fill', '#ffffff')); ge.querySelectorAll('text').forEach((n) => n.setAttribute('fill', '#222')); ge.querySelectorAll('path[stroke="#ffffff"]').forEach((n) => n.setAttribute('stroke', '#555'));
  ge.querySelectorAll('path[stroke="#9a9a9a"]').forEach((n) => n.setAttribute('stroke', '#555'));
  root.append(ge);
  const gs = gShapes.cloneNode(true); gs.querySelectorAll('rect[stroke-dasharray="4 3"]').forEach((n) => n.remove()); gs.querySelectorAll('text[fill="#e4e4e4"]').forEach((n) => n.setAttribute('fill', '#222'));
  root.append(gs);
  return { str: new XMLSerializer().serializeToString(root), w: b.w + pad * 2, h: b.h + pad * 2 };
}
async function exportImg(kind) {
  const { str, w, h: hh } = exportSvgString();
  if (kind === 'svg') { const r = await window.host.saveFile({ name: (doc.title || 'diagram') + '.svg', filters: [['SVG', ['svg']]], data: new TextEncoder().encode(str) }); if (r) toast('Saved ' + r.name); return; }
  const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(str);
  await img.decode();
  const cv = document.createElement('canvas'); cv.width = w * 2; cv.height = hh * 2; const ctx = cv.getContext('2d'); ctx.scale(2, 2); ctx.drawImage(img, 0, 0, w, hh);
  const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
  const res = await window.host.saveFile({ name: (doc.title || 'diagram') + '.png', filters: [['PNG image', ['png']]], data: new Uint8Array(await blob.arrayBuffer()) });
  if (res) toast('Saved ' + res.name);
}


// ---------- templates ----------
const TEMPLATES = [
  { name: 'Flowchart', nodes: [['a', 'terminator', 200, 20, 140, 50, 'Start'], ['b', 'process', 200, 110, 140, 70, 'Step one'], ['c', 'decision', 190, 220, 160, 100, 'OK?'], ['d', 'process', 440, 235, 140, 70, 'Fix'], ['e', 'terminator', 200, 370, 140, 50, 'End']], edges: [['a', 'b'], ['b', 'c'], ['c', 'd', 'No'], ['d', 'b'], ['c', 'e', 'Yes']] },
  { name: 'Org chart', nodes: [['a', 'rounded', 240, 20, 140, 60, 'Director'], ['b', 'rounded', 60, 150, 140, 60, 'Manager A'], ['c', 'rounded', 240, 150, 140, 60, 'Manager B'], ['d', 'rounded', 420, 150, 140, 60, 'Manager C'], ['e', 'process', 0, 280, 120, 50, 'Team 1'], ['f', 'process', 140, 280, 120, 50, 'Team 2'], ['g', 'process', 300, 280, 120, 50, 'Team 3'], ['h', 'process', 480, 280, 120, 50, 'Team 4']], edges: [['a', 'b', '', 'ortho'], ['a', 'c', '', 'ortho'], ['a', 'd', '', 'ortho'], ['b', 'e', '', 'ortho'], ['b', 'f', '', 'ortho'], ['c', 'g', '', 'ortho'], ['d', 'h', '', 'ortho']] },
  { name: 'UML class diagram', nodes: [['a', 'class', 220, 20, 170, 110, 'Animal'], ['b', 'class', 60, 220, 170, 110, 'Dog'], ['c', 'class', 380, 220, 170, 110, 'Cat'], ['d', 'interface', 620, 40, 160, 80, '<<interface>> Pet']], edges: [['b', 'a', 'extends', 'ortho'], ['c', 'a', 'extends', 'ortho'], ['a', 'd', 'implements', 'line', 1]] },
  { name: 'UML use case', nodes: [['a', 'actor', 20, 120, 60, 90, 'User'], ['b', 'usecase', 220, 40, 170, 70, 'Sign in'], ['c', 'usecase', 220, 150, 170, 70, 'Browse items'], ['d', 'usecase', 220, 260, 170, 70, 'Check out'], ['e', 'actor', 560, 150, 60, 90, 'Admin']], edges: [['a', 'b'], ['a', 'c'], ['a', 'd'], ['e', 'c']] },
  { name: 'UML sequence', nodes: [['a', 'lifeline', 40, 20, 110, 260, 'Client'], ['b', 'lifeline', 260, 20, 110, 260, 'Server'], ['c', 'lifeline', 480, 20, 110, 260, 'Database']], edges: [] },
  { name: 'UML state machine', nodes: [['a', 'ellipse', 30, 90, 40, 40, ''], ['b', 'state', 130, 75, 130, 70, 'Idle'], ['c', 'state', 360, 75, 130, 70, 'Running'], ['d', 'state', 590, 75, 130, 70, 'Done']], edges: [['a', 'b'], ['b', 'c', 'start'], ['c', 'd', 'finish'], ['c', 'b', 'pause', 'line', 1]] },
  { name: 'Network topology', nodes: [['a', 'cloud', 240, 10, 140, 80, 'Internet'], ['b', 'firewall', 265, 130, 90, 80, 'Firewall'], ['c', 'router', 270, 260, 80, 80, 'Router'], ['d', 'netswitch', 260, 390, 100, 50, 'Switch'], ['e', 'server', 80, 500, 70, 90, 'Server'], ['f', 'laptop', 260, 510, 100, 70, 'Laptop'], ['g', 'laptop', 450, 510, 100, 70, 'Laptop']], edges: [['a', 'b'], ['b', 'c'], ['c', 'd'], ['d', 'e', '', 'ortho'], ['d', 'f'], ['d', 'g', '', 'ortho']] },
  { name: 'Circuit (RC + battery)', nodes: [['a', 'battery', 40, 120, 60, 50, 'V'], ['b', 'resistor', 180, 20, 100, 36, 'R1'], ['c', 'capacitor', 400, 120, 60, 50, 'C1'], ['d', 'ground', 240, 260, 40, 40, '']], edges: [['a', 'b', '', 'ortho'], ['b', 'c', '', 'ortho'], ['c', 'd', '', 'ortho'], ['a', 'd', '', 'ortho']] },
  { name: 'Swimlane process', nodes: [['l1', 'text', 10, 10, 120, 40, 'Customer'], ['l2', 'text', 10, 160, 120, 40, 'Sales'], ['l3', 'text', 10, 310, 120, 40, 'Fulfilment'], ['a', 'terminator', 160, 15, 130, 40, 'Order'], ['b', 'process', 160, 160, 130, 50, 'Review'], ['c', 'decision', 340, 140, 130, 90, 'In stock?'], ['d', 'process', 540, 165, 130, 50, 'Ship'], ['e', 'terminator', 540, 315, 130, 40, 'Done']], edges: [['a', 'b'], ['b', 'c'], ['c', 'd', 'Yes'], ['d', 'e']] },
  { name: 'Venn / relation', nodes: [['a', 'ellipse', 80, 60, 200, 150, 'Set A'], ['b', 'ellipse', 200, 60, 200, 150, 'Set B']], edges: [] },
];
function buildTemplate(t) {
  const map = {};
  const shapes = t.nodes.map(([k, type, x, y, w, hh, text]) => { const s = { id: uid(), type, x, y, w, h: hh, text, fill: type === 'text' ? 'none' : type === 'decision' ? '#e6e6e6' : '#ffffff', stroke: '#3a3a3a', fs: 14 }; if (['activation'].includes(type)) s.fill = '#e6e6e6'; map[k] = s.id; return s; });
  const edges = t.edges.map(([f, to, label = '', kind = 'line', dash]) => ({ id: uid(), from: map[f], to: map[to], kind, label, arrow: 'end', stroke: '#9a9a9a', ...(dash ? { dash: true } : {}) }));
  return { shapes, edges, title: t.name };
}
function openTemplates() {
  const close = () => back.remove();
  const grid = h('div', { style: 'display:grid;grid-template-columns:repeat(3,200px);gap:10px' });
  TEMPLATES.forEach((t) => {
    const d = buildTemplate(t); const b = bounds(d.shapes);
    const pv = sv('svg', { viewBox: `${b.x - 10} ${b.y - 10} ${b.w + 20} ${b.h + 20}`, width: 180, height: 110, style: 'background:#1c1c1c;border-radius:4px' });
    d.shapes.forEach((s) => { const prev = { ...s, text: '' }; pv.append(shapeEl(prev, true)); });
    const card = h('div', { class: 'btn', style: 'display:flex;flex-direction:column;align-items:center;gap:6px;height:auto;padding:8px', onclick: () => { if (doc.shapes.length && !confirm('Replace the current diagram with this template?')) return; commit(); doc = d; sel.clear(); close(); render(); fit(); } }, pv, h('span', { text: t.name }));
    grid.append(card);
  });
  const back = h('div', { class: 'modal-back' }, h('div', { class: 'modal' }, h('h2', { text: 'Templates' }), grid, h('div', { class: 'row', style: 'justify-content:flex-end' }, btn('Close', close))));
  document.body.append(back);
}

// start with a small example so the canvas is not empty
(function sample() {
  const mk = (type, x, y, text, w = 140, hh = 70) => ({ id: uid(), type, x, y, w, h: hh, text, fill: type === 'decision' ? '#e6e6e6' : '#ffffff', stroke: '#3a3a3a', fs: 14 });
  const a = mk('terminator', 200, 40, 'Start', 140, 50), b = mk('process', 200, 140, 'Collect input'), c = mk('decision', 190, 260, 'Valid?', 160, 100), d = mk('process', 440, 275, 'Show error'), e = mk('terminator', 200, 430, 'Done', 140, 50);
  doc.shapes = [a, b, c, d, e];
  const ed = (f, t, label = '', kind = 'line') => ({ id: uid(), from: f.id, to: t.id, kind, label, arrow: 'end', stroke: '#9a9a9a' });
  doc.edges = [ed(a, b), ed(b, c), ed(c, d, 'No'), ed(c, e, 'Yes')];
  doc.title = 'Sample flow';
})();
render();
setTimeout(fit, 30);
window.addEventListener('resize', () => applyView());

let savedSnap = null;
setTimeout(() => { if (savedSnap === null) savedSnap = snapshot(); }, 0);
window.addEventListener('beforeunload', (e) => { if (savedSnap !== null && snapshot() !== savedSnap) { e.preventDefault(); e.returnValue = ''; } });
