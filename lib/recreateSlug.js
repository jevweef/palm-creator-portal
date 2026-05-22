// Canonical naming for the AI Recreate pipeline.
//
// One slug travels with the work from the moment a Stage B job is
// submitted through TJP and back into the final Asset/Task, so an admin
// looking at a rejected video can trace it to its still in one step.
//
// Format:
//   Stage B Output:   {Aka}_R{nnn}_S{nn}              e.g. Amelia_R042_S01
//   Outfit Variant:   {ParentSlug}_O{nn}              e.g. Amelia_R042_S01_O03
//
// Reel #  = sequential per creator (the 42nd distinct reel this creator
//           has run through Stage B).
// Still # = sequential per (creator, reel) pair (a 2nd still from the
//           same reel — e.g. captured at a different timestamp).
// Variant # = sequential per parent Stage B Output.

import { fetchAirtableRecords } from '@/lib/adminAuth'

const STAGE_B_OUTPUTS = 'Stage B Outputs'
const OUTFIT_SWAP_OUTPUTS = 'Outfit Swap Outputs'

// Slugify a creator's AKA into a filesystem-safe identifier.
// "Amelia Rae" -> "AmeliaRae", "Sunny D." -> "SunnyD". Keep letters
// only; numbers are stripped to avoid R042 vs the AKA's "12" colliding.
export function slugifyAka(aka) {
  const cleaned = String(aka || '').replace(/[^A-Za-z]+/g, '')
  return cleaned || 'Creator'
}

const pad = (n, w) => String(Math.max(1, n)).padStart(w, '0')

// Look up the next (Reel #, Still #) for a creator + reel pairing.
// Reads ALL of this creator's Stage B Outputs once so the
// reel-number assignment is stable: if reelId has been used before by
// this creator, reuse that number; else assign max+1. Within a reel,
// Still # = max(existing Still #) + 1 — a monotonic counter that
// never reuses a slot, even when older records get deleted or
// rejected. Slugs stay globally unique within a reel for the
// lifetime of the creator's project.
//
// Why max+1 instead of length+1:
//   length+1 collided when records got deleted between Generate calls
//   (e.g. S01 + S02 + S03 exist, S01 gets deleted → length=2 → next
//   Still # computes as 3, colliding with the surviving S03). A
//   monotonic counter is the only thing that survives deletes
//   without bookkeeping.
//
// Idempotent — running twice for the same record won't drift, but DO
// pass an excludeRecordId when resolving for an existing record (so it
// doesn't count itself).
export async function nextStageBSequence({ creatorId, reelRecordId, excludeRecordId = null }) {
  const rows = await fetchAirtableRecords(STAGE_B_OUTPUTS, {
    fields: ['Creator', 'Source Reel', 'Reel #', 'Still #'],
  })
  const mine = rows
    .filter(r => (r.fields?.Creator || []).includes(creatorId))
    .filter(r => r.id !== excludeRecordId)

  // Reel #: reuse if this reel has shown up before, else max+1.
  let reelNum = null
  if (reelRecordId) {
    for (const r of mine) {
      if ((r.fields?.['Source Reel'] || []).includes(reelRecordId) && r.fields?.['Reel #']) {
        reelNum = r.fields['Reel #']
        break
      }
    }
  }
  if (reelNum == null) {
    const distinct = new Map() // reelRecordId -> number
    for (const r of mine) {
      const rid = (r.fields?.['Source Reel'] || [])[0]
      const n = r.fields?.['Reel #']
      if (rid && n && !distinct.has(rid)) distinct.set(rid, n)
    }
    const maxN = distinct.size ? Math.max(...distinct.values()) : 0
    reelNum = maxN + 1
  }

  // Still #: per (creator, reelRecordId), max(existing Still #) + 1.
  const stillsForThisReel = mine.filter(r =>
    reelRecordId
      ? (r.fields?.['Source Reel'] || []).includes(reelRecordId)
      : (r.fields?.['Reel #'] === reelNum)
  )
  const maxStill = stillsForThisReel.reduce((m, r) => Math.max(m, r.fields?.['Still #'] || 0), 0)
  const stillNum = maxStill + 1

  return { reelNum, stillNum }
}

// Slug for a Stage B Output. Pad reel to 3 digits, still to 2.
export function stageBSlug({ aka, reelNum, stillNum }) {
  return `${slugifyAka(aka)}_R${pad(reelNum, 3)}_S${pad(stillNum, 2)}`
}

// Look up the next Variant # for an outfit swap given its parent
// Stage B Output. Reads existing variants linked to that parent and
// returns count+1.
export async function nextOutfitVariantNumber({ stageBOutputId, excludeRecordId = null }) {
  if (!stageBOutputId) return 1
  const rows = await fetchAirtableRecords(OUTFIT_SWAP_OUTPUTS, {
    fields: ['Stage B Parent', 'Variant #'],
  })
  const siblings = rows
    .filter(r => (r.fields?.['Stage B Parent'] || []).includes(stageBOutputId))
    .filter(r => r.id !== excludeRecordId)
  if (!siblings.length) return 1
  const maxVar = Math.max(0, ...siblings.map(r => r.fields?.['Variant #'] || 0))
  return Math.max(siblings.length, maxVar) + 1
}

export function outfitSlug({ parentSlug, variantNum }) {
  return `${parentSlug}_O${pad(variantNum, 2)}`
}

// Parse a slug back into its parts. Returns null if the string doesn't
// match the canonical format. Tolerant of file extensions / suffixes
// (e.g. "Amelia_R042_S01_O03.mp4" or "Amelia_R042_S01_O03_final" still
// parse the leading slug).
//   "Amelia_R042_S01"       -> { aka:'Amelia', reelNum:42, stillNum:1 }
//   "Amelia_R042_S01_O03"   -> { aka:'Amelia', reelNum:42, stillNum:1, variantNum:3 }
export function parseSlug(input) {
  if (!input) return null
  const m = String(input).match(/^([A-Za-z]+)_R(\d{1,4})_S(\d{1,3})(?:_O(\d{1,3}))?/)
  if (!m) return null
  return {
    aka: m[1],
    reelNum: parseInt(m[2], 10),
    stillNum: parseInt(m[3], 10),
    variantNum: m[4] ? parseInt(m[4], 10) : null,
  }
}
