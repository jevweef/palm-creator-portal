'use client'

import ContentRequestOverview from '@/components/content-request/ContentRequestOverview'

export default function ContentRequestsAdminPage() {
  return <ContentRequestOverview apiBase="/api/admin/content-requests" />
}
