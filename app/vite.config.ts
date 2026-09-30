import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { viteSingleFile } from 'vite-plugin-singlefile'
import path from 'node:path'

// Варианты сборки одного и того же кода — в один файл index.html каждый:
//  · sealed (запечатанный) — БЕЗ открытых данных: tools/seal.js вставляет в страницу зашифрованные журналы,
//    расшифровать их можно только логином и паролем. Открывается двойным кликом, сервер не нужен;
//  · server — БЕЗ данных: их отдаёт сервер только после входа;
//  · режим разработки (npm run dev) — журналы вшиты открыто, вход не нужен (только для разработки).
export default defineConfig(({ mode }) => {
  const server = mode === 'server'
  const sealed = mode === 'sealed'
  return {
    plugins: [react(), tailwindcss(), viteSingleFile()],
    resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
    define: { __STANDALONE__: JSON.stringify(!server && !sealed), __SEALED__: JSON.stringify(sealed) },
    build: { outDir: server ? '../server/public' : sealed ? 'dist-sealed' : 'dist', emptyOutDir: true, assetsInlineLimit: 100_000_000, chunkSizeWarningLimit: 6000 },
  }
})
