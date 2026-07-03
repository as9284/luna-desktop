# Luna Desktop

**A personal AI you visit, not an app you open.**

Luna Desktop is a local-first Electron app built around a single idea: Luna is the whole
identity. The home screen is a 2D orbital system you navigate — Luna glows at the center,
and your modules orbit as planets. Everything you do stays on your machine.

---

## The planets

Three modules orbit Luna, each a full workspace of its own:

- **Luna — AI chat.** Streaming conversations with proactive, keyless web search (no
  third-party search API): Luna searches the live web on its own whenever a question needs
  current information. She works with your files, too — reading documents (PDF, Word, Excel,
  PowerPoint), writing and organizing files in a sandboxed workspace, running code for exact
  answers, seeing images, and designing polished documents she can export to PDF — with a
  permission prompt on every write, delete, or code run. Luna can also act on your other
  modules through tools — creating and updating Orbit tasks/notes/projects, and searching,
  reading, and saving Atlas articles — directly from chat. Multi-thread history, all stored
  locally.
- **Orbit — your workspace.** Tasks, notes, and projects, plus **Meeting Mode** (capture
  raw notes and Luna turns them into a summary note, action-item tasks, and a grouping
  project) and a **Write** assistant (rewrite/proofread text in a chosen style).
- **Atlas — your research library.** Save any link or snippet; Atlas extracts and
  **archives the full article on your machine** (link rot can't touch it) and Luna
  summarizes it into a paragraph, key points, quotes, and tags. A distraction-free reader
  with **highlights + margin notes**, click-to-zoom images, reading progress, and **Ask this
  article** (scoped Q&A). Full-text search (SQLite FTS5), read-status and an "Up next"
  queue, **synthesize** a briefing across several saved articles, send items to Orbit, and
  export any article — or the whole library — to Markdown.

## Features

- **Local-first & private.** Chat threads, Orbit data, meeting sessions, and the entire
  Atlas library (a local SQLite database) persist on this device. Your API key is encrypted
  at rest via the OS keychain (Electron `safeStorage`) — it never touches disk in plaintext
  or leaves your machine except to call the AI provider directly.
- **Keyless graceful degradation.** Saving, reading, searching, and highlighting in Atlas
  all work without an API key; AI features (summaries, synthesis, chat) light up once a key
  is set.
- **Yours to shape.** Luna's personality, memory, and skills are editable files (Settings →
  Luna) — tune her voice and response style, reset or update the built-in skills (research,
  writing, design, presentations, decisions, and more), or write your own.
- **Built-in auto-updates.** The app checks GitHub Releases and offers one-click updates.
- **Design.** Strict black-and-white, instrument-grade, 60fps motion.

---

## Tech stack

Electron · Vite · React 19 · TypeScript · Tailwind CSS v4 · Zustand · electron-builder /
electron-updater. Atlas stores articles and highlights in **SQLite** (`better-sqlite3`, a
native module) with an FTS5 full-text index; article extraction uses `@mozilla/readability`
+ `linkedom`.

The AI engine is **provider-agnostic** — Luna talks to any **OpenAI-compatible** or
**Anthropic-compatible** endpoint, configured in Settings as two slots: a **main** model
(chat, writing, summaries) and an optional **vision** model (reads images/screenshots). All
AI calls, web search, file/code tools, and the Atlas database live in the Electron main
process.

---

## Getting started

**Prerequisites:** Node.js 20+ and npm. An API key for any OpenAI- or Anthropic-compatible
provider to bring Luna online (Orbit, and saving/reading/searching in Atlas, all work without
one).

> Atlas uses `better-sqlite3`, a native module. `npm install` rebuilds it for Electron
> automatically via the `postinstall` hook (`electron-builder install-app-deps`).

```bash
npm install
npm run dev
```

On first launch, open **Settings** (gear in the title bar), pick your provider (OpenAI or
Anthropic), set the base URL + model, and paste your API key.

### Scripts

| Command             | What it does                                              |
| ------------------- | -------------------------------------------------------- |
| `npm run dev`       | Start Vite + Electron in development with hot reload      |
| `npm run build`     | Type-check and build the renderer + Electron bundles      |
| `npm run typecheck` | `tsc --noEmit` type check only                            |
| `npm run dist`      | Build and package a distributable installer (Windows NSIS)|

---

## Building a distributable

```bash
npm run dist
```

Produces a Windows NSIS installer in `release/`. The build is **unsigned** — without a code
signing certificate, Windows shows a one-time SmartScreen "unknown publisher" warning on
first install. Auto-updates work regardless.

---

## Releases & auto-update

Releases are **tag-driven** and published to GitHub Releases by CI, which is also the feed
the in-app updater reads.

1. Bump the version and create a tag:
   ```bash
   npm version patch   # or: minor / major
   git push --follow-tags
   ```
2. The [`Release`](.github/workflows/release.yml) workflow (triggered by the `v*` tag) builds
   the Windows installer, uploads it to a draft release, then publishes it as the latest
   release. It uses the built-in `GITHUB_TOKEN` — no secrets to configure.
3. Installed apps pick up the new version on next launch: the updater notifies the user, who
   confirms the download and then restarts to install.

**Update behavior** is _notify & confirm_ — nothing downloads or installs without the user's
say-so. Auto-update only runs in the packaged app, not in `npm run dev`. It takes effect from
your second release onward: users install the first release manually, then newer tags update
them in place.

> The GitHub repository must be **public** for the updater to read releases without shipping
> an access token. The release target is configured in
> [`electron-builder.json`](electron-builder.json) (`publish` → `owner`/`repo`) — keep it in
> sync with the actual repository.

---

## Project layout

```
electron/          Main process — window, IPC, LLM providers, capabilities, web search, updater
  ipc/             keychain (encrypted keys), luna (chat + tool loop), meeting (summarizer)
  llm/             Provider-agnostic LLM layer (OpenAI + Anthropic adapters, two model slots)
  luna/            File/code/vision capabilities — sandboxed workspace, tools, extraction, PDF export
  soul/            Luna's identity — editable soul, rules, skills, and memory
  atlas/           SQLite library — db (FTS5), extract (link-type router), digest (AI summaries)
  search/          Keyless web search + article extraction (readability → markdown)
  updater.ts       GitHub auto-update service
src/
  views/           Home, Chat (Luna), Orbit, Atlas, Settings (+ Luna identity panel, doc viewers)
  components/       Titlebar, Starfield, Updater, Markdown, Lightbox
  store/            Zustand stores (chat, orbit, meetings, atlas, settings, ui)
  ui/               Design-system primitives (buttons, modals, context menu, …)
  lib/              Router + prompt helpers + Orbit tool executor
```

---

## License

Proprietary — © AS. All rights reserved.
