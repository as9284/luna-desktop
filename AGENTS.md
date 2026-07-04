# AGENTS.md

Working guide for AI agents (and humans) editing **Luna Desktop**. Read this before making
changes. `README.md` covers what the product _is_; `concept/DESIGN.md` covers the visual
language; this file covers _how to work in the code_.

> Not to be confused with Luna's own runtime `AGENTS.md` — that's her in-app operating rules,
> defined as `DEFAULT_AGENTS` in `electron/soul/defaults.ts` and seeded into the user's
> workspace. This file is about the repository.

---

## Golden rules

- **Don't touch git.** The maintainer does every commit, push, tag, and release themselves.
  Make the edits and stop — never commit, push, branch, or tag unless explicitly asked.
- **Host is Windows; the shell is PowerShell** (pwsh 7+). A Bash tool is available for POSIX
  scripts, but default to PowerShell syntax for terminal work.
- **Keep changes surgical.** Match the surrounding style, change only what the task needs, and
  don't refactor or reformat adjacent code you weren't asked to touch.
- **The model/provider name must never appear in the UI — except the Settings screen.** This
  is a hard product constraint. No "powered by X", no model names in toasts, status lines, or
  placeholders.
- **Be honest about verification.** Typecheck, tests, and the build run headlessly and prove a
  lot. Anything involving the live UI, real streaming, an API key, the SQLite DB, or PDF
  rendering is verified by _running the app_ — the maintainer does that visually. Say what you
  did and didn't verify; don't claim visual confirmation you couldn't perform.

---

## Commands

| Command             | What it does                                                     |
| ------------------- | --------------------------------------------------------------- |
| `npm run dev`       | Vite + Electron with hot reload (the only way to see the app)   |
| `npm run typecheck` | `tsc --noEmit` — run after every change                          |
| `npm test`          | Backend test suites, headless (see **Testing**)                 |
| `npm run build`     | `tsc && vite build` — renderer + Electron main + preload         |
| `npm run dist`      | Package a Windows NSIS installer via electron-builder            |

Run a single backend suite directly: `npx tsx scripts/test-<name>.mts`. After backend work,
run `npm run typecheck` **and** the relevant suite; after anything non-trivial, `npm run build`.

---

## Architecture

**Two processes, one hard boundary.**

- **Electron main** (`electron/`) — Node, privileged. _All_ filesystem, network, database, AI,
  web-search, and OS access lives here.
- **React renderer** (`src/`) — UI only, no Node access. It talks to main **exclusively over
  IPC** through `window.api`, which is defined by `contextBridge` in `electron/preload.ts` and
  typed in `src/types/api.d.ts`.

If a feature needs disk, network, a key, or the DB, it belongs in main and is exposed to the
renderer via IPC — never reached directly from React.

**Injectable cores + thin Electron seams.** The security- and logic-heavy modules are written
as pure, dependency-injected functions so they run and are unit-tested under plain Node with
`tsx`. Their sibling `index.ts` is the _only_ file that imports Electron and wires in the real
services. Examples: `electron/luna/tools.ts` (pure) vs `electron/luna/index.ts` (wiring);
`electron/luna/fs/*`, `electron/luna/sandbox.ts`, `electron/soul/core.ts`, and the
`electron/llm/*` adapters are all pure. **When you add logic, follow this split** — logic in a
testable core, Electron wiring in `index.ts`.

---

## Directory map

