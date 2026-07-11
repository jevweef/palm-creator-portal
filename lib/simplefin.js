// SimpleFIN — read-only bank feed for the Palm Chase account.
// SIMPLEFIN_ACCESS_URL embeds credentials in the URL; NEVER log it or return
// it to a client. This module only exposes parsed transactions.

export function isSimplefinConfigured() {
  return !!process.env.SIMPLEFIN_ACCESS_URL
}

// All transactions in the last `days` across the connected account(s).
export async function fetchSimplefinTransactions({ days = 45 } = {}) {
  const accessUrl = process.env.SIMPLEFIN_ACCESS_URL
  if (!accessUrl) throw new Error('SIMPLEFIN_ACCESS_URL not configured')
  // The access URL embeds basic-auth credentials (user:pass@host). Node/undici
  // fetch REJECTS credentials in the URL, so strip them out and send them as an
  // Authorization: Basic header against a clean URL instead.
  const u = new URL(accessUrl)
  const auth = (u.username || u.password)
    ? 'Basic ' + Buffer.from(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`).toString('base64')
    : null
  u.username = ''
  u.password = ''
  const base = u.toString().replace(/\/$/, '')
  const start = Math.floor(Date.now() / 1000) - days * 86400
  const res = await fetch(`${base}/accounts?start-date=${start}`, {
    cache: 'no-store',
    headers: auth ? { Authorization: auth } : {},
  })
  if (!res.ok) throw new Error(`SimpleFIN ${res.status}`)
  const data = await res.json()
  const out = []
  for (const a of (data.accounts || [])) {
    for (const t of (a.transactions || [])) {
      out.push({
        id: t.id,
        at: t.posted ? new Date(t.posted * 1000).toISOString() : null,
        amount: Number(t.amount) || 0,
        description: t.description || '',
        payee: t.payee || '',
        account: a.name || '',
      })
    }
  }
  return out
}

// "Zelle payment from ZOE FREEDMAN XXXXXXX7194" -> "ZOE FREEDMAN"
// "Zelle payment from TRAINER TABY LLC 29943590063" -> "TRAINER TABY LLC"
export function parsePayerName(description) {
  const s = String(description || '')
  const m = s.match(/(?:payment|transfer)\s+from\s+(.+?)(?:\s+X{2,}\d+|\s+\d{4,}|$)/i)
  return m ? m[1].trim() : ''
}

// Money-IN transactions only (creator payments), with the payer name parsed.
export async function fetchDeposits({ days = 45 } = {}) {
  const txns = await fetchSimplefinTransactions({ days })
  return txns
    .filter((t) => t.amount > 0)
    .map((t) => ({ ...t, payerName: parsePayerName(t.description) }))
}
