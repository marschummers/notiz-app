import { supabase } from './supabaseClient'

export const INVITE_QUERY_KEY = 'invite'

export function pendingInvitationToken(): string | null {
  const fromUrl = new URLSearchParams(window.location.search).get(INVITE_QUERY_KEY)
  if (fromUrl) localStorage.setItem('notiz_pending_invite', fromUrl)
  return fromUrl ?? localStorage.getItem('notiz_pending_invite')
}

export function discardPendingInvitation(): void {
  localStorage.removeItem('notiz_pending_invite')
  const url = new URL(window.location.href)
  url.searchParams.delete(INVITE_QUERY_KEY)
  window.history.replaceState({}, '', url)
}

export async function createProjectInvitation(projectId: string, email: string): Promise<string> {
  if (!supabase) throw new Error('Supabase ist nicht konfiguriert.')
  const { data, error } = await supabase.rpc('notiz_create_project_invitation', {
    p_project_id: projectId,
    p_email: email.trim(),
  })
  if (error) throw new Error(error.message)
  const url = new URL(window.location.href)
  url.search = ''
  url.searchParams.set(INVITE_QUERY_KEY, String(data))
  return url.toString()
}

export async function acceptProjectInvitation(token: string): Promise<string> {
  if (!supabase) throw new Error('Supabase ist nicht konfiguriert.')
  const { data, error } = await supabase.rpc('notiz_accept_project_invitation', { p_token: token })
  if (error) throw new Error(error.message)
  discardPendingInvitation()
  return String(data)
}
