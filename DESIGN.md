# ASG Tools - Awwwards Redesign

## Brief (Phase 0)

**Subject:** ASG Tools - a browser-only suite of utility tools for academics/students
**Audience:** Students, researchers, and educators who need to prepare diagrams, code snippets, and print layouts
**Site job:** Provide quick, high-quality export tools without requiring installation or build step
**Assets:** Existing SVG icons, existing functionality
**Language:** English
**Constraints:** Must remain browser-only (no build step), static HTML/JS, work offline after initial CDN loads

**Assumptions:**
- Users value speed and clarity over flashy effects
- Primary use case is academic work (presentations, assignments, printed handouts)
- Tools need to feel professional and precise
- Keep existing functionality intact

## Concept (Phase 1)

**Selected Concept: "Precision Grid"**

- **Idea:** A digital workshop where tools live in a measured, architectural space. Like a technical drafting board meets modern interface design.
- **Metaphor:** Engineering blueprints and Swiss modernist grid systems - precision through restraint
- **Signature Moment:** Subtly animated grid reveals and measured transitions between tool cards, with crisp micro-interactions that feel tactile
- **Emotion:** Calm confidence, clarity, professional precision (first 3 seconds should feel considered and refined)
- **Motion verb:** "Settle" - elements lock into place with subtle easing, like a precision instrument
- **Screenshot frame:** Clean geometric layout with subtle grid lines, high contrast, generous whitespace

**Reason:** Fits the utilitarian nature of the tools while elevating them beyond generic admin UI. Low risk to implement in static HTML, reinforces the "precision" theme of print/layout tools.

## Art Direction (Phase 2)

**Palette:**
- `--ground: #050505` - Deep foundation
- `--surface: rgba(255, 255, 255, 0.03)` - Subtly elevated surfaces
- `--elevated: rgba(255, 255, 255, 0.06)` - Cards
- `--ink: #ffffff` - Primary text
- `--text-soft: rgba(255, 255, 255, 0.92)` - Secondary
- `--muted: rgba(255, 255, 255, 0.5)` - Muted
- `--line: rgba(255, 255, 255, 0.08)` - Dividers
- `--accent: #7fa3ff` - Primary accent (cool, precise)
- `--accent-2: #a3c9ff` - Soft accent

**Typography:**
- Display: Inter (or system font fallback) - 800 weight for headlines
- Body/UI: Inter - 400-600 weights
- Mono: JetBrains Mono (keep existing for code/tools)

**Grid & Rhythm:**
- 12-column grid, 24px gutter, max-width 1400px
- Section rhythm: 120px/80px mobile
- Consistent 8pt spacing scale (4,8,16,24,32,48,64,96,120)

**Motion:**
- Easing: cubic-bezier(0.25, 0.1, 0.25, 1) (subtly springy, precise)
- Durations: 200-400ms for micro-interactions, 600-800ms for reveals
- Motion verb "settle" - translateY + opacity with slight overshoot, scale subtle on hover

**Genericness Test:** Passed - specific to precision/tooling theme rather than generic gradient AI look.