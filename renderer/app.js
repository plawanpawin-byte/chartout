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
const toast = (m, ms = 2400) => { const t = h('div', { class: 'toast', text: m }); document.body.append(t); setTimeout(() => t.remove(), ms); };
// IPC errors arrive as "Error invoking remote method 'x': Error: message"; keep only the message
const cleanErr = (e) => String((e && e.message) || e).replace(/Error invoking remote method '[^']*': (?:\w*Error: )?/g, '');

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
let savedSnap = null;         // the diagram as last saved or opened; null until the start-up diagram is drawn
const isDirty = () => savedSnap !== null && snapshot() !== savedSnap;
// ask before throwing away unsaved changes (New, Open, Templates); a saved or untouched diagram goes without asking
const okToDiscard = (msg) => !isDirty() || confirm(msg);
// commit(before) records an undo step; pass the snapshot taken before a change that is already made
function commit(before = snapshot()) { undoS.push(before); if (undoS.length > 100) undoS.shift(); redoS = []; }
// runs a change and records an undo step only when the diagram really changed
function edit(fn) { const before = snapshot(); fn(); if (snapshot() !== before) commit(before); render(); }
function undo() { if (!undoS.length) return; endDrag(); redoS.push(snapshot()); doc = JSON.parse(undoS.pop()); sel.clear(); render(); }
function redo() { if (!redoS.length) return; endDrag(); undoS.push(snapshot()); doc = JSON.parse(redoS.pop()); sel.clear(); render(); }

// ---------- UI ----------
// Material Symbols (Outlined) style icons, fill-based, on a 24px grid. Path data in the style of Google's Material icons (Apache-2.0).
const ICONS = {
  newdoc: 'M13 11h-2v3H8v2h3v3h2v-3h3v-2h-3zm1-9H6c-1.1 0-2 .9-2 2v16c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z',
  open: 'M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10z',
  save: 'M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm2 16H5V5h11.17L19 7.83V19zm-7-7c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3zM6 6h9v4H6z',
  undo: 'M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z',
  redo: 'M18.4 10.6C16.55 8.99 14.15 8 11.5 8c-4.65 0-8.58 3.03-9.96 7.22L3.9 16c1.05-3.19 4.05-5.5 7.6-5.5 1.95 0 3.73.72 5.12 1.88L13 16h9V7l-3.6 3.6z',
  templates: 'M3 3v8h8V3H3zm6 6H5V5h4v4zm-6 4v8h8v-8H3zm6 6H5v-4h4v4zm4-16v8h8V3h-8zm6 6h-4V5h4v4zm-6 4v8h8v-8h-8zm6 6h-4v-4h4v4z',
  download: 'M18 15v3H6v-3H4v3c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-3h-2zm-1-4l-1.41-1.41L13 12.17V4h-2v8.17L8.41 9.59 7 11l5 5 5-5z',
  image: 'M19 5v14H5V5h14m0-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-4.86 8.86l-3 3.87L9 13.14 6 17h12l-3.86-5.14z',
  code: 'M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z',
  keyboard: 'M20 7v10H4V7h16m0-2H4c-1.1 0-1.99.9-1.99 2L2 17c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm-9 3h2v2h-2zm0 3h2v2h-2zM8 8h2v2H8zm0 3h2v2H8zm-3 0h2v2H5zm0-3h2v2H5zm3 6h8v2H8zm6-3h2v2h-2zm0-3h2v2h-2zm3 3h2v2h-2zm0-3h2v2h-2z',
  panl: 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 19H5V5h4v14zm10 0h-8V5h8v14z',
  panr: 'M5 3h14c1.1 0 2 .9 2 2v14c0 1.1-.9 2-2 2H5c-1.1 0-2-.9-2-2V5c0-1.1.9-2 2-2zm10 16h4V5h-4v14zM5 19h8V5H5v14z',
  select: 'M6 3.5v15.2l4-3.9 2.6 5.9 2.7-1.2-2.6-5.8h5.6z',
  hand: 'M23 5.5V20c0 2.2-1.8 4-4 4h-7.3c-1.08 0-2.1-.43-2.85-1.19L1 14.83s1.26-1.23 1.3-1.25c.22-.19.49-.29.79-.29.22 0 .42.06.6.16.04.01 4.31 2.46 4.31 2.46V4c0-.83.67-1.5 1.5-1.5S11 3.17 11 4v7h1V1.5c0-.83.67-1.5 1.5-1.5S15 .67 15 1.5V11h1V2.5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5V11h1V5.5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5z',
  connector: 'M9 5v2h6.59L4 18.59 5.41 20 17 8.41V15h2V5z',
  zout: 'M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14zM7 9h5v1H7z',
  zin: 'M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14zM12 10h-2v2H9v-2H7V9h2V7h1v2h2v1z',
  fit: 'M17 4h3c1.1 0 2 .9 2 2v2h-2V6h-3V4zM4 8V6h3V4H4c-1.1 0-2 .9-2 2v2h2zm16 8v2h-3v2h3c1.1 0 2-.9 2-2v-2h-2zM7 18H4v-2H2v2c0 1.1.9 2 2 2h3v-2zM16 8H8c-.55 0-1 .45-1 1v6c0 .55.45 1 1 1h8c.55 0 1-.45 1-1V9c0-.55-.45-1-1-1zm-1 6H9v-4h6v4z',
  copy: 'M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z',
  paste: 'M19 2h-4.18C14.4.84 13.3 0 12 0c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm7 18H5V4h2v3h10V4h2v16z',
  dupe: 'M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H8V4h12v12zm-7-2h2v-3h3V9h-3V6h-2v3h-3v2h3z',
  del: 'M16 9v10H8V9h8m-1.5-6h-5l-1 1H5v2h14V4h-3.5l-1-1zM18 7H6v12c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7z',
  front: 'M3 13h2v-2H3v2zm0 4h2v-2H3v2zm2 4v-2H3c0 1.1.89 2 2 2zM3 9h2V7H3v2zm12 12h2v-2h-2v2zm4-18H9c-1.11 0-2 .9-2 2v10c0 1.1.89 2 2 2h10c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 12H9V5h10v10zm-8 6h2v-2h-2v2zm-4 0h2v-2H7v2z',
  back: 'M9 7H7v2h2V7zm0 4H7v2h2v-2zm0-8c-1.11 0-2 .9-2 2h2V3zm4 12h-2v2h2v-2zm6-12v2h2c0-1.1-.9-2-2-2zm-6 0h-2v2h2V3zM9 17v-2H7c0 1.1.89 2 2 2zm10-4h2v-2h-2v2zm0-4h2V7h-2v2zm0 8c1.1 0 2-.9 2-2h-2v2zM5 7H3v12c0 1.1.89 2 2 2h12v-2H5V7zm10-2h2V3h-2v2zm0 12h2v-2h-2v2z',
  search: 'M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
  close: 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
};
// one fill-based 24px icon; evenodd keeps cut-outs open
const fillIcon = (d, size = 20) => { const s = sv('svg', { viewBox: '0 0 24 24', width: size, height: size, fill: 'currentColor', 'aria-hidden': 'true', class: 'ms' }); s.append(sv('path', { d, 'fill-rule': 'evenodd' })); return s; };
const icon = (name, size = 20) => fillIcon(ICONS[name] || ICONS.newdoc, size);

