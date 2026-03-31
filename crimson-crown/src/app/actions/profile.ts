"use server"
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

const getSupabase = async () => {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get(name) { return cookieStore.get(name)?.value }, set() {}, remove() {} } }
  )
}

export async function updateProfile(formData: { first_name: string, last_name: string, phone: string }) {
  const supabase = await getSupabase()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { success: false, error: 'No autorizado' }
  const { error } = await supabase
    .from('profiles')
    .update({ first_name: formData.first_name, last_name: formData.last_name, phone: formData.phone })
    .eq('id', user.id)
  if (error) return { success: false, error: error.message }
  return { success: true }
}

export async function changePassword(newPassword: string) {
  const supabase = await getSupabase()
  if (newPassword.length < 6) return { success: false, error: 'La contraseña debe tener al menos 6 caracteres.' }
  const { error } = await supabase.auth.updateUser({ password: newPassword })
  if (error) return { success: false, error: error.message }
  return { success: true }
}
