'use client'
import { useParams } from 'next/navigation'
import InspoPage from '@/app/inspo/page'
export default function CreatorInspoPage() {
  const params = useParams()
  return <InspoPage opsIdOverride={params?.id} />
}