const app = $('#app');
const toolbar = h('div', { class: 'toolbar' });
const left = h('div', { class: 'sidebar', style: 'width:232px' });
const stage = h('div', { class: 'stage', style: 'overflow:hidden;position:relative;padding:0;cursor:default' });
const right = h('div', { class: 'sidebar right', style: 'width:256px' });
const status = h('div', { class: 'status' });
app.append(toolbar, h('div', { class: 'main', style: 'flex:1;min-height:0;min-width:0;width:100%;overflow:hidden' }, left, stage, right), status);
const btn = (label, fn, cls = '') => h('button', { class: 'btn ' + cls, onclick: fn, text: label });
// top-bar button: our own fill icon (data-for tells kit.js not to add its line icon) + a label kit.js hides unless "Aa" is on
function tbtn(label, ic, fn, cls = '', tip = label) {
  const b = h('button', { class: 'btn ' + cls, onclick: fn, title: tip, 'aria-label': label });
  const i = icon(ic, 20); i.classList.add('ic'); i.dataset.for = label; b.append(i, document.createTextNode(label)); return b;
}
// editable diagram name in the top bar (like NotebookLM): Enter keeps it, Escape puts the old name back
// one name edit is one undo step: titleSnap is the diagram when editing started
let titleOld = null, titleSnap = null;
function titleDone() { if (titleSnap !== null && snapshot() !== titleSnap) commit(titleSnap); titleOld = null; titleSnap = null; renderStatus(); }
const titleInput = h('input', { type: 'text', class: 'tbtitle', maxlength: 120, title: 'Diagram name', 'aria-label': 'Diagram name', placeholder: 'Untitled',
  onfocus: () => { if (titleOld === null) { titleOld = doc.title || ''; titleSnap = snapshot(); } }, onblur: () => { if (document.hasFocus()) titleDone(); },
  oninput: (e) => { doc.title = e.target.value; renderStatus(); },
  onchange: (e) => { if (!e.target.value.trim()) { doc.title = 'Untitled'; e.target.value = doc.title; } },
  onkeydown: (e) => {
    e.stopPropagation();
    if ((e.ctrlKey || e.metaKey) && !e.altKey && ['s', 'o'].includes(e.key.toLowerCase())) { e.preventDefault(); const k = e.key.toLowerCase(); e.target.blur(); if (k === 's') saveDoc(); else openDoc(); return; }
    if (e.key === 'Enter') e.target.blur();
    if (e.key === 'Escape') { if (titleOld !== null) doc.title = titleOld; e.target.value = doc.title; e.target.blur(); }
  } });
// a click anywhere else (the floating bars keep focus on purpose) ends editing the name, so keys go to the canvas again
document.addEventListener('pointerdown', (e) => { if (document.activeElement === titleInput && e.target !== titleInput) titleInput.blur(); }, true);
function syncTitle() { if (document.activeElement !== titleInput) titleInput.value = doc.title || ''; }
// small menus (Export) anchored under a button; Esc, an outside click or focus leaving closes them
let fly = null, flyAnchor = null;
function closeFly(refocus) { if (fly) { fly.remove(); fly = null; } const a = flyAnchor; flyAnchor = null; if (refocus && a && a.isConnected) a.focus(); }
function openMenu(anchor, id, items, kb) {
  const was = fly && fly.dataset.g === 'menu:' + id; closeFly(); if (was) return;
  fly = h('div', { class: 'fly menu', role: 'menu', 'data-g': 'menu:' + id });
  for (const [ic, label, fn] of items) fly.append(h('button', { class: 'fi', role: 'menuitem', onclick: () => { closeFly(); fn(); } }, icon(ic, 20), h('span', { class: 'fl', text: label })));
  fly.style.position = 'fixed'; document.body.append(fly);
  const r = anchor.getBoundingClientRect(), w = fly.offsetWidth;
  fly.style.top = (r.bottom + 6) + 'px'; fly.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.right - w)) + 'px';
  flyAnchor = anchor; if (kb) fly.classList.add('kb'); fly.querySelector('.fi').focus();
}
document.addEventListener('pointerdown', (e) => { if (fly && !fly.contains(e.target) && !e.target.closest('[data-menu]')) closeFly(); }, true);
document.addEventListener('focusin', (e) => { if (fly && !fly.contains(e.target) && !e.target.closest('[data-menu]')) closeFly(); });
document.addEventListener('keydown', (e) => {
  if (!fly) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeFly(true); return; }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { const l = [...fly.querySelectorAll('.fi')], i = l.indexOf(document.activeElement); l[(i + (e.key === 'ArrowDown' ? 1 : l.length - 1)) % l.length].focus(); fly.classList.add('kb'); e.preventDefault(); e.stopPropagation(); }
}, true);
const exportBtn = tbtn('Export', 'download', (e) => openMenu(e.currentTarget, 'export', [['image', 'Export PNG', () => exportImg('png')], ['code', 'Export SVG', () => exportImg('svg')]], e.detail === 0), '', 'Export as a picture');
exportBtn.dataset.menu = 'export'; exportBtn.setAttribute('aria-haspopup', 'menu');
toolbar.append(titleInput, h('span', { class: 'grow' }),
  tbtn('New', 'newdoc', newDoc, '', 'New diagram'), tbtn('Open', 'open', openDoc, '', 'Open a file (Ctrl+O)'),
  tbtn('Undo', 'undo', undo, '', 'Undo (Ctrl+Z)'), tbtn('Redo', 'redo', redo, '', 'Redo (Ctrl+Y)'),
  exportBtn, tbtn('Keyboard shortcuts', 'keyboard', () => showHelp(), '', 'Keyboard shortcuts (?)'),
  tbtn('Templates', 'templates', openTemplates, 'primary tonal', 'Start from a template'), tbtn('Save', 'save', saveDoc, 'primary', 'Save (Ctrl+S)'));

// floating toolbars on the canvas: tools and zoom at the bottom, selection actions at the top
// (mouse clicks on them keep the keyboard focus where it was, so Delete and the other keys keep working)
const dk = (ic, label, key, fn) => h('button', { class: 'dk', title: label + (key ? ' (' + key + ')' : ''), 'aria-label': label, onclick: fn, onpointerdown: (e) => e.preventDefault() }, icon(ic, 20));
const bSelect = dk('select', 'Select', 'V', () => setTool('select'));
const bConn = dk('connector', 'Connector', 'C', () => setTool('connect'));
const bPan = dk('hand', 'Hand', 'H', () => setTool('pan'));
const zoomPct = h('button', { class: 'zk zpct', title: 'Zoom to 100%', 'aria-label': 'Zoom to 100%', onclick: () => { zoomBy(1 / zoom); zoom = 1; applyView(); }, onpointerdown: (e) => e.preventDefault(), text: '100%' });
const dock = h('div', { class: 'dock', role: 'toolbar', 'aria-label': 'Canvas tools' },
  h('div', { class: 'dg' }, bSelect, bConn, bPan),
  h('div', { class: 'dg' }, dk('zout', 'Zoom out', '', () => zoomBy(1 / 1.2)), zoomPct, dk('zin', 'Zoom in', '', () => zoomBy(1.2)), dk('fit', 'Fit to screen', '', () => fit())));
const SB = { copy: dk('copy', 'Copy', 'Ctrl+C', () => copy()), paste: dk('paste', 'Paste', 'Ctrl+V', () => paste()), dupe: dk('dupe', 'Duplicate', 'Ctrl+D', () => dupe()), del: dk('del', 'Delete', 'Del', () => del()),
  front: dk('front', 'Bring to front', '', () => order(1)), back: dk('back', 'Send to back', '', () => order(-1)) };
const selbar = h('div', { class: 'selbar', role: 'toolbar', 'aria-label': 'Selection' }, h('div', { class: 'dg' }, SB.copy, SB.paste, SB.dupe, SB.del), h('div', { class: 'dg' }, SB.front, SB.back));
function refreshSel() {
  const shapes = doc.shapes.some((s) => sel.has(s.id)), any = shapes || doc.edges.some((e) => sel.has(e.id));
  for (const k of ['copy', 'dupe', 'front', 'back']) SB[k].disabled = !shapes;
  SB.del.disabled = !any; SB.paste.disabled = !clip;
}
function setTool(t) {
  tool = t; [[bSelect, 'select'], [bConn, 'connect'], [bPan, 'pan']].forEach(([b, k]) => { b.classList.toggle('on', k === t); b.setAttribute('aria-pressed', k === t ? 'true' : 'false'); });
  stage.style.cursor = t === 'pan' ? 'grab' : t === 'connect' ? 'crosshair' : 'default';
}
setTool('select');
// NotebookLM-style panel header: title + a round button that folds the panel away (the kit.js grip brings it back)
function phead(title, side) {
  const hide = 'Hide ' + title.toLowerCase() + ' panel';
  return h('div', { class: 'phead' }, h('h2', { class: 'ptitle', text: title }),
    h('button', { class: 'pbtn', title: hide, 'aria-label': hide, onclick: () => { if (window.lkPanel) window.lkPanel(side); } }, icon(side === 'left' ? 'panl' : 'panr', 20)));
}

