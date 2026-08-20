import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const requiredEnvironment = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_STORAGE_BACKUP_EMAIL',
  'SUPABASE_STORAGE_BACKUP_PASSWORD',
  'STORAGE_BACKUP_OUTPUT',
]

for (const name of requiredEnvironment) {
  if (!process.env[name]) throw new Error(`${name} is missing`)
}

const supabaseUrl = process.env.SUPABASE_URL.replace(/\/$/, '')
const anonKey = process.env.SUPABASE_ANON_KEY
const outputRoot = path.resolve(process.env.STORAGE_BACKUP_OUTPUT)
const bucket = 'notiz-pdfs'

const authResponse = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: {
    apikey: anonKey,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    email: process.env.SUPABASE_STORAGE_BACKUP_EMAIL,
    password: process.env.SUPABASE_STORAGE_BACKUP_PASSWORD,
  }),
})

if (!authResponse.ok) {
  throw new Error(`Storage backup login failed with HTTP ${authResponse.status}`)
}

const auth = await authResponse.json()
if (!auth.access_token) throw new Error('Storage backup login returned no access token')

const requestHeaders = {
  apikey: anonKey,
  Authorization: `Bearer ${auth.access_token}`,
}

let fileCount = 0
let totalBytes = 0

function encodeObjectPath(objectPath) {
  return objectPath.split('/').map(encodeURIComponent).join('/')
}

async function downloadFile(objectPath) {
  const response = await fetch(
    `${supabaseUrl}/storage/v1/object/authenticated/${bucket}/${encodeObjectPath(objectPath)}`,
    { headers: requestHeaders },
  )
  if (!response.ok) {
    throw new Error(`Storage download failed for ${objectPath} with HTTP ${response.status}`)
  }

  const target = path.resolve(outputRoot, objectPath)
  if (target !== outputRoot && !target.startsWith(`${outputRoot}${path.sep}`)) {
    throw new Error('Storage object path escaped the backup directory')
  }

  const bytes = Buffer.from(await response.arrayBuffer())
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, bytes)
  fileCount += 1
  totalBytes += bytes.length
}

async function downloadPrefix(prefix = '') {
  const limit = 100
  for (let offset = 0; ; offset += limit) {
    const response = await fetch(`${supabaseUrl}/storage/v1/object/list/${bucket}`, {
      method: 'POST',
      headers: {
        ...requestHeaders,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prefix,
        limit,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      }),
    })
    if (!response.ok) {
      throw new Error(`Storage listing failed for ${prefix || '/'} with HTTP ${response.status}`)
    }

    const entries = await response.json()
    for (const entry of entries) {
      const objectPath = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.id) await downloadFile(objectPath)
      else await downloadPrefix(objectPath)
    }
    if (entries.length < limit) break
  }
}

await mkdir(outputRoot, { recursive: true })
await downloadPrefix()
console.log(`Storage backup downloaded ${fileCount} files (${totalBytes} bytes).`)
