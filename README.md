## ASG Tools (static HTML)

This repo is a small browser-only toolset (no build step). You can open it directly in a modern browser.

### How to run

1. Open `index.html` in your browser (double-click or use “Open with…”).
2. Use the menu to open the tool you need:
   - `packer.html` — Snippet Sheet Packer (A4 PDF export)
   - `calibrate.html` — Calibration (set px/cm for on-screen cm previews)
   - `plantuml-high-clarity.html` — PlantUML HQ Export (SVG/PNG export)
   - `graphviz-high-clarity.html` — Graphviz HQ Export (SVG/PNG export)
   - `matplotlib-high-clarity.html` — Matplotlib HQ Export (SVG/PNG export, Pyodide)
   - `code-snipper-maker.html` — Code Snipper Maker (PNG export)

### Notes about dependencies

- The pages load required libraries from CDNs at runtime (so an internet connection is needed for the JS libraries).
- `plantuml-high-clarity.html` calls PlantUML’s public server (`https://www.plantuml.com/plantuml`) to render diagrams.
- `matplotlib-high-clarity.html` loads [Pyodide](https://pyodide.org/) from a CDN and runs NumPy + Matplotlib in WebAssembly (no server-side Python).
- Calibration and per-image sizing/rotation in the packer are stored in your browser (`localStorage`).

### What each tool exports

- **Snippet Sheet Packer** (`packer.html`): downloads `snippets-a4.pdf`.
- **PlantUML HQ Export** (`plantuml-high-clarity.html`): exports `*.svg` (best clarity) and `*.png` (scaled).
- **Graphviz HQ Export** (`graphviz-high-clarity.html`): exports `*.svg` (best clarity) and `*.png` (scaled).
- **Matplotlib HQ Export** (`matplotlib-high-clarity.html`): exports `*.svg` (best clarity) and `*.png` (scaled).
- **Code Snipper Maker** (`code-snipper-maker.html`): exports `*.png`.

### You can use it here

https://ameencaslam.github.io/assignment-toolbox/
