export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords } from '@/lib/adminAuth'

const HQ_BASE = 'appL7c4Wtotpz07KS'
const INVOICES_TABLE = 'tblKbU8VkdlOHXoJj'

const hqHeaders = () => ({
  Authorization: `Bearer ${process.env.AIRTABLE_PAT}`,
  'Content-Type': 'application/json',
})

const INV_FIELDS = [
  'fldCimhMbOOeOQrFJ', // Invoice (formula)
  'fld37wwgvM0znxDPa', // AKA (lookup)
  'fldUBcYSMy74lt9Xf', // Earnings (TR)
  'fldeQoHxbYYWAnJYZ', // Commission % (Snapshot)
  'fldO2YiCr4FWxn5rG', // Chat Team Fee % (Snapshot)
  'fldk9uXcTQmkb897y', // Total Commission
  'fldirfRJlik40tnde', // Chat Team Cost
  'fldwTZKgEwLm9N3qW', // Net Profit
  'fldeucG0jEvjem841', // Period Start
  'fldZhX5uMZjrAkAeP', // Period End
  'fldFPZrQpTqcN4ywK', // Period Label
  'fldQEjYB0DxpNWxhU', // Invoice Status
  'fldOTpRmDWDfwz8FH', // Due Date
]

async function fetchInvoices() {
  const records = []
  let offset = null
  do {
    const params = new URLSearchParams()
    params.set('returnFieldsByFieldId', 'true')
    INV_FIELDS.forEach(f => params.append('fields[]', f))
    params.set('sort[0][field]', 'fldeucG0jEvjem841')
    params.set('sort[0][direction]', 'desc')
    if (offset) params.set('offset', offset)
    const res = await fetch(
      `https://api.airtable.com/v0/${HQ_BASE}/${INVOICES_TABLE}?${params}`,
      { headers: hqHeaders(), cache: 'no-store' }
    )
    const data = await res.json()
    if (data.records) records.push(...data.records)
    offset = data.offset || null
  } while (offset)
  return records
}

function toETDateStr(isoStr) {
  if (!isoStr) return ''
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
  }).format(new Date(isoStr))
}

