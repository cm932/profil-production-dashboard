import type { Defect, Downtime, Kind, Perms, User } from './types'

/** Можно ли пользователю менять/удалять запись. Это правило дублирует серверное только чтобы не показывать лишние кнопки — решает сервер. */
export function canModifyRecord(user: User | null, perms: Perms, kind: Kind, rec: Downtime | Defect): boolean {
  if (!user) return false
  const mode = perms.records[kind]
  if (!mode || rec.dbId == null) return false
  if (mode === 'all') return true
  if (rec.createdBy !== user.id) return false
  if (kind === 'downtime' && user.role === 'chief' && (rec as Downtime).shop !== user.shop) return false
  return true
}
