'use client'
import { useParams, useSearchParams } from 'next/navigation'
import MyContentPage from '@/app/my-content/page'
export default function CreatorMyContentPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  return <MyContentPage opsIdOverride={params?.id} hqIdOverride={searchParams.get('hqId')} />
}
