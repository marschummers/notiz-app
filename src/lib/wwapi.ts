export interface WwapiRequirement {
  gen: number
  short_text?: string
  user_1?: string
  user_2?: string
  user_selection?: string
  kanban_team?: string
  kanban_state?: string
}

export interface WwapiRequirementEntry {
  gen: number
  text?: string
  user_insert?: string
  user_update?: string
  date_insert?: string
  date_update?: string
}

export interface WwapiRequirementPreview {
  requirement: WwapiRequirement
  entries: WwapiRequirementEntry[]
}

export interface WwapiSession {
  token: string
  userGen: number
}

const API_ROOT = 'https://europe-west1-winweb-webapp.cloudfunctions.net/apieu/winweb-food/1'
const ROUTING_HEADERS = {
  'X-Ww-App': 'berater-app',
  'X-Ww-Domain': 'winweb.de',
  'X-Ww-Mandant': '1',
}

let activeSession: WwapiSession | undefined

function items<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[]
  if (!value || typeof value !== 'object') return []
  const record = value as Record<string, unknown>
  if (Array.isArray(record.items)) return record.items as T[]
  if (Array.isArray(record.value)) return record.value as T[]
  return []
}

async function responseJson(response: Response): Promise<unknown> {
  const value = await response.json().catch(() => undefined) as { error?: string } | undefined
  if (!response.ok) throw new Error(value?.error || `AFN-Abfrage fehlgeschlagen (${response.status}).`)
  return value
}

export function isWwapiConnected(): boolean {
  return !!activeSession
}

export function disconnectWwapi(): void {
  activeSession = undefined
}

export async function authenticateWwapi(username: string, password: string): Promise<WwapiSession> {
  if (!username.trim() || !password) throw new Error('Winweb-Benutzer und Passwort sind erforderlich.')
  const response = await fetch(`${API_ROOT}/login/authenticateExtended`, {
    method: 'POST',
    headers: {
      ...ROUTING_HEADERS,
      'X-Ww-User': '0',
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ username: username.trim(), password }),
  })
  const value = await responseJson(response) as { sCode?: string; iSY01_GEN?: number }
  if (!value.sCode || !Number.isInteger(value.iSY01_GEN) || !value.iSY01_GEN) throw new Error('Winweb hat keine gueltige Sitzung geliefert.')
  activeSession = { token: value.sCode, userGen: value.iSY01_GEN }
  return activeSession
}

async function readJson(path: string): Promise<unknown> {
  if (!activeSession) throw new Error('Bitte zuerst mit Winweb verbinden.')
  const response = await fetch(`${API_ROOT}${path}`, {
    method: 'GET',
    headers: {
      ...ROUTING_HEADERS,
      'X-Ww-History': 'true',
      'X-Ww-User': String(activeSession.userGen),
      Authorization: `Bearer ${activeSession.token}`,
      Accept: 'application/json',
    },
  })
  if (response.status === 401 || response.status === 403) activeSession = undefined
  return responseJson(response)
}

export async function readRequirementPreview(afnNumber: number): Promise<WwapiRequirementPreview> {
  if (!Number.isInteger(afnNumber) || afnNumber <= 0) throw new Error('Ungueltige AFN-Nummer.')
  const encoded = encodeURIComponent(String(afnNumber))
  const [requirement, entriesResponse] = await Promise.all([
    readJson(`/v2/requirements/${encoded}`),
    readJson(`/v2/requirements/${encoded}/entries`),
  ])
  return {
    requirement: requirement as WwapiRequirement,
    entries: items<WwapiRequirementEntry>(entriesResponse),
  }
}
