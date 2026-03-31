"use client"
import { useState } from 'react'
import { updateProfile, changePassword } from '@/app/actions/profile'
import { UserCog, Lock, Save } from 'lucide-react'

interface Props {
  user: any
  profile: any
  onProfileUpdate: (newData: any) => void
}

export default function ProfileSettings({ user, profile, onProfileUpdate }: Props) {
  const [formData, setFormData] = useState({
    first_name: profile?.first_name || '',
    last_name: profile?.last_name || '',
    phone: profile?.phone || '',
  })
  const [updatingProfile, setUpdatingProfile] = useState(false)

  const [passData, setPassData] = useState({ newPass: '', confirmPass: '' })
  const [updatingPass, setUpdatingPass] = useState(false)

  const handleUpdateProfile = async () => {
    setUpdatingProfile(true)
    const res = await updateProfile(formData)
    setUpdatingProfile(false)
    if (res.success) {
      alert('Datos actualizados correctamente')
      onProfileUpdate(formData)
    } else {
      alert('Error: ' + res.error)
    }
  }

  const handleChangePassword = async () => {
    if (passData.newPass !== passData.confirmPass) {
      alert('Las contraseñas no coinciden')
      return
    }
    setUpdatingPass(true)
    const res = await changePassword(passData.newPass)
    setUpdatingPass(false)
    if (res.success) {
      alert('Contraseña cambiada con éxito')
      setPassData({ newPass: '', confirmPass: '' })
    } else {
      alert('Error: ' + res.error)
    }
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-6 text-[#0F172A] border-b pb-2">
          <UserCog size={20} />
          <h3 className="font-bold text-lg">Datos Personales</h3>
        </div>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Nombre</label>
              <input value={formData.first_name} onChange={(e) => setFormData({ ...formData, first_name: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Tu nombre" />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Apellido</label>
              <input value={formData.last_name} onChange={(e) => setFormData({ ...formData, last_name: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Tu apellido" />
            </div>
          </div>
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Teléfono / WhatsApp</label>
            <input value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Ej: +54 9 11..." />
            <p className="text-[10px] text-slate-400 mt-1">Este teléfono se usará para contactarte por tus pedidos.</p>
          </div>
          <button onClick={handleUpdateProfile} disabled={updatingProfile} className="w-full bg-[#0F172A] text-white font-bold py-2 rounded-lg hover:bg-slate-900 flex items-center justify-center gap-2 mt-2">
            {updatingProfile ? 'Guardando...' : (<><Save size={16} /> Guardar Cambios</>)}
          </button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm h-fit">
        <div className="flex items-center gap-2 mb-6 text-[#0F172A] border-b pb-2">
          <Lock size={20} />
          <h3 className="font-bold text-lg">Seguridad</h3>
        </div>
        <div className="space-y-4">
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Nueva Contraseña</label>
            <input type="password" value={passData.newPass} onChange={(e) => setPassData({ ...passData, newPass: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Mínimo 6 caracteres" />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Confirmar Contraseña</label>
            <input type="password" value={passData.confirmPass} onChange={(e) => setPassData({ ...passData, confirmPass: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Repite la contraseña" />
          </div>
          <button onClick={handleChangePassword} disabled={updatingPass} className="w-full bg-white border border-slate-300 text-slate-700 font-bold py-2 rounded-lg hover:bg-slate-50 flex items-center justify-center gap-2 mt-2">
            {updatingPass ? 'Procesando...' : 'Cambiar Contraseña'}
          </button>
        </div>
      </div>
    </div>
  )
}
