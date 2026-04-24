/**
 * Creator setup orchestration.
 * Replaces the old Make.com automation that used to create:
 *   - 8 standard Social Account records (HQ Accounts table)
 *   - Matching Credentials records (HQ Credentials table)
 *   - Dropbox folder tree under /Palm Ops/Creators/{aka}/
 *   - Two Dropbox file requests (Social + Long Form)
 *   - Updates the HQ Onboarding record with all paths/URLs
 *
 * Trigger via: POST /api/admin/onboarding/run-setup
 */

import {
  getDropboxAccessToken,
  getDropboxRootNamespaceId,
  createDropboxFolder,
} from '@/lib/dropbox'
import {
  createDropboxFileRequest,
  listDropboxFileRequests,
} from '@/lib/dropboxFileRequests'
import {
  fetchHqRecord,
  fetchHqRecords,
  createHqRecord,
  patchHqRecord,
} from '@/lib/hqAirtable'
import {
  fetchAirtableRecords,
  createAirtableRecord,
} from '@/lib/adminAuth'

// HQ table IDs
const HQ_CREATORS = 'tblYhkNvrNuOAHfgw'
const HQ_ACCOUNTS = 'tblR5WuYbzmtUyHi8'
const HQ_CREDENTIALS = 'tblySXKMmS6SpZenE'
const HQ_ONBOARDING = 'tbl4nFzgH6nJHr3q6'

// Ops tables (for SM Setup Requests)
const OPS_SM_SETUP_REQUESTS = 'SM Setup Requests'
const OPS_PALM_CREATORS = 'Palm Creators'

// Non-IG social accounts every creator gets. Palm IG 1/2/3 + Link Me are no
// longer auto-created here — they live in the SM Setup Requests flow so a human
// (SMM) picks the usernames. IG Main is conditional on the creator providing a
// handle during onboarding.
const STANDARD_ACCOUNTS = [
  { suffix: 'Tiktok',     platform: 'TikTok',    managedByPalm: true  },
  { suffix: 'Youtube',    platform: 'YouTube',   managedByPalm: true  },
  { suffix: 'OFTV',       platform: 'OFTV',      managedByPalm: true  },
]

const IG_MAIN_ACCOUNT = { suffix: 'IG Main', platform: 'Instagram', managedByPalm: false }

// Standard Dropbox folder tree under /Palm Ops/Creators/{aka}/
function buildFolderPaths(aka) {
  const root = `/Palm Ops/Creators/${aka}`
  return {
    root,
    folders: [
      root,
      `${root}/Social Media`,
      `${root}/Social Media/00_INCOMING_FILE_REQUEST`,
      `${root}/Social Media/10_UNREVIEWED_LIBRARY`,
      `${root}/Social Media/20_NEEDS_EDIT`,
      `${root}/Social Media/35_FINALS_FOR_REVIEW`,
      `${root}/Long Form`,
      `${root}/Long Form/10_UNREVIEWED_LIBRARY`,
    ],
    socialUploadPath: `${root}/Social Media/00_INCOMING_FILE_REQUEST`,
    longformUploadPath: `${root}/Long Form/10_UNREVIEWED_LIBRARY`,
  }
}

/**
 * Find or create the Onboarding record for a creator.
 */
export async function getOrCreateOnboardingRecord(creatorRecordId, creatorName) {
  // Look up existing record by linked Creator
  const existing = await fetchHqRecords(HQ_ONBOARDING, {
    filterByFormula: `FIND("${creatorRecordId}", ARRAYJOIN({Creator}))`,
    maxRecords: 1,
  })
  if (existing.length > 0) return existing[0]

  return createHqRecord(HQ_ONBOARDING, {
    'Creator Name': creatorName,
    'Creator': [creatorRecordId],
  })
}

/**
 * Create the standard Dropbox folder tree. Idempotent — skips folders that
 * already exist (handled by createDropboxFolder's 409 logic).
 */
export async function createCreatorFolders(accessToken, rootNamespaceId, aka) {
  const { folders, root, socialUploadPath, longformUploadPath } = buildFolderPaths(aka)
  // Sequential — children depend on parents existing
  for (const path of folders) {
    await createDropboxFolder(accessToken, rootNamespaceId, path)
  }
  return { rootPath: root, socialUploadPath, longformUploadPath }
}

/**
 * Create the two standard file requests (Social + Long Form).
 * Idempotent — checks for existing requests by destination first.
 */
