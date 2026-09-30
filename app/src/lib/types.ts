export type Shift = 1 | 2

export interface Downtime {
  id: string
  date: string // ГГГГ-ММ-ДД
  machine: string
  machineName: string
  op: string
  shop: string
  shift: Shift
  reason: string
  planned: boolean
  min: number
  /** только в серверном режиме: номер записи в базе и кто её создал (для правки своих записей) */
  dbId?: number
  createdBy?: number | null
}

export interface Defect {
  id: string
  date: string
  type: string
  op: string
  qty: number
  order: string
  shift: Shift
  dbId?: number
  createdBy?: number | null
}

export interface Journal<T> {
  records: T[]
  fileName: string
  errors: string[]
  total: number
  isDefault: boolean
}

interface LoadBase { title: string; fileName: string; errors: string[]; total: number }
export type LoadResult =
  | (LoadBase & { kind: 'downtime'; records: Downtime[] })
  | (LoadBase & { kind: 'defects'; records: Defect[] })

export interface Filters {
  from: string
  to: string
  shift: 'all' | 1 | 2
  shop: string // 'all' или название цеха
}

export interface Params {
  shiftHours: number
  hourCost: number
  pieceCost: number
}

export type SheetId = 'summary' | 'downtime' | 'defects' | 'data' | 'admin'

export type Role = 'admin' | 'director' | 'chief' | 'otk'
export type Kind = 'downtime' | 'defects'

export interface User {
  id: number
  login: string
  name: string
  role: Role
  shop: string | null
  mustChange: boolean
  demo: boolean
}

/** Права, которые сервер сообщил интерфейсу. Интерфейс по ним прячет лишнее; настоящую проверку делает сервер. */
export interface Perms {
  label: string
  sheets: SheetId[]
  money: boolean
  upload: boolean
  pdf: boolean
  users: boolean
  audit: boolean
  settings: boolean
  records: Partial<Record<Kind, 'all' | 'own'>>
}
