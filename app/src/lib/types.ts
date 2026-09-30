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
}

export interface Defect {
  id: string
  date: string
  type: string
  op: string
  qty: number
  order: string
  shift: Shift
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

export type SheetId = 'summary' | 'downtime' | 'defects' | 'data'