export async function GET() {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const estNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }))
    const pad = n => String(n).padStart(2, '0')
    const estDateStr = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`
    const todayStr = estDateStr(estNow)
    const dayOfWeek = estNow.getDay()
    const sunday = new Date(estNow)
    sunday.setDate(estNow.getDate() - dayOfWeek)
    const weekStartStr = estDateStr(sunday)

    // --- Parallel fetch all data from both bases ---
    const [
      invoiceRecords,
      creators,
      tasks,
      libraryAssets,
      allPosts,
      sourceReels,
      inspoRecords,
      inspoSources,
    ] = await Promise.all([
      // HQ base — invoices (raw fetch with returnFieldsByFieldId)
      fetchInvoices(),
      // OPS — creators
      fetchAirtableRecords('Palm Creators', {
        filterByFormula: '{Social Media Editing}=1',
        fields: ['Creator', 'AKA', 'Weekly Reel Quota', 'Tasks', 'Assets'],
      }),
      // OPS — all tasks (recent)
      fetchAirtableRecords('Tasks', {
        filterByFormula: `OR({Status}='To Do',{Status}='In Progress',AND({Status}='Done',IS_AFTER({Completed At},DATEADD(TODAY(),-14,'days'))))`,
        fields: ['Name', 'Status', 'Creator', 'Completed At', 'Admin Review Status'],
      }),
      // OPS — uploaded assets (unused library). Mirrors /api/admin/editor/unreviewed:
      // any asset the editor would see as raw creator content awaiting pickup.
      // Excludes Inspo Upload (reference clips pinned to a specific inspo; not
      // "free" unused content).
      fetchAirtableRecords('Assets', {
        filterByFormula: `AND(OR({Pipeline Status}='Uploaded',{Pipeline Status}=BLANK()),{Source Type}!='Inspo Upload')`,
        fields: ['Asset Name', 'Pipeline Status', 'Source Type', 'Asset Type', 'Palm Creators'],
      }),
      // OPS — posts from last 7 days + future
      fetchAirtableRecords('Posts', {
        filterByFormula: `IS_AFTER({Scheduled Date}, DATEADD(TODAY(), -7, 'days'))`,
        fields: ['Creator', 'Scheduled Date', 'Telegram Sent At'],
      }),
      // OPS — source reels (for pipeline stats)
      fetchAirtableRecords('Source Reels', {
        fields: ['Source Handle', 'Data Source', 'Review Status', 'Imported to Inspiration'],
      }),
      // OPS — inspiration (for pipeline stats)
      fetchAirtableRecords('Inspiration', {
        fields: ['Status'],
      }),
      // OPS — inspo sources
      fetchAirtableRecords('Inspo Sources', {
        fields: ['Handle', 'Enabled', 'Last Scraped At'],
      }),
    ])

    // =============================================
    // 1. REVENUE
    // =============================================
    const invoices = invoiceRecords.map(r => {
      const f = r.fields
      const invoiceFormula = f['fldCimhMbOOeOQrFJ'] || ''
      const accountName = invoiceFormula.split(' | ')[0]?.trim() || ''
      const statusRaw = f['fldQEjYB0DxpNWxhU']
      const status = typeof statusRaw === 'object' && statusRaw !== null
        ? statusRaw.name : (statusRaw || 'Draft')
      return {
        accountName,
        aka: (f['fld37wwgvM0znxDPa'] || [])[0] || '',
        earnings: f['fldUBcYSMy74lt9Xf'] || 0,
        commissionPct: f['fldeQoHxbYYWAnJYZ'] || 0,
        chatFeePct: f['fldO2YiCr4FWxn5rG'] || 0,
        totalCommission: f['fldk9uXcTQmkb897y'] || 0,
        chatTeamCost: f['fldirfRJlik40tnde'] || 0,
        netProfit: f['fldwTZKgEwLm9N3qW'] || 0,
        periodStart: f['fldeucG0jEvjem841'] || '',
        periodEnd: f['fldZhX5uMZjrAkAeP'] || '',
        periodLabel: f['fldFPZrQpTqcN4ywK'] || '',
        status,
        dueDate: f['fldOTpRmDWDfwz8FH'] ? f['fldOTpRmDWDfwz8FH'].split('T')[0] : null,
      }
    })

    // Group by period
    const periodMap = {}
    for (const inv of invoices) {
      const key = `${inv.periodStart}|${inv.periodEnd}`
      if (!periodMap[key]) {
        periodMap[key] = { start: inv.periodStart, end: inv.periodEnd, label: inv.periodLabel, invoices: [] }
      }
      periodMap[key].invoices.push(inv)
    }
    const periods = Object.values(periodMap)

    // Current period = first (most recent) period
    const currentPeriod = periods[0] || null
    const currentPeriodTR = currentPeriod
      ? currentPeriod.invoices.reduce((s, i) => s + i.earnings, 0) : 0
    const currentPeriodCommission = currentPeriod
      ? currentPeriod.invoices.reduce((s, i) => s + i.totalCommission, 0) : 0
    const currentPeriodChatCost = currentPeriod
      ? currentPeriod.invoices.reduce((s, i) => s + i.chatTeamCost, 0) : 0
    const currentPeriodNetProfit = currentPeriod
      ? currentPeriod.invoices.reduce((s, i) => s + i.netProfit, 0) : 0

    // Outstanding invoices (Sent but not Paid)
    const outstanding = invoices.filter(i => i.status === 'Sent')
    const outstandingCount = outstanding.length
    const outstandingTotal = outstanding.reduce((s, i) => s + i.netProfit, 0)

    // Projected monthly revenue — extrapolate each account's most recent period to 30 days
    const accountLatest = {}
    for (const inv of invoices) {
      if (!inv.accountName || !inv.periodStart || !inv.periodEnd) continue
      if (inv.earnings <= 0) continue
      if (!accountLatest[inv.accountName]) {
        accountLatest[inv.accountName] = inv
      }
    }
    let projectedMonthlyRevenue = 0
    let projectedMonthlyNetProfit = 0
    for (const inv of Object.values(accountLatest)) {
      const start = new Date(inv.periodStart)
      const end = new Date(inv.periodEnd)
      const periodDays = Math.max(1, (end - start) / (1000 * 60 * 60 * 24))
      const dailyRate = inv.earnings / periodDays
      const dailyProfit = inv.netProfit / periodDays
      projectedMonthlyRevenue += dailyRate * 30
      projectedMonthlyNetProfit += dailyProfit * 30
    }

    // Revenue by creator (grouped by AKA, showing most recent period + trend)
    // Periods are sorted newest-first, so index 0 = current, 1 = previous, etc.
    const creatorRevenue = {}
    for (const inv of invoices) {
      const name = inv.aka || inv.accountName
      if (!creatorRevenue[name]) {
        creatorRevenue[name] = { name, periodTotals: {}, currentTR: 0, currentPalmCut: 0, previousTR: 0, commissionPct: 0, status: '' }
      }
      const periodKey = `${inv.periodStart}|${inv.periodEnd}`
      // Sum by period
      if (!creatorRevenue[name].periodTotals[periodKey]) {
        creatorRevenue[name].periodTotals[periodKey] = 0
      }
      creatorRevenue[name].periodTotals[periodKey] += inv.earnings
      // Current period
      if (currentPeriod && inv.periodStart === currentPeriod.start && inv.periodEnd === currentPeriod.end) {
        creatorRevenue[name].currentTR += inv.earnings
        creatorRevenue[name].currentPalmCut += inv.netProfit
        creatorRevenue[name].commissionPct = inv.commissionPct
        creatorRevenue[name].status = inv.status
      }
      // Previous period
      const previousPeriod = periods[1] || null
      if (previousPeriod && inv.periodStart === previousPeriod.start && inv.periodEnd === previousPeriod.end) {
        creatorRevenue[name].previousTR += inv.earnings
      }
    }
    // Build period keys list (newest first) for trend ordering
    const periodKeys = periods.map(p => `${p.start}|${p.end}`)
    const revenueByCreator = Object.values(creatorRevenue).map(c => {
      // Trend: oldest → newest (reverse of period order), last 4 periods
      const trend = periodKeys.slice(0, 4).map(k => c.periodTotals[k] || 0).reverse()
      // Period-over-period change
      const delta = c.previousTR > 0 ? (c.currentTR - c.previousTR) / c.previousTR : null
      return {
        name: c.name,
        currentTR: c.currentTR,
        previousTR: c.previousTR,
        delta,
        commissionPct: c.commissionPct,
        palmCut: c.currentPalmCut,
        status: c.status,
        trend,
      }
    }).sort((a, b) => b.currentTR - a.currentTR)

    const activeCreators = new Set(invoices
      .filter(i => currentPeriod && i.periodStart === currentPeriod.start)
      .map(i => i.aka || i.accountName)).size

    // Build period summary
    const periodSummaries = periods.slice(0, 6).map(p => ({
      start: p.start,
      end: p.end,
      label: p.label,
      totalTR: p.invoices.reduce((s, i) => s + i.earnings, 0),
      netProfit: p.invoices.reduce((s, i) => s + i.netProfit, 0),
    }))

    // =============================================
    // 2. EDITOR RUNWAY
    // =============================================
    const creatorIdSet = new Set(creators.map(c => c.id))

    // Group posts by creator
    const futurePostsByCreator = {}
    const postsByDateByCreator = {}
    for (const post of allPosts) {
      const creatorId = (post.fields?.Creator || [])[0]
      if (!creatorId || !creatorIdSet.has(creatorId)) continue
      const date = toETDateStr(post.fields?.['Scheduled Date'] || '')
      if (date) {
        if (!postsByDateByCreator[creatorId]) postsByDateByCreator[creatorId] = {}
        postsByDateByCreator[creatorId][date] = (postsByDateByCreator[creatorId][date] || 0) + 1
      }
      if (date && date > todayStr) {
        futurePostsByCreator[creatorId] = (futurePostsByCreator[creatorId] || 0) + 1
      }
    }

    // Group tasks by creator
    const tasksByCreator = {}
    for (const task of tasks) {
      const creatorId = (task.fields?.Creator || [])[0]
      if (!creatorId || !creatorIdSet.has(creatorId)) continue
      if (!tasksByCreator[creatorId]) tasksByCreator[creatorId] = []
      tasksByCreator[creatorId].push(task)
    }

    const editorRunway = creators.map(c => {
      const f = c.fields || {}
      const ctasks = tasksByCreator[c.id] || []
      const weeklyQuota = f['Weekly Reel Quota'] || 14
      const dailyQuota = Math.ceil(weeklyQuota / 7)
      const approvedBuffer = futurePostsByCreator[c.id] || 0
      // Runway = buffered posts ÷ this creator's daily quota. Was previously
      // hardcoded to /2 (assumed 2 posts/day for everyone). Now per-creator.
      const bufferDays = dailyQuota > 0
        ? parseFloat((approvedBuffer / dailyQuota).toFixed(1))
        : 0

      const doneThisWeek = ctasks.filter(t =>
        t.fields?.Status === 'Done' &&
        toETDateStr(t.fields?.['Completed At'] || '') >= weekStartStr &&
        t.fields?.['Admin Review Status'] !== 'Needs Revision'
      ).length

      return {
        id: c.id,
        name: f.AKA || f.Creator || '',
        bufferDays,
        approvedPosts: approvedBuffer,
        toEdit: ctasks.filter(t => t.fields?.Status === 'To Do').length,
        inProgress: ctasks.filter(t => t.fields?.Status === 'In Progress').length,
        needsRevision: ctasks.filter(t => t.fields?.['Admin Review Status'] === 'Needs Revision').length,
        inReview: ctasks.filter(t => t.fields?.Status === 'Done' && t.fields?.['Admin Review Status'] === 'Pending Review').length,
        quotaTarget: weeklyQuota,
        quotaDone: doneThisWeek,
      }
    })

    // =============================================
    // 3. CREATOR LIBRARY (unused raw clips, creator uploads only)
    // =============================================
    const libraryByCreator = {}
    for (const asset of libraryAssets) {
      const creatorId = (asset.fields?.['Palm Creators'] || [])[0]
      if (!creatorId || !creatorIdSet.has(creatorId)) continue
      if (!libraryByCreator[creatorId]) {
        libraryByCreator[creatorId] = { photos: 0, videos: 0, lastUploadAt: null }
      }

      // Classify using Asset Type field first (authoritative when set), fall
      // back to filename extension for legacy records without Asset Type.
      const assetType = asset.fields?.['Asset Type'] || ''
      const name = (asset.fields?.['Asset Name'] || '').toLowerCase()
      let isVideo
      if (assetType === 'Video') isVideo = true
      else if (assetType === 'Photo' || assetType === 'Image') isVideo = false
      else isVideo = /\.(mp4|mov|avi|webm|mkv|m4v)/.test(name)

      if (isVideo) libraryByCreator[creatorId].videos++
      else libraryByCreator[creatorId].photos++

      // Track most recent upload — Airtable's createdTime on the asset record.
      // Make.com automation creates the record when the file lands in Dropbox,
      // so this reads as "last time a clip showed up for this creator".
      const ct = asset.createdTime ? new Date(asset.createdTime).getTime() : 0
      if (ct && (!libraryByCreator[creatorId].lastUploadAt || ct > libraryByCreator[creatorId].lastUploadAt)) {
        libraryByCreator[creatorId].lastUploadAt = ct
      }
    }

    const creatorLibrary = creators.map(c => {
      const f = c.fields || {}
      const lib = libraryByCreator[c.id] || { photos: 0, videos: 0, lastUploadAt: null }
      return {
        opsId: c.id,
        name: f.AKA || f.Creator || '',
        photos: lib.photos,
        videos: lib.videos,
        total: lib.photos + lib.videos,
        lastUploadAt: lib.lastUploadAt ? new Date(lib.lastUploadAt).toISOString() : null,
      }
    })

    // =============================================
    // 4. PIPELINE HEALTH
    // =============================================
    const now = new Date()
    const todayStartUTC = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const weekStartUTC = new Date(todayStartUTC)
    weekStartUTC.setDate(weekStartUTC.getDate() - weekStartUTC.getDay())

    let scrapedToday = 0
    let scrapedThisWeek = 0
    let reviewQueue = 0
    for (const rec of sourceReels) {
      const createdTime = rec.createdTime ? new Date(rec.createdTime) : null
      if (createdTime) {
        if (createdTime >= todayStartUTC) scrapedToday++
        if (createdTime >= weekStartUTC) scrapedThisWeek++
      }
      const ds = rec.fields?.['Data Source'] || ''
      const rs = rec.fields?.['Review Status'] || ''
      const imported = rec.fields?.['Imported to Inspiration'] || ''
      if ((ds === 'Manual' || ds === 'IG Export') && imported !== 'Yes' && (rs === 'Pending Review' || !rs)) {
        reviewQueue++
      }
    }

    const statusCounts = {}
    let analysisQueue = 0
    let analyzedThisWeek = 0
    for (const rec of inspoRecords) {
      const status = rec.fields?.Status || 'Unknown'
      statusCounts[status] = (statusCounts[status] || 0) + 1
      if (status === 'Ready for Analysis') analysisQueue++
    }

    let promotedThisWeek = 0
    // Source reels that were imported this week
    for (const rec of sourceReels) {
      if (rec.fields?.['Imported to Inspiration'] === 'Yes') {
        const createdTime = rec.createdTime ? new Date(rec.createdTime) : null
        if (createdTime && createdTime >= weekStartUTC) promotedThisWeek++
      }
    }

    const enabledSources = inspoSources.filter(r => r.fields?.Enabled)
    let lastScrape = null
    for (const rec of inspoSources) {
      const ts = rec.fields?.['Last Scraped At']
      if (ts && (!lastScrape || ts > lastScrape)) lastScrape = ts
    }

    // =============================================
    // 5. POSTING ACTIVITY
    // =============================================
    const postingByCreator = creators.map(c => {
      const f = c.fields || {}
      const name = f.AKA || f.Creator || ''
      const posts = postsByDateByCreator[c.id] || {}
      let postedToday = 0
      let postedThisWeek = 0
      let telegramPending = 0

      // Build 7-day calendar
      const calendar = {}
      for (let d = 0; d < 7; d++) {
        const date = new Date(estNow)
        date.setDate(estNow.getDate() - (6 - d))
        const dateStr = estDateStr(date)
        calendar[dateStr] = posts[dateStr] || 0
      }

      // Count today/week
      for (const post of allPosts) {
        const creatorId = (post.fields?.Creator || [])[0]
        if (creatorId !== c.id) continue
        const date = toETDateStr(post.fields?.['Scheduled Date'] || '')
        if (date === todayStr) postedToday++
        if (date >= weekStartStr) postedThisWeek++
        if (!post.fields?.['Telegram Sent At'] && date && date <= todayStr) {
          telegramPending++
        }
      }

      return { name, postedToday, postedThisWeek, telegramPending, calendar }
    })

    // =============================================
    // 6. ALERTS
    // =============================================
    const alerts = []

    // Low runway (<2 days)
    for (const er of editorRunway) {
      if (er.bufferDays < 2) {
        alerts.push({ type: 'low_runway', creator: er.name, bufferDays: er.bufferDays })
      }
    }

    // Overdue invoices (Sent + due date in the past)
    for (const inv of invoices) {
      if (inv.status === 'Sent' && inv.dueDate && inv.dueDate < todayStr) {
        alerts.push({ type: 'overdue_invoice', creator: inv.aka || inv.accountName, amount: inv.netProfit, dueDate: inv.dueDate })
      }
    }

    // Stuck revisions (>24h)
    for (const er of editorRunway) {
      if (er.needsRevision > 0) {
        alerts.push({ type: 'revision_stuck', creator: er.name, count: er.needsRevision })
      }
    }

    // Analysis errors
    if (statusCounts['Error']) {
      alerts.push({ type: 'analysis_errors', count: statusCounts['Error'] })
    }

    // Empty library
    for (const cl of creatorLibrary) {
      if (cl.total === 0) {
        alerts.push({ type: 'empty_library', creator: cl.name })
      }
    }

    // New long-form / OFTV projects (last 7 days)
    try {
      const oftvRecords = await fetchAirtableRecords('tbl7DTdRooCsAns7j', {
        filterByFormula: `IS_AFTER({Created At}, DATEADD(NOW(), -7, 'days'))`,
        sort: [{ field: 'Created At', direction: 'desc' }],
      })
      const creatorNamesById = {}
      for (const cl of creatorLibrary) {
        if (cl.opsId) creatorNamesById[cl.opsId] = cl.name
      }
      for (const r of oftvRecords) {
        const f = r.fields || {}
        const creatorId = (f['Creator'] || [])[0]
        alerts.push({
          type: 'new_oftv_project',
          projectId: r.id,
          projectName: f['Project Name'] || 'Untitled',
          status: f['Status'] || 'Awaiting Upload',
          fileCount: f['File Count'] || 0,
          creator: creatorNamesById[creatorId] || '',
          createdAt: f['Created At'] || null,
        })
      }
    } catch (err) {
      console.warn('[Admin Dashboard] OFTV alert fetch failed:', err.message)
    }

    // Period-over-period deltas for KPIs
    const previousPeriod = periods[1] || null
    const previousPeriodTR = previousPeriod
      ? previousPeriod.invoices.reduce((s, i) => s + i.earnings, 0) : 0
    const previousPeriodNetProfit = previousPeriod
      ? previousPeriod.invoices.reduce((s, i) => s + i.netProfit, 0) : 0
    const trDelta = previousPeriodTR > 0 ? (currentPeriodTR - previousPeriodTR) / previousPeriodTR : null
    const profitDelta = previousPeriodNetProfit > 0 ? (currentPeriodNetProfit - previousPeriodNetProfit) / previousPeriodNetProfit : null

    return NextResponse.json({
      revenue: {
        activeCreators,
        currentPeriodTR,
        totalCommission: currentPeriodCommission,
        totalChatCost: currentPeriodChatCost,
        netProfit: currentPeriodNetProfit,
        trDelta,
        profitDelta,
        projectedMonthlyRevenue: Math.round(projectedMonthlyRevenue),
        projectedMonthlyNetProfit: Math.round(projectedMonthlyNetProfit),
        outstandingInvoices: { count: outstandingCount, total: Math.round(outstandingTotal) },
        byCreator: revenueByCreator,
        periods: periodSummaries,
        currentPeriodLabel: currentPeriod?.label || '',
      },
      editorRunway,
      creatorLibrary,
      pipeline: {
        scrapedToday,
        scrapedThisWeek,
        reviewQueue,
        analysisQueue,
        promotedThisWeek,
        sourcesEnabled: enabledSources.length,
        lastScrape,
        byStatus: statusCounts,
      },
      posting: postingByCreator,
      alerts,
    })
  } catch (err) {
    console.error('[Admin Dashboard] GET error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
