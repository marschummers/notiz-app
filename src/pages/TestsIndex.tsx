import { Link } from 'react-router-dom'
import './tests.css'

export default function TestsIndex() {
  return (
    <div className="tests-index">
      <h1>Diagnose-Testmatrix: Pencil-Aussetzer</h1>
      <p>
        Jeder Test verändert genau einen Faktor gegenüber dem Haupt-Prototyp. Bitte der
        Reihe nach testen: ein paar Punkte/Striche setzen, Stift kurz absetzen, sofort
        wieder aufsetzen, und im Log unten beobachten, ob dabei überhaupt etwas ankommt.
      </p>
      <ol>
        <li>
          <Link to="/tests/1">Test 1 — Pointer Events, touch-action: none, ohne Pointer Capture</Link>
        </li>
        <li>
          <Link to="/tests/2">Test 2 — Pointer Events, touch-action: manipulation, ohne Pointer Capture</Link>
        </li>
        <li>
          <Link to="/tests/3">Test 3 — native Touch Events (touchstart/move/end/cancel)</Link>
        </li>
        <li>
          <a href="tests4.html">Test 4 — reines HTML, kein React/Vite/PWA/Service Worker/Canvas</a>
        </li>
      </ol>
      <p>
        <Link to="/">← Zurück zum normalen Prototyp</Link>
      </p>
    </div>
  )
}
