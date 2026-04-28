import { redirect } from 'next/navigation'

// /admin → /admin/dashboard. The bare admin route used to render the Inspo
// Pipeline page, but that lives under /admin/inspo?tab=pipeline now.
export default function AdminIndex() {
  redirect('/admin/dashboard')
}