// left panel: shape libraries as chips, plus a search over all of them
let shapeCat = 'Flowchart', shapeQ = '';
const searchIn = h('input', { type: 'search', class: 'ssearch', placeholder: 'Search shapes', 'aria-label': 'Search shapes', oninput: (e) => { shapeQ = e.target.value; renderShapes(); },
  onkeydown: (e) => { if (e.key === 'Escape' && e.target.value) { e.target.value = ''; shapeQ = ''; renderShapes(); e.stopPropagation(); } } });
const chips = h('div', { class: 'chips', role: 'tablist', 'aria-label': 'Shape libraries' });
const shapeList = h('div', { class: 'shapes' });
left.append(phead('Shapes', 'left'), h('label', { class: 'sbox' }, icon('search', 20), searchIn), chips, shapeList);
function shapeCard(k, n) {
  const prev = sv('svg', { viewBox: '0 0 60 40', width: 60, height: 40, 'aria-hidden': 'true' });
  prev.append(shapeEl({ type: k, x: 5, y: 5, w: 50, h: 30, preview: 1, fill: '#d0d0d0', stroke: '#8a8a8a', text: '', fs: 10 }, true));
  const c = h('button', { class: 'scard', draggable: 'true', title: n + ': click to add, or drag onto the canvas', 'aria-label': 'Add ' + n, onclick: (e) => { addShape(k); if (e.detail > 0) c.blur(); } }, prev, h('span', { text: n }));
  c.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', 'shape:' + k));
  c.addEventListener('dragend', () => c.blur());
  return c;
}
function renderShapes() {
  const q = shapeQ.trim().toLowerCase();
  chips.textContent = '';
  for (const [g] of LIBS) { const on = g === shapeCat && !q; chips.append(h('button', { class: 'chip' + (on ? ' on' : ''), role: 'tab', 'aria-selected': on ? 'true' : 'false', onclick: () => { shapeCat = g; searchIn.value = ''; shapeQ = ''; renderShapes(); }, text: g })); }
  shapeList.textContent = '';
  const groups = q ? LIBS.map(([g, l]) => [g, l.filter(([k, n]) => n.toLowerCase().includes(q) || k.includes(q))]).filter(([, l]) => l.length) : LIBS.filter(([g]) => g === shapeCat);
  if (!groups.length) shapeList.append(h('div', { class: 'muted sempty', text: 'No shapes match "' + shapeQ.trim() + '".' }));
  for (const [g, list] of groups) { if (q) shapeList.append(h('h3', { text: g })); shapeList.append(h('div', { class: 'sgrid' }, list.map(([k, n]) => shapeCard(k, n)))); }
}
renderShapes();

// canvas
const svg = sv('svg', { width: '100%', height: '100%', style: 'display:block;touch-action:none' });
const defs = sv('defs');
defs.innerHTML = '<marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="context-stroke"/></marker><pattern id="gridp" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="#2f3133" stroke-width="0.6"/></pattern>';
const world = sv('g');
const gridRect = sv('rect', { x: -2000, y: -2000, width: 4000, height: 4000, fill: 'url(#gridp)' });
const gShapes = sv('g'), gEdges = sv('g'), gUI = sv('g');
world.append(gridRect, gEdges, gShapes, gUI);
svg.append(defs, world);
stage.append(svg, selbar, dock);
stage.ondragover = (e) => e.preventDefault();
stage.ondrop = (e) => { e.preventDefault(); const d = e.dataTransfer.getData('text/plain'); if (d.startsWith('shape:')) { const p = toWorld(e); addShape(d.slice(6), p.x, p.y); } };

const toWorld = (e) => { const r = svg.getBoundingClientRect(); return { x: (e.clientX - r.left - panX) / zoom, y: (e.clientY - r.top - panY) / zoom }; };
const sn = (v) => (snap ? Math.round(v / 10) * 10 : v);
const ZMIN = 0.01, ZMAX = 5;
function applyView() {
  world.setAttribute('transform', `translate(${panX} ${panY}) scale(${zoom})`);
  // the grid covers just the visible area (so it follows far pans), and is hidden when zoomed out so far that it would be a blur
  const show = grid && zoom >= 0.2; gridRect.style.display = show ? '' : 'none';
  if (show) { const r = svg.getBoundingClientRect(), x = Math.floor(-panX / zoom / 20) * 20 - 40, y = Math.floor(-panY / zoom / 20) * 20 - 40;
    gridRect.setAttribute('x', x); gridRect.setAttribute('y', y); gridRect.setAttribute('width', Math.ceil((r.width || 2000) / zoom) + 80); gridRect.setAttribute('height', Math.ceil((r.height || 2000) / zoom) + 80); }
  renderStatus();
}
function zoomBy(f, cx, cy) { const r = svg.getBoundingClientRect(); cx = cx ?? r.width / 2; cy = cy ?? r.height / 2; const nz = clamp(zoom * f, Math.min(ZMIN, zoom), ZMAX); panX = cx - (cx - panX) * (nz / zoom); panY = cy - (cy - panY) * (nz / zoom); zoom = nz; applyView(); }
const FIT = { top: 68, bottom: 76, side: 40 }; // keeps fitted shapes clear of the selection bar (top) and the dock (bottom)
function fit() {
  if (!doc.shapes.length) { zoom = 1; panX = FIT.side; panY = FIT.top; applyView(); return; }
  const b = bounds(doc.shapes); const r = svg.getBoundingClientRect(); const ih = r.height - FIT.top - FIT.bottom;
  zoom = clamp(Math.min((r.width - FIT.side * 2) / Math.max(1, b.w), ih / Math.max(1, b.h)), ZMIN, 2);
  panX = (r.width - b.w * zoom) / 2 - b.x * zoom; panY = FIT.top + (ih - b.h * zoom) / 2 - b.y * zoom; applyView();
}
// a plain loop: Math.min(...list) runs out of stack on very large diagrams
const bounds = (list) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const s of list) { if (s.x < x0) x0 = s.x; if (s.y < y0) y0 = s.y; if (s.x + s.w > x1) x1 = s.x + s.w; if (s.y + s.h > y1) y1 = s.y + s.h; } return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; };

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
// word and letter breaks that also work for Thai (no spaces between words) and keep marks with their letter
const segWord = Intl.Segmenter ? new Intl.Segmenter('th', { granularity: 'word' }) : null;
const segChar = Intl.Segmenter ? new Intl.Segmenter('th', { granularity: 'grapheme' }) : null;
const words = (t) => (segWord ? [...segWord.segment(t)].map((x) => x.segment) : t.split(/(\s+)/).filter(Boolean));
const letters = (t) => (segChar ? [...segChar.segment(t)].map((x) => x.segment) : [...t]);
function wrap(text, maxW, fs) {
  meas.font = `${fs}px Segoe UI, Arial, sans-serif`;
  const fits = (t) => meas.measureText(t).width <= maxW;
  const out = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const wd of words(para)) {
      if (fits(line + wd)) { line += wd; continue; }
      if (!wd.trim()) { out.push(line); line = ''; continue; } // break at a space and drop it
      if (line.trim()) out.push(line.replace(/\s+$/, ''));
      line = '';
      if (fits(wd)) { line = wd; continue; }
      for (const c of letters(wd)) { if (line && !fits(line + c)) { out.push(line); line = c; } else line += c; } // a word longer than the line
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
function edgePath(e, shapes = doc.shapes) {
  const a = shapes.find((s) => s.id === e.from), b = shapes.find((s) => s.id === e.to); if (!a || !b) return null;
  const ca = centerOf(a), cb = centerOf(b);
  if (e.kind === 'ortho') {
    const vgap = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h)), hgap = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
    const horiz = (hgap > 0 && vgap <= 0) || (hgap > 0 && vgap > 0 && hgap > vgap) || (hgap <= 0 && vgap <= 0 && Math.abs(cb.x - ca.x) > Math.abs(cb.y - ca.y));
    const mx = hgap > 0 ? (cb.x > ca.x ? (a.x + a.w + b.x) / 2 : (b.x + b.w + a.x) / 2) : (ca.x + cb.x) / 2;
    const my = vgap > 0 ? (cb.y > ca.y ? (a.y + a.h + b.y) / 2 : (b.y + b.h + a.y) / 2) : (ca.y + cb.y) / 2;
    const mid = horiz ? [{ x: mx, y: ca.y }, { x: mx, y: cb.y }] : [{ x: ca.x, y: my }, { x: cb.x, y: my }];
    const p0 = edgePoint(a, mid[0]), p3 = edgePoint(b, mid[1]);
    return { d: `M${p0.x} ${p0.y}L${mid[0].x} ${mid[0].y}L${mid[1].x} ${mid[1].y}L${p3.x} ${p3.y}`, label: (mid[0].x === mid[1].x && mid[0].y === mid[1].y) || Math.hypot(mid[1].x - mid[0].x, mid[1].y - mid[0].y) > 24 ? { x: (mid[0].x + mid[1].x) / 2, y: (mid[0].y + mid[1].y) / 2 } : { x: (mid[1].x + p3.x) / 2, y: (mid[1].y + p3.y) / 2 } };
  }
  const p0 = edgePoint(a, cb), p1 = edgePoint(b, ca);
  return { d: `M${p0.x} ${p0.y}L${p1.x} ${p1.y}`, label: { x: p0.x + (p1.x - p0.x) * 0.5, y: p0.y + (p1.y - p0.y) * 0.5 } };
}