```
electron/
  main.ts          App/window bootstrap; registers every IPC module
  preload.ts       contextBridge → window.api (the renderer's only door to main)
  updater.ts       GitHub auto-update service
  ipc/             keychain (safeStorage-encrypted keys), luna (chat streaming + tool loop),
                   meeting (one-shot summarizer)
  llm/             Provider-agnostic LLM: config (slots main+vision), openai + anthropic
                   adapters, index (streamChat / complete / describeImage). Universal-model
                   compat: toolText.ts (text-format tool-call dialects + reasoning strip +
                   ReAct continuation), adapt.ts (400-driven request repair)
  luna/            Luna's capabilities:
    fs/            path guard, denylist, tiered permission policy, grants, file ops, activity log
    extract.ts     document → text (pdf/docx/xlsx/csv/…)
    sandbox.ts     locked-down JS execution (worker + vm, no I/O)
    pptx.ts        .pptx reader/renderer
    tools.ts       the file/code tool executor (pure) + tool schemas
    activity.ts    tool → activity-step mapper + result classifier (pure) — drives the live trace
    index.ts       Electron wiring: singletons, permission round-trip, htmlToPdf, drawer IPC
  soul/            Luna's identity:
    defaults.ts    SOUL.md / AGENTS.md / skill text as constants (seeded to the workspace)
    skills.ts      SKILL.md frontmatter parse/serialize
    core.ts        createSoul(): seed, composeIdentity, memory, skills, profile (pure)
    index.ts       soul tools (use_skill/remember) + editor IPC
  atlas/           Research library: SQLite (FTS5) db, extract/ (link-type router), digest
                   (AI summary), vault, index
  search/          Keyless web search + extraction ladder
src/
  views/           Home, Chat (Luna), Orbit, Atlas, Settings, SoulPanel, doc/ (Atlas viewers)
  components/       Titlebar, Markdown, Updater, Starfield, Lightbox, ProgressTrace + ActivityGlyph
                   (the live/saved activity trace, activity.css), …
  store/            Zustand stores — chat, orbit, meetings, atlas, settings, ui
  ui/              Design-system primitives (Button, Modal, Segmented, Input, …)
  lib/             router (view transitions), luna-prompt, orbit-tools (renderer executor)
  types/           api.d.ts — the window.api contract
scripts/           test-*.mts backend suites (run with tsx)
concept/           DESIGN.md (visual spec) + HTML prototypes
```

---

## Common tasks

**Add a renderer ↔ main IPC call**
1. `ipcMain.handle('ns:action', …)` inside the relevant `register*()` in main.
2. Expose it in `electron/preload.ts` under `api.<ns>`.
3. Add the signature to `src/types/api.d.ts`.
4. Call `window.api.<ns>.<action>(…)` from the renderer.

**Add a Luna tool**
- _File/code tools:_ add a `case` + a tool schema in `electron/luna/tools.ts`, add the name to
  `LUNA_FS_TOOL_NAMES`, wire any new dependency into the executor in `electron/luna/index.ts`,
  and add a fake for it in `scripts/test-tools.mts`.
- _Orbit / Atlas / soul tools:_ defined in `electron/ipc/luna.ts` (orbit/atlas) or
  `electron/soul/index.ts`; routed in the tool loop in `ipc/luna.ts`; user-facing results
  become inline cards via `buildCard`.
- _Any tool:_ add a `case` to `stepFor` in `electron/luna/activity.ts` so it shows in the live
  activity trace (a brand-new activity *kind* also needs a glyph in `src/components/ActivityGlyph.tsx`).
- Every file/code tool goes through the path guard + tiered permission model. A bare/relative
  path resolves against Luna's **workspace** (her default folder — see `GuardConfig.workspace`
  in `fs/paths.ts`), not the process cwd. Tiers: read = silent; create/overwrite = **silent
  inside the workspace** (her sandbox; overwrites are auto-backed-up) but **ask-once in a
  granted folder**; delete/run_code = confirm-always, everywhere. Don't bypass it.

**Change a Luna skill, her personality, or her rules**
Edit `electron/soul/defaults.ts` (`DEFAULT_SKILLS`, `DEFAULT_SOUL`, `DEFAULT_AGENTS`) and update
`scripts/test-soul.mts`. Note: these seed the user's workspace files, and `ensureSeeded` only
writes _missing_ files — an existing install won't pick up an edited default until a fresh
install, the in-app **"Update built-in skills"** button, or a per-file **"Reset to default"**.