export async function createCreatorFileRequests(accessToken, rootNamespaceId, aka, { socialUploadPath, longformUploadPath }) {
  // Look up existing file requests so we don't duplicate
  let existing = []
  try {
    existing = await listDropboxFileRequests(accessToken, rootNamespaceId)
  } catch (err) {
    console.warn('[creatorSetup] listDropboxFileRequests failed, will create new:', err.message)
  }

  const findByDest = (dest) => existing.find(fr => fr.destination === dest)

  let social = findByDest(socialUploadPath)
  if (!social) {
    social = await createDropboxFileRequest(accessToken, rootNamespaceId, {
      title: `${aka} – Social Uploads`,
      destination: socialUploadPath,
    })
  }

  let longform = findByDest(longformUploadPath)
  if (!longform) {
    longform = await createDropboxFileRequest(accessToken, rootNamespaceId, {
      title: `${aka} – Long Form Uploads`,
      destination: longformUploadPath,
    })
  }

  return { social, longform }
}

/**
 * Create the standard non-IG Account records (TikTok, YouTube, OFTV).
 * IG Main is added only if the creator supplied a handle during onboarding.
 * Palm IG 1/2/3 + Link Me are intentionally skipped here — they're created by
 * the SMM via /sm/setup-requests once usernames are decided.
 * Idempotent — skips any account whose name already exists for this creator.
 */
export async function createDefaultSocialAccounts(creatorRecordId, aka, { igHandle } = {}) {
  const existing = await fetchHqRecords(HQ_ACCOUNTS, {
    filterByFormula: `FIND("${creatorRecordId}", ARRAYJOIN({Creator}))`,
    fields: ['Account Name'],
  })
  const existingNames = new Set(existing.map(r => r.fields['Account Name']))

  const accountsToCreate = [...STANDARD_ACCOUNTS]
  if (igHandle && igHandle.trim()) accountsToCreate.unshift(IG_MAIN_ACCOUNT)

  const created = []
  for (const acc of accountsToCreate) {
    const name = `${aka} - ${acc.suffix}`
    if (existingNames.has(name)) {
      created.push({ name, recordId: existing.find(r => r.fields['Account Name'] === name).id, skipped: true })
      continue
    }

    const fields = {
      'Account Name': name,
      'Creator': [creatorRecordId],
      'Platform': acc.platform,
      'Managed by Palm': acc.managedByPalm,
    }

    const rec = await createHqRecord(HQ_ACCOUNTS, fields)
    created.push({ name, recordId: rec.id, skipped: false })
  }

  return created
}

/**
 * Create an SM Setup Request (Ops base) for this creator so the SMM has a
 * row to work through for Palm IG 1/2/3 setup. Idempotent — skips if a
 * non-Complete request already exists for this creator.
 */
export async function createSmSetupRequest(hqCreatorRecordId, { fullName, aka, dob, profilePhotos = [] }) {
  // Resolve the Ops Palm Creators record via HQ Record ID
  const opsRecs = await fetchAirtableRecords(OPS_PALM_CREATORS, {
    filterByFormula: `{HQ Record ID}='${hqCreatorRecordId}'`,
    fields: ['Creator', 'AKA', 'HQ Record ID'],
    maxRecords: 1,
  })
  const opsRec = opsRecs[0]

  // Check for existing non-complete request
  const opsFilter = opsRec
    ? `AND({Status}!='Complete', FIND("${opsRec.id}", ARRAYJOIN({Creator})))`
    : `AND({Status}!='Complete', {Full Name}='${(fullName || '').replace(/'/g, "\\'")}')`
  const existing = await fetchAirtableRecords(OPS_SM_SETUP_REQUESTS, {
    filterByFormula: opsFilter,
    maxRecords: 1,
  })
  if (existing.length) {
    return { recordId: existing[0].id, skipped: true }
  }

  const fields = {
    'Request Name': `${aka || fullName} — Palm IG setup`,
    'Full Name': fullName || '',
    'AKA': aka || '',
    'Status': 'Pending',
    'Requested At': new Date().toISOString(),
  }
  if (dob) fields.DOB = dob
  if (opsRec) fields.Creator = [opsRec.id]
  if (profilePhotos.length) {
    fields['Profile Pics'] = profilePhotos.map(p => ({ url: p.url, filename: p.filename }))
  }

  const rec = await createAirtableRecord(OPS_SM_SETUP_REQUESTS, fields)
  return { recordId: rec.id, skipped: false }
}