// ---------- render ----------
// keepPanel: redraw the canvas but leave the Details panel alone (so a slider being dragged keeps working)
function render(keepPanel = false) {
  gShapes.textContent = ''; gEdges.textContent = ''; gUI.textContent = '';
  for (const e of doc.edges) {
    const p = edgePath(e); if (!p) continue;
    const g = sv('g'); g.dataset.id = e.id; g.dataset.kind = 'edge';
    g.append(sv('path', { d: p.d, fill: 'none', stroke: 'transparent', 'stroke-width': 12 }));
    const ep = sv('path', { d: p.d, fill: 'none', stroke: sel.has(e.id) ? '#a8c7fa' : e.stroke || '#9a9a9a', 'stroke-width': sel.has(e.id) ? 2.6 : 1.8, 'marker-end': e.arrow === 'none' ? '' : 'url(#arr)', 'stroke-dasharray': e.dash ? '6 4' : '' }); if (sel.has(e.id)) ep.dataset.sel = e.stroke || '#9a9a9a'; g.append(ep);
    if (e.label) {
      meas.font = '12px Segoe UI, Arial, sans-serif'; const w = Math.ceil(meas.measureText(e.label).width) + 14;
      g.append(sv('rect', { x: p.label.x - w / 2, y: p.label.y - 10, width: w, height: 20, fill: '#262626', rx: 3 }));
      const t = sv('text', { x: p.label.x, y: p.label.y, 'text-anchor': 'middle', 'dominant-baseline': 'central', fill: '#d6d6d6', 'font-size': 12, 'font-family': 'Segoe UI, Arial, sans-serif' }); t.textContent = e.label; g.append(t);
    }
    gEdges.append(g);
  }
  for (const s of doc.shapes) {
    const g = shapeEl(s); g.dataset.id = s.id; g.dataset.kind = 'shape';
    if (sel.has(s.id)) g.append(sv('rect', { x: s.x - 3, y: s.y - 3, width: s.w + 6, height: s.h + 6, fill: 'none', stroke: '#a8c7fa', 'stroke-width': 1.5, 'stroke-dasharray': '4 3', 'data-sel': '1', 'pointer-events': 'none' }));
    gShapes.append(g);
  }
  drawHandles();
  applyView(); if (!keepPanel) renderRight(); renderStatus(); syncTitle(); refreshSel();
}
function drawHandles() {
  const ss = doc.shapes.filter((s) => sel.has(s.id)); if (ss.length !== 1) return;
  const s = ss[0];
  const pts = { nw: [s.x, s.y], n: [s.x + s.w / 2, s.y], ne: [s.x + s.w, s.y], e: [s.x + s.w, s.y + s.h / 2], se: [s.x + s.w, s.y + s.h], s: [s.x + s.w / 2, s.y + s.h], sw: [s.x, s.y + s.h], w: [s.x, s.y + s.h / 2] };
  const cur = { nw: 'nwse', se: 'nwse', ne: 'nesw', sw: 'nesw', n: 'ns', s: 'ns', e: 'ew', w: 'ew' };
  for (const [k, [px, py]] of Object.entries(pts)) { const r = sv('rect', { x: px - 4 / zoom, y: py - 4 / zoom, width: 8 / zoom, height: 8 / zoom, fill: '#ffffff', stroke: '#0b57d0', 'stroke-width': 1.5 / zoom, style: `cursor:${cur[k]}-resize` }); r.dataset.handle = k; gUI.append(r); }
}
function renderStatus() {
  status.textContent = '';
  status.append(h('span', { text: fileName || 'Not saved yet' }), isDirty() ? h('span', { class: 'muted', text: 'Unsaved changes' }) : null, h('span', { class: 'grow' }), h('span', { text: `${doc.shapes.length} shapes, ${doc.edges.length} connectors` }), h('span', { text: Math.round(zoom * 100) + '%' }));
  zoomPct.textContent = Math.round(zoom * 100) + '%';
}
function renderRight() {
  const keep = right.scrollTop;
  right.textContent = '';
  right.append(phead('Details', 'right'));
  const items = [...sel].map((id) => doc.shapes.find((s) => s.id === id) || doc.edges.find((e) => e.id === id)).filter(Boolean);
  const canvasSec = () => right.append(h('h3', { text: 'Canvas' }),
    h('label', { class: 'row chk' }, h('input', { type: 'checkbox', checked: grid, onchange: (e) => { grid = e.target.checked; render(); } }), 'Show grid'),
    h('label', { class: 'row chk' }, h('input', { type: 'checkbox', checked: snap, onchange: (e) => { snap = e.target.checked; } }), 'Snap to grid'));
  if (!items.length) {
    right.append(h('div', { class: 'pnote', text: 'Select a shape or connector to change it.' }), h('h3', { text: 'Tips' }),
      h('ul', { class: 'tips' }, ['Click or drag a shape from the left to add it.', 'Use Connector to draw lines between shapes.', 'Double-click a shape to type text.', 'Hold Space and drag to pan.'].map((t) => h('li', { text: t }))));
    canvasSec(); right.scrollTop = keep; return;
  }
  const shapes = items.filter((i) => i.type), edges = items.filter((i) => i.from);
  right.append(h('div', { class: 'pnote', text: items.length === 1 ? (shapes.length ? 'One shape selected' : 'One connector selected') : items.length + ' items selected' }));
  if (shapes.length) {
    right.append(h('h3', { text: 'Fill' }));
    right.append(h('div', { class: 'swatches' }, FILLS.map((c) => h('button', { style: `background:${c}`, title: 'Fill ' + c, 'aria-label': 'Fill ' + c, class: shapes.every((s) => s.fill === c) ? 'on' : '', onclick: () => { edit(() => shapes.forEach((s) => (s.fill = c))); style.fill = c; } }))));
    right.append(h('h3', { text: 'Outline' }), h('div', { class: 'swatches' }, ['#3a3a3a', '#8a8a8a', '#d0d0d0', '#ffffff'].map((c) => h('button', { style: `background:${c}`, title: 'Outline ' + c, 'aria-label': 'Outline ' + c, class: shapes.every((s) => s.stroke === c) ? 'on' : '', onclick: () => edit(() => shapes.forEach((s) => (s.stroke = c))) }))));
    // one undo step per drag (or per key press); the panel is not rebuilt while the slider moves
    let fsBefore = null;
    const fs = h('input', { type: 'range', min: 8, max: 48, value: shapes[0].fs, 'aria-label': 'Text size',
      oninput: () => { if (fsBefore === null) fsBefore = snapshot(); shapes.forEach((s) => (s.fs = +fs.value)); render(true); },
      onchange: () => { if (fsBefore !== null && snapshot() !== fsBefore) commit(fsBefore); fsBefore = null; } });
    right.append(h('h3', { text: 'Text size' }), fs);
    right.append(h('h3', { text: 'Size' }), h('div', { class: 'row' }, numField('W', shapes[0].w, (v) => shapes.forEach((s) => (s.w = v))), numField('H', shapes[0].h, (v) => shapes.forEach((s) => (s.h = v)))));
    right.append(h('h3', { text: 'Align' }), h('div', { class: 'pgrid3' }, ['Left', 'Center', 'Right', 'Top', 'Middle', 'Bottom'].map((a) => btn(a, () => align(a.toLowerCase()), 'tonal'))), h('div', { class: 'pgrid2' }, btn('Distribute H', () => distribute('x'), 'tonal'), btn('Distribute V', () => distribute('y'), 'tonal')));
  }
  if (edges.length) {
    right.append(h('h3', { text: 'Connector' }),
      h('div', { class: 'col' }, btn('Straight / Elbow', () => edit(() => edges.forEach((e) => (e.kind = e.kind === 'ortho' ? 'line' : 'ortho'))), 'tonal'), btn('Dashed', () => edit(() => edges.forEach((e) => (e.dash = !e.dash))), 'tonal'), btn('Arrow on/off', () => edit(() => edges.forEach((e) => (e.arrow = e.arrow === 'none' ? 'end' : 'none'))), 'tonal'), btn('Edit label', () => editLabel(edges[0]), 'tonal')));
  }
  canvasSec(); right.scrollTop = keep;
}
const SIZE_MIN = 10, SIZE_MAX = 10000;
// a size box: a number from 10 to 10000; anything else puts the old value back
function numField(label, val, set) { const i = h('input', { type: 'number', min: SIZE_MIN, max: SIZE_MAX, value: Math.round(val), style: 'width:70px', onchange: () => { const v = Math.round(+i.value); if (i.value.trim() === '' || !isFinite(v)) { render(); return; } edit(() => set(clamp(v, SIZE_MIN, SIZE_MAX))); } }); return h('label', { class: 'field' }, label, i); }

