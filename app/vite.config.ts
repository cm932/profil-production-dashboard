import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { viteSingleFile } from 'vite-plugin-singlefile'
import path from 'node:path'

// Сборка в один index.html: открывается двойным кликом (file://), без сервера и без интернета.
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  build: { outDir: 'dist', emptyOutDir: true, assetsInlineLimit: 100_000_000, chunkSizeWarningLimit: 6000 },
})