**Style / design**
Use the CSS variables from `src/index.css` — `--ink`, `--ink-2`, `--ink-3`, `--line`,
`--line-2`, `--glass`, `--accent` / `--accent-rgb`, `--danger` — never hardcode colors.
`--danger` (a desaturated red) is reserved for destructive/error only; `--accent` is the
themeable signature highlight (Luna's presence, the empty-page orb, the live activity trace),
used sparingly. Motion is transform/opacity only, at 60fps, and must honor
`prefers-reduced-motion`. Match the monochrome, instrument-grade look in `concept/DESIGN.md`.

---

## Conventions

- TypeScript everywhere, strict. `npm run typecheck` must stay clean.
- 2-space indent, single quotes, no semicolons — match the file you're in.
- Don't add heavy dependencies without a reason. A pure-JS parser with native or dynamic
  `require`s must be added to `rollupOptions.external` in `vite.config.ts` and
  dynamic-`import()`ed at runtime (see the comment block there for why).
- Renderer state is Zustand; persist through the existing `persist` middleware where a store
  already uses it. Atlas data is _not_ in a store — it lives in SQLite in main.

---

## Gotchas

- **Model name in UI:** never, except Settings.
- **`backdrop-filter` + transforms:** a transforming or `will-change` ancestor forces a
  `backdrop-filter` surface to render opaque. Keep transforms on the transition classes only
  (`src/lib/router.ts`). Motion must be 60fps — transform/opacity only.
- **Muted-label contrast:** `--ink-3` in `src/index.css` is the single source for small
  captions/labels. Fix "hard to read" there, globally — not per component.
- **Atlas reader body** uses a restricted block parser (paragraphs, `>` quotes, `##` headings,
  images) — no inline `**bold**` or `[links]()`; extractor `content` must respect that.
- **`export_pdf` / `htmlToPdf`** render HTML in an offscreen window via `printToPDF`; external
  fonts and remote URLs won't load, so the HTML must inline its CSS and embed assets as
  `data:` URIs.
- **better-sqlite3 native build (CI):** the release workflow must run on `windows-2022` with
  Python 3.11 (node-gyp 9 needs distutils and can't detect newer VS). See
  `.github/workflows/release.yml`.
- **Datacenter IPs:** Reddit `.json` and a few endpoints 403 from CI/datacenter addresses;
  extraction degrades to a stub by design (works from residential IPs).
- **Single-window app:** exactly one window exists — a `mainWindow` singleton in `electron/main.ts`
  plus `app.requestSingleInstanceLock()` (a second launch just focuses it). `createWindow()`
  reuses/reveals the existing window; don't reintroduce multi-window.
- **Model tool calls as text:** weaker/open models emit tool calls as text, not native
  `tool_calls`. `electron/llm/toolText.ts` rescues four dialects (Anthropic XML, DeepSeek DSML,
  Hermes/Qwen, Mistral) and strips `<think>` reasoning; `streamChat` feeds text-dialect results
  back as a ReAct observation (a user message, not a `tool` message) so weak models keep chaining.
  Set `LUNA_LLM_DEBUG=1` before `npm run dev` to log each round's convo + parsed output when a
  chain stalls. `electron/llm/adapt.ts` drops/reshapes a request param on a 400 and retries.
- **Activity trace:** the tool loop emits structured `LunaStep` events over `luna:step:<id>`
  (kind/label/target/detail + running→done/error), accumulated live and saved on the message.
  Adding a tool? Add a `case` to `stepFor` in `electron/luna/activity.ts`; a new activity *kind*
  also needs a glyph in `src/components/ActivityGlyph.tsx`.
- **Composer auto-grow:** the chat textarea sizes itself from `scrollHeight` in an effect — it's
  guarded against running while the view is `display:none` (a hidden route → `scrollHeight` 0 →
  the box collapses and traps typing). Keep the `offsetParent` check + `min-height` (see
  `src/views/Chat.tsx` and `.composer-input` in `chat.css`).

---

## Testing

- `npm test` runs the backend suites headlessly: `fs`, `sandbox`, `extract`, `pptx`, `tools`,
  `llm`, `soul`, `activity`. They test pure logic with injected fakes — no Electron required.
- Anything needing Electron, a live API key, real streaming, the SQLite database, or PDF
  rendering can't be tested here — it's verified by running `npm run dev`, and the maintainer
  confirms it visually. Flag those in your handoff instead of asserting they work.