// ---------- editing ----------
function addShape(type, x, y) {
  const r = svg.getBoundingClientRect();
  const cx = x ?? ((r.width / 2 - panX) / zoom - 60), cy = y ?? ((r.height / 2 - panY) / zoom - 35);
  commit();
  const s = { id: uid(), type, x: sn(cx), y: sn(cy), w: (SIZES[type] || [120, 70])[0], h: (SIZES[type] || [120, 70])[1], text: type === 'text' ? 'Text' : '', fill: type === 'text' ? 'none' : style.fill, stroke: style.stroke, fs: style.fs };
  if (type === 'class') s.text = 'ClassName'; if (type === 'state') s.text = 'State'; if (type === 'lifeline') s.text = 'Object'; if (type === 'package') s.text = 'package'; if (type === 'interface') s.text = '<<interface>>';
  doc.shapes.push(s); sel = new Set([s.id]); render();
}
function del() { if (!sel.size) return; edit(() => { doc.shapes = doc.shapes.filter((s) => !sel.has(s.id)); const ids = new Set(doc.shapes.map((s) => s.id)); doc.edges = doc.edges.filter((e) => !sel.has(e.id) && ids.has(e.from) && ids.has(e.to)); sel.clear(); }); }
let pasteN = 0; // each Paste of the same copy lands a little further on, so copies do not pile up
function copy(quiet) { const ss = doc.shapes.filter((s) => sel.has(s.id)); if (!ss.length) return; const ids = new Set(ss.map((s) => s.id)); clip = JSON.stringify({ shapes: ss, edges: doc.edges.filter((e) => ids.has(e.from) && ids.has(e.to)) }); pasteN = 0; refreshSel(); if (!quiet) toast('Copied'); }
function paste(offset) {
  if (!clip) return; const c = JSON.parse(clip); const map = {}; commit(); sel.clear();
  if (offset === undefined) { pasteN++; offset = 30 * pasteN; }
  for (const s of c.shapes) { const id = uid(); map[s.id] = id; doc.shapes.push({ ...s, id, x: s.x + offset, y: s.y + offset }); sel.add(id); }
  for (const e of c.edges) doc.edges.push({ ...e, id: uid(), from: map[e.from], to: map[e.to] });
  render();
}
// Duplicate does not touch what Copy put on the clipboard
function dupe() { const keep = clip, n = pasteN; copy(true); if (clip === keep) return; paste(30); clip = keep; pasteN = n; refreshSel(); }
function order(dir) { const ss = doc.shapes.filter((s) => sel.has(s.id)); if (!ss.length) return; edit(() => { const rest = doc.shapes.filter((s) => !sel.has(s.id)); doc.shapes = dir > 0 ? [...rest, ...ss] : [...ss, ...rest]; }); }
function align(a) {
  const ss = doc.shapes.filter((s) => sel.has(s.id)); if (ss.length < 2) return; const before = snapshot(); const b = bounds(ss);
  for (const s of ss) { if (a === 'left') s.x = b.x; else if (a === 'right') s.x = b.x + b.w - s.w; else if (a === 'center') s.x = b.x + (b.w - s.w) / 2; else if (a === 'top') s.y = b.y; else if (a === 'bottom') s.y = b.y + b.h - s.h; else if (a === 'middle') s.y = b.y + (b.h - s.h) / 2; }
  if (snapshot() !== before) commit(before); render();
}
function distribute(axis) {
  const ss = doc.shapes.filter((s) => sel.has(s.id)).sort((a, b) => a[axis] - b[axis]); if (ss.length < 3) return; const before = snapshot();
  const size = axis === 'x' ? 'w' : 'h'; const first = ss[0][axis], last = ss[ss.length - 1][axis] + ss[ss.length - 1][size];
  const total = ss.reduce((t, s) => t + s[size], 0); const gap = (last - first - total) / (ss.length - 1); let pos = first;
  for (const s of ss) { s[axis] = pos; pos += s[size] + gap; }
  if (snapshot() !== before) commit(before); render();
}
// closes a dialog and gives focus back to the control that opened it (if it is still on the page)
function dlgCloser(back) { const opener = document.activeElement; return () => { back.remove(); if (opener && opener !== document.body && opener.isConnected) opener.focus(); }; }
function editText(s) {
  const ta = h('textarea', { rows: 4, style: 'width:300px' }); ta.value = s.text;
  const ok = () => { close(); edit(() => { s.text = ta.value; }); };
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); ok(); } });
  const back = h('div', { class: 'modal-back' }, h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Shape text' }, h('h2', { text: 'Shape text' }), ta, h('div', { class: 'msub', text: 'Ctrl+Enter to finish.' }), h('div', { class: 'row mact' }, btn('Cancel', () => close()), btn('OK', ok, 'primary'))));
  const close = dlgCloser(back); document.body.append(back); ta.focus(); ta.select();
}
function editLabel(e) {
  const i = h('input', { type: 'text', value: e.label || '', style: 'width:260px' });
  const ok = () => { close(); edit(() => { e.label = i.value.trim() ? i.value : ''; }); };
  i.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); ok(); } });
  const back = h('div', { class: 'modal-back' }, h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Connector label' }, h('h2', { text: 'Connector label' }), i, h('div', { class: 'row mact' }, btn('Cancel', () => close()), btn('OK', ok, 'primary'))));
  const close = dlgCloser(back); document.body.append(back); i.focus(); i.select();
}

