# Chartout: Google-style UI + full bug sweep

Spec: the user's standing request (Thai): "Fix every bug by trying hard to break the app. Make the UI look very much like
Google's own apps (NotebookLM, AI Studio, Gemini): bars, icons, layout, theme; decide which categories belong in the bar."
Then, after PDFout shipped with this treatment: "keep going" (Chartout is next). Rulings are provisional and logged in
D:/Lookout-apps/NOTES.md.

## Global Constraints

- App: D:/Lookout-apps/chartout (Electron, plain JS, no build step). Files: main.js, preload.js, renderer/index.html,
  renderer/kit.js, renderer/lookout.css (shared base), renderer/app.css, renderer/app.js.
- CSP in index.html stays: no external fonts, scripts or images. Icons are inline SVG (Material Symbols Outlined path
  data allowed, Apache-2.0).
- Dark theme, the Google dark tokens used by the newer family lookout.css (see D:/Lookout-apps/pdfout/renderer/lookout.css
  and D:/Lookout-apps/frameout/renderer/lookout.css; keep lookout.css identical to those if they are identical to each other).
- Do not change the .chartout file format in a way that breaks existing diagrams. App stays offline.
- UI text in plain English, short. No emoji.
- Test harness: D:/Lookout-apps/_tools/multi-main.js with env LK_APP, LK_STEPS, LK_LOG, LK_USERDATA (fresh dir under
  _tools/test/), LK_RESLEN, LK_OPEN (stubs Open dialog), LK_SAVE (stubs Save dialog), LK_MSGBOX=<n> (stubs
  showMessageBoxSync), and a {winclose:true} step. Without LK_OPEN/LK_SAVE a real dialog opens and the run hangs.
  See _tools/run-pdf-gui.sh for the runner pattern and _tools/st-a-chartout.js for a step file. Results in <log>.res;
  real failures are lines matching `=> "FAIL`. Never kill electron processes you did not start (the Claude app is one).
- Commit on branch google-ui. Do not push, release or bump the version.

## Task 1: Google-style UI

- Top app bar ~56px: product mark + "Chartout", editable diagram title (like NotebookLM's title), Material icon buttons
  (40px, tooltips, aria-labels) for undo/redo etc., a "Templates" button, Export menu (PNG, SVG), primary pill "Save".
- Rounded surface panels (radius ~16px, ~8px gutters) like NotebookLM: left "Shapes" panel with the libraries as
  categories (chips or tabs: Flowchart, UML, Network, Circuit, plus a shape search box), right details panel, canvas in
  its own rounded surface. Panels collapsible with restore buttons.
- Floating Google-style toolbar at the bottom of the canvas: Select, Connector, Hand; zoom out / percent / zoom in / Fit.
- Selection actions (Copy, Paste, Duplicate, Delete, Front, Back) stay reachable with icons and tooltips.
- Material 3 dark dialogs (28px radius), menus, inputs, toasts. Templates dialog as cards with previews.
- A keyboard shortcuts / help dialog.
- Every existing function stays reachable. Works at 900x600. Add a GUI harness st-chartout-gui.js (PASS/FAIL lines) with
  runner _tools/run-chart-gui.sh, and screenshots _tools/test/out/chart-gui-*.png (before and after).

## Task 2: Break-it bug sweep

Try hard to break Chartout; for each bug write a failing harness step first, then fix. Cover at least: unsaved-changes
guard on New / Open / Templates / window close (main.js has no will-prevent-unload handler, so check the window can
close and that it asks); save integrity (atomic write, read-only target, plain error, save/reopen round trip equality,
unicode and Thai names and text); opening hostile files (empty, not JSON, wrong types, NaN/huge numbers, duplicate ids,
edges to missing shapes, bad edge fields); undo/redo correctness (a click without movement must not add an undo step or
clear redo; slider, title, nudge keys, templates, paste, delete, connector edits); text and label editing dialogs
(Escape, Enter, empty); Thai label widths and wrapping; connectors (self, duplicate, deleted ends); copy/paste across
New; resize limits; zoom extremes and Fit with far-apart shapes; export PNG/SVG fidelity (selection outlines must not
export, large diagrams, colours on white background, text escaping); keyboard shortcuts while typing or with dialogs
open; stacked dialogs; 500+ shapes performance; a seeded fuzzer with invariants (no console errors, edges reference
existing shapes, undo-all returns to the start, redo-all returns to the end, save/reopen equals).
