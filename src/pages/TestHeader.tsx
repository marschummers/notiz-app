import { Link } from 'react-router-dom'

export function TestHeader({ title, onClear }: { title: string; onClear: () => void }) {
  return (
    <header className="test-header">
      <Link to="/tests">← Übersicht</Link>
      <strong>{title}</strong>
      <button onClick={onClear}>Log leeren</button>
    </header>
  )
}