// ---------- pointer interaction ----------
let drag = null, spaceDown = false;
svg.addEventListener('pointerdown', (ev) => {
  if (ev.button === 1 || tool === 'pan' || spaceDown) { drag = { mode: 'pan', sx: ev.clientX, sy: ev.clientY, px: panX, py: panY }; svg.setPointerCapture(ev.pointerId); stage.style.cursor = 'grabbing'; return; }
  const p = toWorld(ev);
  const hd = ev.target.dataset.handle;
  const node = ev.target.closest('[data-id]');
  // move and resize record their undo step only once the pointer really moves (a plain click changes nothing)
  if (hd) { const s = doc.shapes.find((x) => sel.has(x.id)); drag = { mode: 'resize', hd, s, o: { ...s }, p, cx: ev.clientX, cy: ev.clientY, before: snapshot(), moved: false }; svg.setPointerCapture(ev.pointerId); return; }
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
    drag = { mode: 'move', p, orig: moving.map((s) => ({ s, x: s.x, y: s.y })), cx: ev.clientX, cy: ev.clientY, before: snapshot(), moved: false }; svg.setPointerCapture(ev.pointerId);
  } else {
    if (!ev.shiftKey) sel.clear();
    const r = sv('rect', { fill: 'rgba(168,199,250,.12)', stroke: '#a8c7fa', 'stroke-dasharray': '4 3' }); gUI.append(r);
    drag = { mode: 'marquee', p, r, add: ev.shiftKey }; svg.setPointerCapture(ev.pointerId); render();
    gUI.append(r);
  }
});
svg.addEventListener('pointermove', (ev) => {
  if (!drag) return;
  if (drag.mode === 'pan') { panX = drag.px + ev.clientX - drag.sx; panY = drag.py + ev.clientY - drag.sy; applyView(); return; }
  const p = toWorld(ev);
  if ((drag.mode === 'move' || drag.mode === 'resize') && !drag.moved) { if (Math.hypot(ev.clientX - drag.cx, ev.clientY - drag.cy) <= 3) return; drag.moved = true; }
  if (drag.mode === 'move') { const dx = p.x - drag.p.x, dy = p.y - drag.p.y; for (const o of drag.orig) { o.s.x = sn(o.x + dx); o.s.y = sn(o.y + dy); } renderLive(); }
  else if (drag.mode === 'resize') {
    const { s, o, hd } = drag; const dx = p.x - drag.p.x, dy = p.y - drag.p.y;
    let { x, y, w, h: hh } = o;
    const lim = (v) => clamp(v, 20, SIZE_MAX);
    if (hd.includes('e')) w = lim(sn(o.w + dx)); if (hd.includes('s')) hh = lim(sn(o.h + dy));
    if (hd.includes('w')) { const nx = sn(o.x + dx); w = lim(o.w + (o.x - nx)); x = o.x + o.w - w; }
    if (hd.includes('n')) { const ny = sn(o.y + dy); hh = lim(o.h + (o.y - ny)); y = o.y + o.h - hh; }
    Object.assign(s, { x, y, w, h: hh }); renderLive();
  } else if (drag.mode === 'connect') {
    const a = doc.shapes.find((s) => s.id === drag.from); const c = centerOf(a);
    drag.line.setAttribute('x1', c.x); drag.line.setAttribute('y1', c.y); drag.line.setAttribute('x2', p.x); drag.line.setAttribute('y2', p.y);
  } else if (drag.mode === 'marquee') {
    const x = Math.min(p.x, drag.p.x), y = Math.min(p.y, drag.p.y), w = Math.abs(p.x - drag.p.x), hh = Math.abs(p.y - drag.p.y);
    drag.r.setAttribute('x', x); drag.r.setAttribute('y', y); drag.r.setAttribute('width', w); drag.r.setAttribute('height', hh); drag.box = { x, y, w, h: hh };
  }
});
function renderLive() { render(true); }
// finish a move or resize: keep one undo step if anything changed
function endDrag() { const d = drag; if (!d) return; drag = null; if ((d.mode === 'move' || d.mode === 'resize') && d.moved && snapshot() !== d.before) commit(d.before); if (d.line) d.line.remove(); if (d.r) d.r.remove(); }
svg.addEventListener('pointerup', (ev) => {
  if (!drag) return;
  const d = drag; endDrag(); stage.style.cursor = tool === 'pan' ? 'grab' : tool === 'connect' ? 'crosshair' : 'default';
  if (d.mode === 'connect') {
    d.line.remove(); const t = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-id]');
    const to = t && t.dataset.kind === 'shape' ? t.dataset.id : null;
    const dup = to && doc.edges.some((e) => e.from === d.from && e.to === to);
    if (dup) toast('These shapes are already connected.');
    if (to && to !== d.from && !dup) { commit(); const e = { id: uid(), from: d.from, to: t.dataset.id, kind: 'line', label: '', arrow: 'end', stroke: '#9a9a9a' }; doc.edges.push(e); sel = new Set([e.id]); }
    render();
  } else if (d.mode === 'marquee') {
    d.r.remove();
    if (d.box && d.box.w > 3) { for (const s of doc.shapes) if (s.x < d.box.x + d.box.w && s.x + s.w > d.box.x && s.y < d.box.y + d.box.h && s.y + s.h > d.box.y) sel.add(s.id); }
    render();
  } else if (d.mode === 'move' || d.mode === 'resize') render();
});
svg.addEventListener('pointercancel', () => { if (drag) { endDrag(); render(); } });
svg.addEventListener('lostpointercapture', () => { if (drag && (drag.mode === 'move' || drag.mode === 'resize')) { endDrag(); render(); } });
svg.addEventListener('dblclick', (ev) => {
  const node = ev.target.closest('[data-id]'); if (!node) return;
  if (node.dataset.kind === 'shape') editText(doc.shapes.find((s) => s.id === node.dataset.id));
  else editLabel(doc.edges.find((e) => e.id === node.dataset.id));
});
svg.addEventListener('wheel', (ev) => { ev.preventDefault(); const r = svg.getBoundingClientRect(); if (ev.ctrlKey || ev.metaKey) zoomBy(ev.deltaY < 0 ? 1.1 : 1 / 1.1, ev.clientX - r.left, ev.clientY - r.top); else { panX -= ev.deltaX; panY -= ev.deltaY; applyView(); } }, { passive: false });
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input,textarea,select,[contenteditable]') || document.querySelector('.modal-back')) return;
  // a focused button keeps Enter and Space for itself; every other shortcut still works
  if (e.target.matches('button') && (e.key === 'Enter' || e.key === ' ')) return;
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
  else if (e.key.startsWith('Arrow') && sel.size) { const d = e.shiftKey ? 10 : 1; const ss = doc.shapes.filter((s) => sel.has(s.id)); e.preventDefault(); if (!ss.length) return; if (!e.repeat) commit(); ss.forEach((s) => { if (e.key === 'ArrowLeft') s.x -= d; if (e.key === 'ArrowRight') s.x += d; if (e.key === 'ArrowUp') s.y -= d; if (e.key === 'ArrowDown') s.y += d; }); render(); e.preventDefault(); }
  else if (e.key === '?') showHelp();
  else if (k === 'v') setTool('select'); else if (k === 'c' && !e.ctrlKey) setTool('connect'); else if (k === 'h') setTool('pan');
});
document.addEventListener('keyup', (e) => { if (e.code === 'Space') spaceDown = false; });
window.addEventListener('blur', () => { spaceDown = false; });
// Tab stays inside the top dialog
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab') return; const backs = document.querySelectorAll('.modal-back'); if (!backs.length) return;
  const m = backs[backs.length - 1]; const f = [...m.querySelectorAll('button,input,textarea,select,[tabindex]:not([tabindex="-1"])')].filter((n) => !n.disabled && n.offsetParent !== null); if (!f.length) { e.preventDefault(); return; }
  const i = f.indexOf(document.activeElement);
  if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && (i === -1 || i === f.length - 1)) { e.preventDefault(); f[0].focus(); }
}, true);

