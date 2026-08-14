import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabaseClient'

export const ADMIN_EMAIL = 'marschummers@googlemail.com'

interface AuthState {
  session: Session | null
  loading: boolean
  // false, wenn Supabase nicht konfiguriert ist (fehlende Umgebungsvariablen).
  configured: boolean
  approved: boolean | null
  isGuest: boolean
  refreshApproval: () => Promise<void>
  signInWithOtp: (email: string) => Promise<{ error: string | null }>
  // Bestaetigt den 6-stelligen Code aus derselben Mail wie der Login-Link. Wichtig fuer als
  // Home-Bildschirm-App installierte Nutzung auf iOS: die bekommt einen eigenen, von Safari
  // getrennten Speicherbereich - ein Login per Link landet dort nie. Der Code wird dagegen
  // direkt in der schon geoeffneten App eingegeben, ganz ohne Browser-Wechsel.
  verifyOtp: (email: string, token: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [approved, setApproved] = useState<boolean | null>(null)
  const [isGuest, setIsGuest] = useState(false)

  useEffect(() => {
    if (!supabase) {
      setLoading(false)
      return
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
    })
    return () => subscription.subscription.unsubscribe()
  }, [])

  async function refreshApproval() {
    if (!supabase || !session) {
      setApproved(null)
      return
    }
    const { data, error } = await supabase
      .from('notiz_profiles')
      .select('approved, is_guest')
      .eq('id', session.user.id)
      .maybeSingle()
    // Rueckwaertskompatibel waehrend des Deployments: Wird die App kurz vor der Migration
    // geladen, darf die noch fehlende Spalte nicht alle bestehenden Benutzer aussperren.
    const approvalSchemaMissing = !!error && (error.code === '42703' || error.code === 'PGRST204' || error.message.includes('approved'))
    setApproved(approvalSchemaMissing ? true : error ? false : (data?.approved ?? false))
    setIsGuest(error ? false : (data?.is_guest ?? false))
  }

  useEffect(() => {
    refreshApproval()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user.id])

  async function signInWithOtp(email: string) {
    if (!supabase) return { error: 'Supabase ist nicht konfiguriert.' }
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin + window.location.pathname + window.location.search },
    })
    return { error: error?.message ?? null }
  }

  async function verifyOtp(email: string, token: string) {
    if (!supabase) return { error: 'Supabase ist nicht konfiguriert.' }
    const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' })
    return { error: error?.message ?? null }
  }

  async function signOut() {
    await supabase?.auth.signOut()
  }

  return (
    <AuthContext.Provider value={{ session, loading, configured: !!supabase, approved, isGuest, refreshApproval, signInWithOtp, verifyOtp, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth muss innerhalb von AuthProvider verwendet werden')
  return ctx
}

