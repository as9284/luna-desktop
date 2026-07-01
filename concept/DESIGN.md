# Luna Desktop — Design Language (v0.1 draft)

> Working spec for the visual overhaul. This is a living document — we revise as we iterate on the prototypes in `/concept`.

## North star
Luna is a **personal AI you visit, not an app you open**. The home is a quiet black void with Luna glowing at its center and her capabilities orbiting as celestial bodies. Everything should feel **precise, weightless, and inevitable** — like the instrument panel of a calm spacecraft, not a busy dashboard.

Three words: **monochrome · luminous · instrument-grade.**

## What we're escaping (from starfield)
- Purple "space" theme that read as cheap. → Strict black & white.
- Inconsistent UI across screens. → One token system, one primitive library, used everywhere.
- Laggy / unstable / unintuitive 3D nav. → Hard 60fps budget, transform-only motion, a nav model that feels obvious.

## Palette — monochrome only
Color is banned as decoration. The only "warmth" is **light itself** (Luna's glow), given a faint cool tint so it reads as moonlight, not sterile gray.

| Token | Value | Use |
|---|---|---|
| `--bg` | `#000000` | The void |
| `--ink` | `#EDEEF2` | Primary text / brightest UI |
| `--ink-2` | `#8A8D98` | Secondary text |
| `--ink-3` | `#4A4D57` | Tertiary / captions / HUD |
| `--line` | `rgba(255,255,255,.10)` | Hairline borders |
| `--line-2` | `rgba(255,255,255,.06)` | Faint dividers / orbit rings |
| `--glass` | `rgba(255,255,255,.035)` | Elevated surfaces (frosted) |
| `--glow` | `rgba(206,219,255,…)` | Luna's light (cool white) — glow only, never fills/text |
| `--danger` | `#E15A4F` | The one allowed hue — destructive/error states ONLY |

**The single exception to monochrome:** one restrained, desaturated red (`--danger`) is permitted, scoped strictly to destructive/error states — danger buttons, error fields, delete menu items. Success and every other state stay B/W (brightness + icon + wording). Red is never decorative.

## Typography
- **Display / wordmark** — `Space Grotesk` (geometric, slightly technical).
- **Body / UI** — `Inter`.
- **Instrument labels, HUD, data, timestamps** — `JetBrains Mono`, uppercase, letter-spaced. This mono layer is what sells the "spacecraft instrument" feel.
- Sentence case for prose; UPPERCASE only for short mono instrument labels.

## Materials & surfaces
- **The void** — pure black with a soft radial vignette and a fine, twinkling starfield.
- **Glass panels** — near-black frosted (`--glass`) + 1px `--line` border + subtle inner light. Used for modals, the command dock, cards.
- **Light** — Luna and key focal points emit layered radial bloom. Glow is the signature; use it sparingly so it stays special.
- **Hairlines everywhere** — orbit rings, dividers, focus rings are all 1px white-alpha. Precision over weight.

## Motion (a feature, not decoration)
- Continuous slow orbital drift; planets revolve, Luna breathes.
- Parallax starfield on cursor movement (a few px).
- Focus transitions ease (no jumps): selecting a planet glides the camera/scene.
- Micro-interactions: hover = gentle scale + brighten + ring highlight.
- **Rules:** transform/opacity only, GPU-composited, 60fps hard budget; honor `prefers-reduced-motion`.

## The home — orbital OS
- Frameless window, custom titlebar (Luna mark + wordmark left · status center · window controls right).
- **Luna** = luminous central sphere (moon + star); tap to talk.
- **Planets = modules.** Lean trio: **Orbit** (tasks/notes) and **Beacon** (code) revolve as planets; **Settings** rides as a small inner moon.
- **Each body is unique while staying strictly monochrome** — differentiate by *form, texture, motion, and brightness*, never hue: Orbit = banded planet + tilted ring; Beacon = brightest sphere + rotating lighthouse sweep; Settings = dim matte cratered moon + thin halo ring; Luna = luminous center.
- Hover a body → upright mono label + its ring brightens.
- **Persistent command dock** (bottom): talk to Luna from the home without entering a module. The home is both navigation *and* a conversation.
- HUD corners: live clock/date (left), system status `online · 3 bodies` (right).
- **The AI engine name never appears anywhere in the UI** — it lives only in Settings.

### Clickability (a hard requirement, not polish)
Moving targets were the old system's sin. Rules: every body carries a large invisible hit area (≥56px, even the tiny moon), and **a body pauses its own orbit when the cursor is near** so you click a stationary target. Orbits are slow by default. You never chase a dot.

## Navigation model
The 3D solar system is the **home and primary nav**. Persistent titlebar chrome stays put; only the content morphs between views.

**Transitions.** No white flash (harsh on black). Two flavors:
- **Luna** — a dark depth dolly: the home view pushes *in* (`scale 1→1.14`) and fades through black; Luna's view settles in from a slight scale. Back pulls out.
- **Planets** — the real 3D camera **flies into the planet** (~0.7s): OrbitControls disable, the camera dollies right up to the clicked body (captured world position), then cross-fades (opacity only, no CSS scale — the camera supplied the zoom) into the module screen. Exit reverses: cross-fade home in, camera flies back out, controls re-enable. Implemented via `store/ui.ts` (`transit`/`focusPos`) + a `CameraController` in `Scene3D` that calls `commitModule()` on arrival.

Return home via Esc or the "System" back control.

## Luna chat screen
- Persistent titlebar; a left **conversation rail** (history, grouped by day, new-conversation button); a centered reading column for the transcript; the same command dock as composer.
- **Luna's voice has presence:** her replies aren't bubbles — a small Luna orb avatar + a faint glowing left rule, as if her light is speaking. The user's messages are quiet glass bubbles, right-aligned.
- **Cross-module actions surface as inline cards** (e.g. `Beacon · scanned 4 files`, `Orbit · task created`) — this is the constellation/command idea reborn in the new design.
- Composer previews primitives in-context: a monochrome web-search toggle, `/` command hint, custom scrollbars.

## UI primitives — hybrid build
Visuals 100% bespoke to this system; behavior for the hard ones rides on a headless base (Radix/Ark) for b/ focus / keyboard / ARIA correctness.
- **From scratch (visual-only):** button, icon button, input, textarea, checkbox, radio, switch, slider, card, badge/pill, tabs, segmented control, tooltip, custom scrollbar, titlebar/appbar, progress, spinner.
- **Headless base, fully skinned:** dialog/modal, dropdown menu, select/combobox, popover, command palette, toast.

**Visual reference:** `concept/primitives.html` renders all of the above, interactive. Danger/error states are currently **monochrome** (bright border + warning icon + brightness shift, no red) — pending the signal-hue decision in Open questions #1.

## Scope reminders
- Stack: Electron + React + TS + Vite + Tailwind + Zustand + Three.js/r3f — rebuilt clean.
- AI engine: DeepSeek **v4 flash** (exact model id confirmed at integration).
- Modules: **Luna · Orbit · Beacon** (+ Settings). Hyperlane/Solaris/Pulsar dropped.

## Open questions
1. ~~Error/success color~~ — **resolved:** one desaturated red (`--danger #E15A4F`) for destructive/error only; success and everything else stays B/W.
2. Inside modules: how much cosmos bleeds through (starfield behind panels) vs. calm near-black focus screens?
3. Real 3D (Three.js/r3f) for home vs. the CSS approximation in this prototype — the prototype proves the *look*; production will be r3f.
