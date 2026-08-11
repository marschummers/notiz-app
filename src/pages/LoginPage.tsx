import { useState } from 'react'
import { useAuth } from '../lib/auth'
import { useTheme } from '../lib/theme'
import BrandLogo from '../components/BrandLogo'
import './LoginPage.css'

export default function LoginPage() {
  const { signInWithOtp, verifyOtp } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState<string | null>(null)
  const [verifying, setVerifying] = useState(false)

  async function handleSubmit() {
    const trimmed = email.trim()
    if (!trimmed) return
    setSubmitting(true)
    setError(null)
    const { error: signInError } = await signInWithOtp(trimmed)
    setSubmitting(false)
    if (signInError) {
      setError(signInError)
    } else {
      setSent(true)
    }
  }

  async function handleVerifyCode() {
    const trimmed = code.trim()
    if (!trimmed) return
    setVerifying(true)
    setCodeError(null)
    const { error: verifyError } = await verifyOtp(email.trim(), trimmed)
    setVerifying(false)
    if (verifyError) setCodeError(verifyError)
    // bei Erfolg uebernimmt onAuthStateChange in lib/auth.tsx automatisch den Wechsel zur App
  }

  function handleUseDifferentEmail() {
    setSent(false)
    setCode('')
    setCodeError(null)
    setError(null)
  }

  return (
    <div className="login-screen">
      <button className="login-theme-switch" onClick={toggleTheme}>Design: {theme === 'winweb' ? 'Winweb' : 'Kupfer'}</button>
      <BrandLogo compact />
      <h1>Notiz App</h1>
      <div className="login-panel">
        {sent ? (
          <>
            <p className="hint">
              Mail verschickt an <strong>{email}</strong> – entweder den Link darin öffnen, oder direkt hier den
              6-stelligen Code aus derselben Mail eingeben (empfiehlt sich, wenn du die App vom Home-Bildschirm aus
              nutzt).
            </p>
            <div className="field">
              <span>Code</span>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123456"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleVerifyCode()
                  }
                }}
                autoFocus
              />
            </div>
            {codeError && <p className="login-error">{codeError}</p>}
            <button className="primary-button" onClick={handleVerifyCode} disabled={!code.trim() || verifying}>
              {verifying ? 'Wird geprüft…' : 'Code bestätigen'}
            </button>
            <button className="secondary-button" onClick={handleUseDifferentEmail}>
              Andere E-Mail-Adresse verwenden
            </button>
          </>
        ) : (
          <>
            <p className="hint">Melde dich mit deiner E-Mail-Adresse an, du bekommst dann einen Login-Link und einen Code.</p>
            <div className="field">
              <span>E-Mail</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="du@beispiel.de"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleSubmit()
                  }
                }}
                autoFocus
              />
            </div>
            {error && <p className="login-error">{error}</p>}
            <button className="primary-button" onClick={handleSubmit} disabled={!email.trim() || submitting}>
              {submitting ? 'Wird gesendet…' : 'Login-Link senden'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

