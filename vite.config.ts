import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import electron from 'vite-plugin-electron/simple'

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  plugins: [
    react(),
    tailwindcss(),
    electron({
      // - linkedom only requires `canvas` lazily, behind a try/catch, to back <canvas>
      //   elements — we never touch that path, but Rollup still tries to resolve the
      //   optional dep at bundle time unless it's marked external.
      // - electron-updater must stay external too: it has dynamic requires and is
      //   resolved from node_modules inside the packaged asar at runtime, not bundled.
      // - better-sqlite3 is a native module (.node binary) — it can never be bundled;
      //   it resolves from node_modules (unpacked from the asar) at runtime.
      // - unpdf embeds a large pdf.js build with dynamic requires — keep it external and
      //   dynamic-import()ed at runtime (pure JS, so it loads fine from inside the asar).
      // - mammoth (.docx) and exceljs (.xlsx) are pure-JS but heavy with dynamic requires —
      //   same treatment: external + dynamic-import()ed by electron/luna/extract.ts.
      // - fflate (.pptx unzip) is dynamic-import()ed by electron/luna/pptx.ts — keep it external
      //   so it resolves from node_modules at runtime like the other document parsers.
      main: { entry: 'electron/main.ts', vite: { build: { rollupOptions: { external: ['canvas', 'electron-updater', 'better-sqlite3', 'unpdf', 'mammoth', 'exceljs', 'fflate'] } } } },
      preload: { input: 'electron/preload.ts' },
    }),
  ],
})
