# Luna Desktop

**A personal AI you visit, not an app you open.**

Luna Desktop is a local-first Electron app built around a single idea: Luna is the whole
identity. The home screen is a 2D orbital system you navigate — Luna glows at the center,
and your workspace orbits as a planet. Everything you do stays on your machine.

---

## Features

- **Luna — AI chat.** Streaming conversations with proactive, keyless web search (no
  third-party search API): Luna searches the live web on its own whenever a question needs
  current information. Multi-thread history, all stored locally.
- **Orbit — your workspace.** Tasks, notes, and projects, plus **Meeting Mode**: capture
  raw notes during a meeting and Luna turns them into a clean summary note, action-item
  tasks, and a grouping project when you end the session.
- **Local-first & private.** Conversations, Orbit data, and meeting sessions persist on
  this device. Your API key is encrypted at rest via the OS keychain (Electron
  `safeStorage`) — it never touches disk in plaintext or leaves your machine except to call
  the AI provider directly.
- **Built-in auto-updates.** The app checks GitHub Releases and offers one-click updates.
- **Design.** Strict black-and-white, instrument-grade, 60fps motion.

---

## Tech stack

Electron · Vite · React 19 · TypeScript · Tailwind CSS v4 · Zustand · electron-builder /
electron-updater.

The AI engine is **DeepSeek** (`deepseek-v4-flash`, OpenAI-compatible). All AI calls happen
in the Electron main process.

---

## Getting started

**Prerequisites:** Node.js 20+ and npm. A [DeepSeek API key](https://platform.deepseek.com/)
to bring Luna online (Orbit works without one).

```bash
npm install
npm run dev
```

On first launch, open **Settings** (gear in the title bar) and paste your DeepSeek API key.

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
electron/          Main process — window, IPC, DeepSeek streaming, web search, updater
  ipc/             keychain (encrypted keys), luna (chat), meeting (summarizer)
  search/          Keyless web search + article extraction
  updater.ts       GitHub auto-update service
src/
  views/           Home, Chat (Luna), Orbit, Settings
  components/       Titlebar, Starfield, Updater
  store/            Zustand stores (chat, orbit, meetings, settings, ui)
  ui/               Design-system primitives (buttons, modals, fields, …)
  lib/              Router + prompt helpers
```

---

## License

Proprietary — © AS. All rights reserved.
