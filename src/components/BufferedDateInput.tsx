import { useEffect, useState } from 'react'

function toInputValue(value: number | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function fromInputValue(value: string): number | undefined {
  if (!value) return undefined
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day, 12).getTime()
}

// Einzelne Jahresziffern loesen bereits Change-Events aus. Ein sofortiges Datenbank-Update
// rendert das kontrollierte Feld neu und setzt die Auswahl im Jahr zurueck. Deshalb bleibt die
// Eingabe lokal und wird erst beim Verlassen des Feldes oder mit Enter gespeichert.
export default function BufferedDateInput({ value, onSave }: { value?: number; onSave: (value: number | undefined) => void }) {
  const externalValue = toInputValue(value)
  const [draft, setDraft] = useState(externalValue)
  useEffect(() => setDraft(externalValue), [externalValue])

  function save() {
    if (draft !== externalValue) onSave(fromInputValue(draft))
  }

  return <input type="date" value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={save}
    onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} />
}

