// Обращения к серверу. Служебный заголовок X-Requested-With нужен серверу для защиты от подделки запросов с чужих сайтов.
import type { Perms, Role, User } from './types'

export class ApiError extends Error {
  status: number
  code?: string
  data: Record<string, unknown>
  constructor(status: number, message: string, data: Record<string, unknown> = {}) {
    super(message)
    this.status = status
    this.code = data.code as string | undefined
    this.data = data
  }
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method, credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'profil' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  let json: Record<string, unknown> | null = null
  try { json = await res.json() } catch { /* ответ не JSON */ }
  if (!res.ok) throw new ApiError(res.status, String(json?.error ?? 'Ошибка ' + res.status), json ?? {})
  return json as T
}

export const api = {
  get: <T,>(u: string) => call<T>('GET', u),
  post: <T,>(u: string, b: unknown = {}) => call<T>('POST', u, b),
  put: <T,>(u: string, b: unknown = {}) => call<T>('PUT', u, b),
  del: <T,>(u: string) => call<T>('DELETE', u),
}

export interface ServerMeta { server: true; demo: boolean; demoUsers: { login: string; role: string; password: string }[] }
export interface MeResponse { user: User; perms: Perms }

/** Есть ли сервер: у файла с диска (file://) и у статического хостинга (GitHub Pages) API нет — панель работает в автономном режиме. */
export async function probeServer(): Promise<ServerMeta | null> {
  if (location.protocol === 'file:') return null
  try {
    const res = await fetch('/api/meta', { credentials: 'same-origin' })
    if (!res.ok) return null
    const j = (await res.json()) as ServerMeta
    return j && j.server === true ? j : null
  } catch { return null }
}

export interface ServerUser {
  id: number; login: string; name: string; role: Role; shop: string | null
  active: boolean; mustChange: boolean; demo: boolean; createdAt: string; lastLogin: string | null; locked: boolean
}
export interface AuditRow { id: number; ts: string; login: string | null; action: string; entity: string | null; detail: string | null; ip: string | null }
