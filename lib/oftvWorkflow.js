/**
 * OFTV Project workflow — single source of truth for statuses, styling,
 * and role-aware bucketing. Imported by every OFTV view (admin, editor,
 * creator) so the workflow stays consistent and we don't drift across
 * surfaces.
 *
 * Lifecycle:
 *   Awaiting Upload → Files Uploaded → In Editing → Final Submitted (admin alert)
 *     → Sent to Creator (creator alert) → Approved (terminal, inactive)
 *     ↘ Admin Revision (back to editor)
 *     ↘ Creator Revision (back to editor)
 *
 * Only `Approved` and `Archived` are inactive — everything else is "in flight".
 */

export const STATUSES = {
  AWAITING_UPLOAD: 'Awaiting Upload',
  FILES_UPLOADED: 'Files Uploaded',
  IN_EDITING: 'In Editing',
  FINAL_SUBMITTED: 'Final Submitted',
  ADMIN_REVISION: 'Admin Revision',
  SENT_TO_CREATOR: 'Sent to Creator',
  CREATOR_REVISION: 'Creator Revision',
  APPROVED: 'Approved',
  ARCHIVED: 'Archived',
}

export const STATUS_STYLES = {
  'Awaiting Upload': { bg: 'rgba(156, 163, 175, 0.10)', color: '#9ca3af', label: 'Awaiting Upload' },
  'Files Uploaded':  { bg: 'rgba(120, 180, 232, 0.10)', color: '#78B4E8', label: 'Files Uploaded' },
  'In Editing':      { bg: 'rgba(232, 200, 120, 0.10)', color: '#E8C878', label: 'In Editing' },
  'Final Submitted': { bg: 'rgba(232, 120, 120, 0.12)', color: '#E87878', label: 'Final Submitted', urgent: true },
  'Admin Revision':  { bg: 'rgba(232, 168, 120, 0.10)', color: '#E8A878', label: 'Admin Revision' },
  'Sent to Creator': { bg: 'rgba(120, 200, 220, 0.10)', color: '#78D4E8', label: 'Sent to Creator', urgent: 'creator' },
  'Creator Revision':{ bg: 'rgba(232, 160, 200, 0.10)', color: '#E8A0C8', label: 'Creator Revision' },
  'Approved':        { bg: 'rgba(125, 211, 164, 0.12)', color: '#7DD3A4', label: 'Approved' },
  'Archived':        { bg: 'rgba(156, 163, 175, 0.06)', color: '#6b7280', label: 'Archived' },
}

export const ALL_STATUSES = Object.values(STATUSES)

export const ACTIVE_STATUSES = ALL_STATUSES.filter(
  s => s !== STATUSES.APPROVED && s !== STATUSES.ARCHIVED
)

// What needs the role's attention (drives badges + red-light alerts)
export const ADMIN_NEEDS_REVIEW = [STATUSES.FINAL_SUBMITTED]
export const CREATOR_NEEDS_REVIEW = [STATUSES.SENT_TO_CREATOR]
export const EDITOR_NEEDS_WORK = [
  STATUSES.FILES_UPLOADED,
  STATUSES.IN_EDITING,
  STATUSES.ADMIN_REVISION,
  STATUSES.CREATOR_REVISION,
]

// Bucket labels per role for the queue UI
export function getBucketsForRole(role) {
  if (role === 'admin') {
    return [
      { key: 'review', label: '🔴 Needs Your Review', urgent: true, statuses: ADMIN_NEEDS_REVIEW },
      { key: 'inflight', label: 'In Flight', urgent: false, statuses: [
        STATUSES.AWAITING_UPLOAD,
        STATUSES.FILES_UPLOADED,
        STATUSES.IN_EDITING,
        STATUSES.ADMIN_REVISION,
        STATUSES.CREATOR_REVISION,
        STATUSES.SENT_TO_CREATOR,
      ]},
      { key: 'done', label: 'Approved', urgent: false, statuses: [STATUSES.APPROVED] },
      { key: 'archived', label: 'Archived', urgent: false, statuses: [STATUSES.ARCHIVED] },
    ]
  }
  if (role === 'editor') {
    return [
      { key: 'work', label: '🔨 Needs Editing', urgent: false, statuses: EDITOR_NEEDS_WORK },
      { key: 'waiting', label: '⏳ Waiting on Review', urgent: false, statuses: [STATUSES.FINAL_SUBMITTED, STATUSES.SENT_TO_CREATOR] },
      { key: 'awaiting', label: 'Awaiting Creator Files', urgent: false, statuses: [STATUSES.AWAITING_UPLOAD] },
      { key: 'done', label: 'Approved', urgent: false, statuses: [STATUSES.APPROVED] },
    ]
  }
  // creator
  return [
    { key: 'review', label: '🔴 Ready for Your Review', urgent: true, statuses: CREATOR_NEEDS_REVIEW },
    { key: 'inflight', label: 'In Progress', urgent: false, statuses: [
      STATUSES.AWAITING_UPLOAD,
      STATUSES.FILES_UPLOADED,
      STATUSES.IN_EDITING,
      STATUSES.FINAL_SUBMITTED,
      STATUSES.ADMIN_REVISION,
      STATUSES.CREATOR_REVISION,
    ]},
    { key: 'done', label: 'Completed', urgent: false, statuses: [STATUSES.APPROVED] },
  ]
}

// Where does a project belong in this role's queue right now?
export function bucketForProject(project, role) {
  const buckets = getBucketsForRole(role)
  for (const b of buckets) {
    if (b.statuses.includes(project.status)) return b
  }
  return null
}

// Used by sync/final endpoints to decide whether incoming final-cut files
// should trigger an automatic flip to Final Submitted.
export const STATUSES_THAT_AUTO_FLIP_TO_FINAL = [
  STATUSES.FILES_UPLOADED,
  STATUSES.IN_EDITING,
  STATUSES.ADMIN_REVISION,
  STATUSES.CREATOR_REVISION,
]
