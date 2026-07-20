'use client'

import { useSearchParams } from 'next/navigation'
import ContentRequestOverview from '@/components/content-request/ContentRequestOverview'

// Team-scoped content-request oversight for chat managers. Admins can preview a
// manager's team via ?viewAsUserId=<clerkId>; the API enforces the scoping.
export default function ChatManagerContentRequestsPage() {
  const viewAsUserId = useSearchParams().get('viewAsUserId') || undefined
  return <ContentRequestOverview apiBase="/api/chat-manager/content-requests" viewAsUserId={viewAsUserId} />
}
