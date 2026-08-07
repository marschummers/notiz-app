import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Ohne konfigurierte Umgebungsvariablen bleibt supabase `null`; die App zeigt dann einen
// Hinweis statt eines kaputten Login-Formulars.
//
// flowType 'pkce': die App nutzt HashRouter (wegen GitHub Pages, das keine serverseitigen
// SPA-Rewrites kann), der Routing-Zustand steckt also im URL-Hash (#/...). Der klassische
// "implicit"-Flow von Supabase wuerde die Session-Tokens ebenfalls in den Hash schreiben
// (#access_token=...) und mit dem Router kollidieren. Im PKCE-Flow steckt der Code stattdessen
// in einem Query-Parameter (?code=...), der den Hash nicht anfasst.
export const supabase = url && anonKey ? createClient(url, anonKey, { auth: { flowType: 'pkce' } }) : null
