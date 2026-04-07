'use client'

import { useUser } from '@clerk/nextjs'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

export default function Home() {
  const { user, isLoaded } = useUser()
  const router = useRouter()

  useEffect(() => {
    if (!isLoaded) return

    const role = user?.publicMetadata?.role

    if (role === 'admin') {
      router.replace('/admin/inspo')
    } else if (role === 'editor') {
      router.replace('/admin/editor')
    } else {
      router.replace('/dashboard')
    }
  }, [isLoaded, user, router])

  return (
    <div style={{ minHeight: '100vh', background: '#FFF5F7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: '#999', fontSize: '14px' }}>Loading...</div>
    </div>
  )
}
