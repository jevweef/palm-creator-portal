import webpush from 'web-push'
import { fetchAirtableRecords } from '@/lib/adminAuth'

if (process.env.VAPID_SUBJECT && process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT,
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  )
}

export async function sendPushToAdmins(payload) {
  if (!process.env.VAPID_PRIVATE_KEY) {
    console.warn('[Push] VAPID keys not configured — skipping')
    return
  }

  let subscriptions
  try {
    subscriptions = await fetchAirtableRecords('Push Subscriptions', {
      fields: ['Endpoint', 'P256dh', 'Auth'],
    })
  } catch (err) {
    console.warn('[Push] Failed to fetch subscriptions:', err.message)
    return
  }

  if (!subscriptions.length) return

  const results = await Promise.allSettled(
    subscriptions.map((rec) => {
      const sub = {
        endpoint: rec.fields.Endpoint,
        keys: { p256dh: rec.fields.P256dh, auth: rec.fields.Auth },
      }
      return webpush.sendNotification(sub, JSON.stringify(payload))
    })
  )

  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      console.warn(`[Push] Notification ${i} failed (${r.reason?.statusCode}):`, r.reason?.message)
    }
  })
}
