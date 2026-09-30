// Расшифровка «запечатанного» файла (формат — см. tools/seal.js). Всё — встроенной криптографией браузера (WebCrypto),
// без сторонних библиотек. Ключа в файле нет: он выводится из пароля, поэтому без пароля данные не прочитать.
import type { Defect, Downtime, Params, Perms, User } from './types'

interface Box { iv: string; ct: string }
export interface Vault {
  v: number
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number }
  lookupSalt: string
  sealedAt: string
  users: Record<string, Box & { salt: string }>
  data: Record<string, Box>
}
export interface Unsealed {
  user: User
  perms: Perms
  downtime: Downtime[]
  defects: Defect[]
  settings: Params | null
  source: { downtime: string; defects: string }
}

const enc = new TextEncoder()
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u))

/** Зашифрованный блок из страницы или null, если это не запечатанный файл */
export function readVault(): Vault | null {
  const el = document.getElementById('profil-vault')
  if (!el?.textContent) return null
  try { return JSON.parse(el.textContent) as Vault } catch { return null }
}

export class VaultError extends Error {}

async function open(keyBytes: Uint8Array, box: Box, aad: string) {
  const key = await crypto.subtle.importKey('raw', keyBytes as BufferSource, 'AES-GCM', false, ['decrypt'])
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) as BufferSource, additionalData: enc.encode(aad) }, key, unb64(box.ct) as BufferSource)
  return JSON.parse(new TextDecoder().decode(plain))
}

async function kek(v: Vault, password: string, salt: Uint8Array) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: v.kdf.hash, salt: salt as BufferSource, iterations: v.kdf.iterations }, base, 256))
}

/** Логин + пароль → данные, положенные этой роли. Неверный логин и неверный пароль неразличимы (и по сообщению, и по времени). */
export async function unseal(v: Vault, login: string, password: string): Promise<Unsealed> {
  if (!crypto?.subtle) throw new VaultError('Браузер не поддерживает встроенное шифрование (WebCrypto). Откройте файл в Chrome, Edge, Firefox или Safari.')
  const bad = new VaultError('Неверный логин или пароль.')
  const idBuf = await crypto.subtle.digest('SHA-256', new Uint8Array([...unb64(v.lookupSalt), ...enc.encode(login.trim().toLowerCase())]))
  const id = b64(new Uint8Array(idBuf))
  const entry = v.users[id]
  // для несуществующего логина всё равно считаем ключ — время ответа одинаковое
  const key = await kek(v, password, entry ? unb64(entry.salt) : unb64(v.lookupSalt))
  if (!entry) throw bad
  let card: { user: User; perms: Perms; scope: string; dek: string }
  try { card = await open(key, entry, 'user:' + id) } catch { throw bad }
  const box = v.data[card.scope]
  if (!box) throw new VaultError('Файл повреждён: нет данных для этой роли.')
  const data = await open(unb64(card.dek), box, 'data:' + card.scope)
  return { user: card.user, perms: card.perms, ...data }
}
