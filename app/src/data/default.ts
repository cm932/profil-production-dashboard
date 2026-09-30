// Исходные журналы подключаются прямо из папки проекта — без промежуточных копий,
// поэтому встроенные данные нельзя «подправить» незаметно.
import csvText from '../../../Файлы для проекта/clean_01_prostoi.csv?raw'
import xlsxUrl from '../../../Файлы для проекта/clean_02_brak.xlsx?url'
import { readBytes } from '@/lib/parse'
import type { LoadResult } from '@/lib/types'

function dataUrlToBytes(url: string): Uint8Array {
  const bin = atob(url.slice(url.indexOf(',') + 1))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function loadDefaultJournals(): LoadResult[] {
  return [
    readBytes('clean_01_prostoi.csv', new TextEncoder().encode(csvText)),
    readBytes('clean_02_brak.xlsx', dataUrlToBytes(xlsxUrl)),
  ]
}