// ---------- files ----------
function newDoc() { if (!okToDiscard('Discard the unsaved changes in this diagram?')) return; doc = { shapes: [], edges: [], title: 'Untitled' }; sel.clear(); undoS = []; savedSnap = snapshot(); redoS = []; fileName = ''; fit(); render(); }
async function openDoc() {
  if (!okToDiscard('Discard the unsaved changes in this diagram?')) return;
  let f; try { f = (await window.host.openFiles({ filters: [['Chartout diagram', ['chartout', 'json']]] }))[0]; } catch (e) { toast(cleanErr(e), 6000); return; }
  if (!f) return;
  let d; try { d = parseDoc(f.data); } catch (e) { toast(`Cannot open "${f.name}": ${e.message}`, 6000); return; }
  doc = d; fileName = f.name; sel.clear(); undoS = []; redoS = []; savedSnap = snapshot(); fit(); render();
}
const HEX = /^#[0-9a-f]{6}$/i;
const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : typeof v === 'string' && v.trim() && isFinite(+v) ? +v : d);
const POS = 1e6;
const plain = (t) => (typeof t === 'string' ? t : typeof t === 'number' ? String(t) : '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').slice(0, 5000);
const cleanShape = (s) => ({ id: String(s.id), type: SHAPES.some((x) => x[0] === s.type) ? s.type : 'process', x: clamp(num(s.x, 0), -POS, POS), y: clamp(num(s.y, 0), -POS, POS), w: clamp(num(s.w, 100), SIZE_MIN, SIZE_MAX), h: clamp(num(s.h, 60), SIZE_MIN, SIZE_MAX), text: plain(s.text), fill: HEX.test(s.fill) || s.fill === 'none' ? s.fill : '#ffffff', stroke: HEX.test(s.stroke) ? s.stroke : '#3a3a3a', fs: clamp(num(s.fs, 14), 6, 96) });
// read a .chartout file; anything odd in it is repaired or dropped, and a file that is not a diagram gives a plain message
function parseDoc(bytes) {
  const txt = new TextDecoder().decode(bytes).replace(/^\uFEFF/, '');
  if (!txt.trim()) throw new Error('the file is empty.');
  let d; try { d = JSON.parse(txt); } catch { throw new Error('this is not a Chartout diagram, or the file is damaged.'); }
  if (!d || typeof d !== 'object' || Array.isArray(d) || !Array.isArray(d.shapes) || (d.edges !== undefined && !Array.isArray(d.edges))) throw new Error('this is not a Chartout diagram, or the file is damaged.');
  const ids = new Set();
  const shapes = d.shapes.filter((s) => s && typeof s === 'object' && !Array.isArray(s)).map((s) => {
    const c = cleanShape(s); if (s.id === undefined || s.id === null || s.id === '' || ids.has(c.id) || typeof s.id === 'object') c.id = uid(); ids.add(c.id); return c; });
  const pairs = new Set(), eids = new Set(shapes.map((s) => s.id)), edges = [];
  for (const e of d.edges || []) {
    if (!e || typeof e !== 'object') continue;
    const from = String(e.from), to = String(e.to);
    if (!ids.has(from) || !ids.has(to) || from === to || pairs.has(from + '\u0000' + to)) continue;
    pairs.add(from + '\u0000' + to);
    let id = String(e.id ?? ''); if (!id || typeof e.id === 'object' || eids.has(id)) id = uid(); eids.add(id);
    const c = { id, from, to, kind: e.kind === 'ortho' ? 'ortho' : 'line', label: plain(e.label), arrow: e.arrow === 'none' ? 'none' : 'end', stroke: HEX.test(e.stroke) ? e.stroke : '#9a9a9a' };
    if (e.dash === true) c.dash = true; edges.push(c);
  }
  return { shapes, edges, title: plain(d.title).replace(/\n/g, ' ').trim().slice(0, 120) || 'Untitled' };
}
async function saveDoc() {
  // what is written is the diagram as it is now; changes made while the Save dialog is open stay unsaved
  const snap = snapshot(), data = new TextEncoder().encode(JSON.stringify(doc, null, 1));
  let r; try { r = await window.host.saveFile({ name: (doc.title || 'diagram') + '.chartout', filters: [['Chartout diagram', ['chartout']]], data }); }
  catch (e) { toast('Not saved. ' + cleanErr(e), 7000); renderStatus(); return; }
  if (r) { savedSnap = snap; fileName = r.name; toast('Saved ' + r.name); renderStatus(); }
}
function exportSvgString() {
  const b = doc.shapes.length ? bounds(doc.shapes) : { x: 0, y: 0, w: 200, h: 100 }; const pad = 30;
  const root = sv('svg', { xmlns: NS, width: b.w + pad * 2, height: b.h + pad * 2, viewBox: `${b.x - pad} ${b.y - pad} ${b.w + pad * 2} ${b.h + pad * 2}` });
  root.append(sv('rect', { x: b.x - pad, y: b.y - pad, width: b.w + pad * 2, height: b.h + pad * 2, fill: '#ffffff' }));
  const d2 = defs.cloneNode(true); d2.querySelector('#gridp')?.remove(); root.append(d2);
  const ge = gEdges.cloneNode(true); ge.querySelectorAll('path[stroke="transparent"]').forEach((n) => n.remove()); ge.querySelectorAll('rect[fill="#262626"]').forEach((n) => n.setAttribute('fill', '#ffffff')); ge.querySelectorAll('text').forEach((n) => n.setAttribute('fill', '#222')); ge.querySelectorAll('path[data-sel]').forEach((n) => { n.setAttribute('stroke', n.dataset.sel); n.setAttribute('stroke-width', 1.8); n.removeAttribute('data-sel'); });
  ge.querySelectorAll('path[stroke="#9a9a9a"], path[stroke="#ffffff"]').forEach((n) => n.setAttribute('stroke', '#555'));
  root.append(ge);
  const gs = gShapes.cloneNode(true); gs.querySelectorAll('rect[data-sel]').forEach((n) => n.remove());
  // a white outline would vanish on the white page
  gs.querySelectorAll('[stroke="#ffffff"]').forEach((n) => n.setAttribute('stroke', '#555555'));
  gs.querySelectorAll('text[fill="#e4e4e4"]').forEach((n) => n.setAttribute('fill', '#222'));
  root.append(gs);
  return { str: new XMLSerializer().serializeToString(root), w: b.w + pad * 2, h: b.h + pad * 2 };
}
async function exportImg(kind) {
  const { str, w, h: hh } = exportSvgString();
  try {
    if (kind === 'svg') { const r = await window.host.saveFile({ name: (doc.title || 'diagram') + '.svg', filters: [['SVG', ['svg']]], data: new TextEncoder().encode(str) }); if (r) toast('Saved ' + r.name); return; }
    const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(str);
    await img.decode();
    // twice the size for sharpness, but a big diagram is scaled down so the picture stays within what a canvas can hold
    const sc = Math.min(2, 16000 / w, 16000 / hh, Math.sqrt(100e6 / (w * hh)));
    const cv = document.createElement('canvas'); cv.width = Math.max(1, Math.floor(w * sc)); cv.height = Math.max(1, Math.floor(hh * sc)); const ctx = cv.getContext('2d'); ctx.scale(sc, sc); ctx.drawImage(img, 0, 0, w, hh);
    const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
    if (!blob) { toast('This diagram is too big for a PNG picture. Try SVG instead.', 6000); return; }
    const res = await window.host.saveFile({ name: (doc.title || 'diagram') + '.png', filters: [['PNG image', ['png']]], data: new Uint8Array(await blob.arrayBuffer()) });
    if (res) toast('Saved ' + res.name);
  } catch (e) { toast('Not exported. ' + cleanErr(e), 7000); }
}


