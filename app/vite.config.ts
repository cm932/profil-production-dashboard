import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { viteSingleFile } from 'vite-plugin-singlefile'
import path from 'node:path'

// Два варианта сборки одного и того же кода — в один файл index.html каждый:
//  · автономный (по умолчанию) — исходные журналы вшиты, открывается двойным кликом, работает без сервера (демо-режим без входа);
//  · серверный (mode=server) — БЕЗ вшитых данных: их отдаёт сервер только после входа. Иначе любой мог бы прочитать данные прямо из кода страницы.
export default defineConfig(({ mode }) => {
  const server = mode === 'server'
  return {
    plugins: [react(), tailwindcss(), viteSingleFile()],
    resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
    define: { __STANDALONE__: JSON.stringify(!server) },
    build: { outDir: server ? '../server/public' : 'dist', emptyOutDir: true, assetsInlineLimit: 100_000_000, chunkSizeWarningLimit: 6000 },
  }
})
