import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabaseClient'

interface AuthState {
  session: Session | null
  loading: boolean
  // false, wenn Supabase nicht konfiguriert ist (fehlende Umgebungsvariablen).
  configured: boolean
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

  async function signInWithOtp(email: string) {
    if (!supabase) return { error: 'Supabase ist nicht konfiguriert.' }
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin + window.location.pathname },
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
    <AuthContext.Provider value={{ session, loading, configured: !!supabase, signInWithOtp, verifyOtp, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth muss innerhalb von AuthProvider verwendet werden')
  return ctx
}
