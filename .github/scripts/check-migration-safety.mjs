import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const migrationDirectory = 'supabase/migrations'
const migrationName = /^\d{4}_[a-z0-9_]+\.sql$/
const forbidden = [
  [/\bdrop\s+(?:table|schema)\b/i, 'DROP TABLE/SCHEMA'],
  [/\btruncate\b/i, 'TRUNCATE'],
  [/\bdisable\s+row\s+level\s+security\b/i, 'RLS deaktivieren'],
  [/\bgrant\b[\s\S]*?\bto\s+(?:anon|public)\b/i, 'Rechte an anon/public vergeben'],
]

const errors = []
const migrationFiles = readdirSync(migrationDirectory)
  .filter((name) => name.endsWith('.sql'))
  .sort()

for (const file of migrationFiles) {
  if (!migrationName.test(file)) {
    errors.push(`${file}: Dateiname muss dem Muster 0000_beschreibung.sql entsprechen.`)
  }
}

const baseArgumentIndex = process.argv.indexOf('--base')
if (baseArgumentIndex >= 0) {
  const base = process.argv[baseArgumentIndex + 1]
  if (!base) errors.push('--base benoetigt einen Git-Commit.')
  else {
    const changed = execFileSync('git', ['diff', '--name-status', `${base}...HEAD`, '--', migrationDirectory], { encoding: 'utf8' })
    for (const line of changed.trim().split(/\r?\n/).filter(Boolean)) {
      const [status, path] = line.split(/\s+/, 2)
      if (status !== 'A') errors.push(`${path}: Bestehende Migrationen duerfen nicht geaendert oder geloescht werden; neue Korrekturmigration anlegen.`)
    }
  }
}

for (const file of migrationFiles) {
  const sql = readFileSync(join(migrationDirectory, file), 'utf8')
  for (const [pattern, label] of forbidden) {
    if (pattern.test(sql)) errors.push(`${file}: ${label} ist in automatischen Migrationen gesperrt und erfordert einen separat geprueften Notfallablauf.`)
  }

  const definitions = sql.match(/create\s+or\s+replace\s+function[\s\S]*?\$\$\s*;/gi) ?? []
  for (const definition of definitions) {
    if (/security\s+definer/i.test(definition) && !/set\s+search_path\s*=/i.test(definition)) {
      errors.push(`${file}: SECURITY DEFINER-Funktion ohne festes search_path.`)
    }
  }
}

if (errors.length) {
  console.error('Migration-Sicherheitspruefung fehlgeschlagen:\n')
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}

console.log(`${migrationFiles.length} Migrationen geprueft; keine gesperrten Muster gefunden.`)