/**
 * Create one Credentials record per Account. Skips if a Credentials record
 * with the same Account Name already exists.
 */
export async function createCredentialsForAccounts(accounts) {
  const accountNames = accounts.map(a => a.name)
  if (accountNames.length === 0) return []

  // Fetch existing credentials by name to dedup
  const filter = `OR(${accountNames.map(n => `{Account Name}="${n.replace(/"/g, '\\"')}"`).join(',')})`
  const existing = await fetchHqRecords(HQ_CREDENTIALS, {
    filterByFormula: filter,
    fields: ['Account Name'],
  })
  const existingNames = new Set(existing.map(r => r.fields['Account Name']))

  const created = []
  for (const acc of accounts) {
    if (existingNames.has(acc.name)) {
      created.push({ name: acc.name, skipped: true })
      continue
    }

    const rec = await createHqRecord(HQ_CREDENTIALS, {
      'Account Name': acc.name,
      'Account': [acc.recordId],
    })
    created.push({ name: acc.name, recordId: rec.id, skipped: false })
  }

  return created
}

/**
 * Run the full creator setup pipeline.
 * @param {string} creatorRecordId - HQ Creators record ID
 * @returns {object} summary of what was created/skipped
 */
export async function runFullCreatorSetup(creatorRecordId) {
  // 1. Pull creator record to get name + AKA + IG handle + photos
  const creator = await fetchHqRecord(HQ_CREATORS, creatorRecordId)
  const creatorName = creator.fields['Creator']
  const aka = creator.fields['AKA'] || creatorName
  if (!aka) throw new Error(`Creator ${creatorRecordId} has no AKA or name`)
  const igHandle = creator.fields['IG Account']
  const dob = creator.fields['Birthday']
  const profilePhotos = (creator.fields['Profile Photos'] || []).map(p => ({
    url: p.url, filename: p.filename,
  }))

  // 2. Get / create Onboarding record (we'll write paths back to it)
  const onboardingRec = await getOrCreateOnboardingRecord(creatorRecordId, creatorName)

  // 3. Get Dropbox auth (parallel with Airtable account creation)
  const [accessToken, accountsResult] = await Promise.all([
    getDropboxAccessToken(),
    createDefaultSocialAccounts(creatorRecordId, aka, { igHandle }),
  ])
  const rootNamespaceId = await getDropboxRootNamespaceId(accessToken)

  // 4. Create credentials records for every account
  const credentialsResult = await createCredentialsForAccounts(accountsResult)

  // 5. Create folder tree
  const folderInfo = await createCreatorFolders(accessToken, rootNamespaceId, aka)

  // 6. Create file requests
  const fileRequests = await createCreatorFileRequests(accessToken, rootNamespaceId, aka, folderInfo)

  // 7. Create SM Setup Request (Ops base) — replaces the old Palm IG 1/2/3 auto-create
  let smSetupRequest = null
  try {
    smSetupRequest = await createSmSetupRequest(creatorRecordId, {
      fullName: creatorName,
      aka,
      dob,
      profilePhotos,
    })
  } catch (err) {
    console.error('[creatorSetup] createSmSetupRequest failed (non-fatal):', err.message)
  }

  // 8. Update Onboarding record with all paths/URLs
  await patchHqRecord(HQ_ONBOARDING, onboardingRec.id, {
    'Default Social Accounts Created': true,
    'Credentials Records Created': true,
    'Dropbox Folder Structure Created': true,
    'Social File Request Created': true,
    'Longform File Request Created': true,
    'Dropbox Creator Root Path': folderInfo.rootPath,
    'Social Upload Folder Path': folderInfo.socialUploadPath,
    'Longform Upload Folder Path': folderInfo.longformUploadPath,
    'Social File Request ID': fileRequests.social.id,
    'Social File Request URL': fileRequests.social.url,
    'Longform File Request ID': fileRequests.longform.id,
    'Longform File Request URL': fileRequests.longform.url,
    'Trigger Social Accounts Records': 'Social Accounts Created',
    'Create Dropbox Folders': 'Dropbox Folders Made',
  })

  // 9. Mark Creator record as accounts created
  await patchHqRecord(HQ_CREATORS, creatorRecordId, {
    'Accounts Created?': true,
  })

  return {
    creatorRecordId,
    aka,
    onboardingRecordId: onboardingRec.id,
    accounts: accountsResult,
    credentials: credentialsResult,
    folders: folderInfo,
    fileRequests,
    smSetupRequest,
  }
}
