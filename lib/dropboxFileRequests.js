/**
 * Dropbox File Request helpers.
 * File requests let external users upload files to a destination folder
 * without needing a Dropbox account.
 *
 * API docs: https://www.dropbox.com/developers/documentation/http/documentation#file_requests
 */

/**
 * Create a Dropbox file request that uploads land in `destination`.
 * @returns {{ id: string, url: string }}
 */
export async function createDropboxFileRequest(accessToken, rootNamespaceId, { title, destination, deadline = null, open = true }) {
  const body = { title, destination, open }
  if (deadline) body.deadline = { deadline }

  const res = await fetch('https://api.dropboxapi.com/2/file_requests/create', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Dropbox-API-Path-Root': JSON.stringify({
        '.tag': 'root',
        root: rootNamespaceId,
      }),
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Dropbox file_requests/create failed: ${res.status} ${err}`)
  }

  const data = await res.json()
  return { id: data.id, url: data.url }
}

/**
 * List existing file requests so we can dedup before creating.
 * @returns {Array<{ id, url, title, destination }>}
 */
export async function listDropboxFileRequests(accessToken, rootNamespaceId) {
  const res = await fetch('https://api.dropboxapi.com/2/file_requests/list_v2', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Dropbox-API-Path-Root': JSON.stringify({
        '.tag': 'root',
        root: rootNamespaceId,
      }),
    },
    body: JSON.stringify({ limit: 1000 }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Dropbox file_requests/list failed: ${res.status} ${err}`)
  }

  const data = await res.json()
  return (data.file_requests || []).map(fr => ({
    id: fr.id,
    url: fr.url,
    title: fr.title,
    destination: fr.destination,
  }))
}