// ---------- templates ----------
const TEMPLATES = [
  { name: 'Flowchart', nodes: [['a', 'terminator', 200, 20, 140, 50, 'Start'], ['b', 'process', 200, 110, 140, 70, 'Step one'], ['c', 'decision', 190, 220, 160, 100, 'OK?'], ['d', 'process', 440, 235, 140, 70, 'Fix'], ['e', 'terminator', 200, 370, 140, 50, 'End']], edges: [['a', 'b'], ['b', 'c'], ['c', 'd', 'No'], ['d', 'b'], ['c', 'e', 'Yes']] },
  { name: 'Org chart', nodes: [['a', 'rounded', 240, 20, 140, 60, 'Director'], ['b', 'rounded', 60, 150, 140, 60, 'Manager A'], ['c', 'rounded', 240, 150, 140, 60, 'Manager B'], ['d', 'rounded', 420, 150, 140, 60, 'Manager C'], ['e', 'process', 0, 280, 120, 50, 'Team 1'], ['f', 'process', 140, 280, 120, 50, 'Team 2'], ['g', 'process', 300, 280, 120, 50, 'Team 3'], ['h', 'process', 480, 280, 120, 50, 'Team 4']], edges: [['a', 'b', '', 'ortho'], ['a', 'c', '', 'ortho'], ['a', 'd', '', 'ortho'], ['b', 'e', '', 'ortho'], ['b', 'f', '', 'ortho'], ['c', 'g', '', 'ortho'], ['d', 'h', '', 'ortho']] },
  { name: 'UML class diagram', nodes: [['a', 'class', 220, 20, 170, 110, 'Animal'], ['b', 'class', 60, 220, 170, 110, 'Dog'], ['c', 'class', 380, 220, 170, 110, 'Cat'], ['d', 'interface', 620, 40, 160, 80, '<<interface>> Pet']], edges: [['b', 'a', 'extends', 'ortho'], ['c', 'a', 'extends', 'ortho'], ['a', 'd', 'implements', 'line', 1]] },
  { name: 'UML use case', nodes: [['a', 'actor', 20, 120, 60, 90, 'User'], ['b', 'usecase', 220, 40, 170, 70, 'Sign in'], ['c', 'usecase', 220, 150, 170, 70, 'Browse items'], ['d', 'usecase', 220, 260, 170, 70, 'Check out'], ['e', 'actor', 560, 150, 60, 90, 'Admin']], edges: [['a', 'b'], ['a', 'c'], ['a', 'd'], ['e', 'c']] },
  { name: 'UML sequence', nodes: [['a', 'lifeline', 40, 20, 110, 260, 'Client'], ['b', 'lifeline', 260, 20, 110, 260, 'Server'], ['c', 'lifeline', 480, 20, 110, 260, 'Database'], ['x', 'process', 90, 100, 10, 120, ''], ['y', 'process', 310, 115, 10, 90, ''], ['z', 'process', 530, 140, 10, 40, '']], edges: [['x', 'y', 'request'], ['y', 'z', 'query']] },
  { name: 'UML state machine', nodes: [['a', 'ellipse', 30, 90, 40, 40, ''], ['b', 'state', 130, 75, 130, 70, 'Idle'], ['c', 'state', 420, 75, 130, 70, 'Running'], ['d', 'state', 275, 250, 130, 70, 'Paused']], edges: [['a', 'b'], ['b', 'c', 'start'], ['c', 'd', 'pause'], ['d', 'b', 'stop']] },
  { name: 'Network topology', nodes: [['a', 'cloud', 240, 10, 140, 80, 'Internet'], ['b', 'firewall', 265, 130, 90, 80, 'Firewall'], ['c', 'router', 270, 260, 80, 80, 'Router'], ['d', 'netswitch', 260, 390, 100, 50, 'Switch'], ['e', 'server', 80, 500, 70, 90, 'Server'], ['f', 'laptop', 260, 510, 100, 70, 'Laptop'], ['g', 'laptop', 450, 510, 100, 70, 'Laptop']], edges: [['a', 'b'], ['b', 'c'], ['c', 'd'], ['d', 'e', '', 'ortho'], ['d', 'f'], ['d', 'g', '', 'ortho']] },
  { name: 'Circuit (RC + battery)', nodes: [['a', 'battery', 40, 120, 60, 50, 'V'], ['b', 'resistor', 180, 20, 100, 36, 'R1'], ['c', 'capacitor', 400, 120, 60, 50, 'C1'], ['d', 'ground', 240, 260, 40, 40, '']], edges: [['a', 'b', '', 'ortho'], ['b', 'c', '', 'ortho'], ['c', 'd', '', 'ortho'], ['a', 'd', '', 'ortho']] },
  { name: 'Swimlane process', nodes: [['l1', 'text', 10, 10, 120, 40, 'Customer'], ['l2', 'text', 10, 160, 120, 40, 'Sales'], ['l3', 'text', 10, 310, 120, 40, 'Fulfilment'], ['a', 'terminator', 160, 15, 130, 40, 'Order'], ['b', 'process', 160, 160, 130, 50, 'Review'], ['c', 'decision', 340, 140, 130, 90, 'In stock?'], ['d', 'process', 540, 165, 130, 50, 'Ship'], ['e', 'terminator', 540, 315, 130, 40, 'Done']], edges: [['a', 'b'], ['b', 'c'], ['c', 'd', 'Yes'], ['d', 'e']] },
  { name: 'Venn / relation', nodes: [['a', 'ellipse', 80, 60, 200, 150, 'Set A'], ['b', 'ellipse', 200, 60, 200, 150, 'Set B']], edges: [] },
];
function buildTemplate(t) {
  const map = {};
  const shapes = t.nodes.map(([k, type, x, y, w, hh, text]) => { const s = { id: uid(), type, x, y, w, h: hh, text, fill: type === 'text' ? 'none' : type === 'decision' ? '#e6e6e6' : '#ffffff', stroke: '#3a3a3a', fs: 14 }; if (['activation'].includes(type)) s.fill = '#e6e6e6'; if (t.name.startsWith('Venn') && k === 'b') { s.fill = 'none'; s.stroke = '#b0b0b0'; } if (['resistor', 'capacitor', 'inductor', 'battery', 'diode', 'ground', 'cswitch', 'actor'].includes(type)) s.stroke = '#c4c4c4'; map[k] = s.id; return s; });
  const edges = t.edges.map(([f, to, label = '', kind = 'line', dash]) => ({ id: uid(), from: map[f], to: map[to], kind, label, arrow: t.name.startsWith('Circuit') ? 'none' : 'end', stroke: '#9a9a9a', ...(dash ? { dash: true } : {}) }));
  return { shapes, edges, title: t.name };
}
function openTemplates() {
  if (document.querySelector('.modal-back.templates')) return;
  let close;
  const grid = h('div', { class: 'tgrid' });
  TEMPLATES.forEach((t) => {
    const d = buildTemplate(t); const b = bounds(d.shapes);
    const pv = sv('svg', { viewBox: `${b.x - 10} ${b.y - 10} ${b.w + 20} ${b.h + 20}`, 'aria-hidden': 'true', preserveAspectRatio: 'xMidYMid meet' });
    d.edges.forEach((e) => { const pd = edgePath(e, d.shapes); if (pd) pv.append(sv('path', { d: pd.d, fill: 'none', stroke: '#9a9a9a', 'stroke-width': 2, 'data-edge': '' })); });
    d.shapes.forEach((s) => { const prev = { ...s, text: '' }; pv.append(shapeEl(prev, true)); });
    const card = h('button', { class: 'tcard', title: 'Use the ' + t.name + ' template', onclick: () => { if (!okToDiscard('Discard the unsaved changes and use this template?')) return; commit(); doc = d; sel.clear(); close(); render(); fit(); } },
      h('div', { class: 'thumb' }, pv), h('div', { class: 'tname', text: t.name }), h('div', { class: 'tsub', text: d.shapes.length + ' shapes, ' + d.edges.length + ' connectors' }));
    grid.append(card);
  });
  const back = h('div', { class: 'modal-back templates', onclick: (e) => { if (e.target === back) close(); } },
    h('div', { class: 'modal wide', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Templates' }, h('h2', { text: 'Templates' }), h('div', { class: 'msub', text: 'Start from a ready-made diagram. It replaces the current one (Undo brings it back).' }), grid, h('div', { class: 'row mact' }, btn('Close', () => close()))));
  close = dlgCloser(back); document.body.append(back);
  grid.querySelector('.tcard').focus();
}
// ---------- help ----------
const SHORTCUTS = [
  ['Tools', [[['V'], 'Select'], [['C'], 'Connector'], [['H'], 'Hand (pan)'], [['Space'], 'Hold and drag to pan'], [['Esc'], 'Clear the selection']]],
  ['Edit', [[['Ctrl', 'Z'], 'Undo'], [['Ctrl', 'Y'], 'Redo'], [['Ctrl', 'C'], 'Copy'], [['Ctrl', 'V'], 'Paste'], [['Ctrl', 'D'], 'Duplicate'], [['Del'], 'Delete'], [['Ctrl', 'A'], 'Select all'], [['Arrows'], 'Move by 1 (Shift: 10)'], [['Shift', 'Click'], 'Add to the selection'], [['Double-click'], 'Edit text or label']]],
  ['File and view', [[['Ctrl', 'S'], 'Save'], [['Ctrl', 'O'], 'Open'], [['Scroll'], 'Pan'], [['Ctrl', 'Scroll'], 'Zoom'], [['?'], 'This list']]],
];
function showHelp() {
  if (document.querySelector('.modal-back.help')) return;
  let close;
  const keys = h('div', { class: 'keys' }, SHORTCUTS.map(([g, rows]) => h('div', { class: 'kgrp' }, h('h3', { text: g }),
    rows.map(([ks, what]) => h('div', { class: 'krow' }, h('span', { class: 'kk' }, ks.map((k) => h('kbd', { text: k }))), h('span', { text: what }))))));
  const back = h('div', { class: 'modal-back help', onclick: (e) => { if (e.target === back) close(); } },
    h('div', { class: 'modal wide', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Keyboard shortcuts' }, h('h2', { text: 'Keyboard shortcuts' }), keys, h('div', { class: 'row mact' }, btn('Close', () => close(), 'primary'))));
  close = dlgCloser(back); document.body.append(back);
  back.querySelector('.mact .btn').focus();
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

savedSnap = snapshot(); renderStatus();
// main.js asks "Close without saving?" when this blocks the close
window.addEventListener('beforeunload', (e) => { if (isDirty()) { e.preventDefault(); e.returnValue = ''; } });
