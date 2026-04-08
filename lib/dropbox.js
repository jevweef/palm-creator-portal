const DROPBOX_APP_KEY = process.env.DROPBOX_APP_KEY
const DROPBOX_APP_SECRET = process.env.DROPBOX_APP_SECRET
const DROPBOX_REFRESH_TOKEN = process.env.DROPBOX_REFRESH_TOKEN

let cachedAccessToken = null
let tokenExpiresAt = 0

export async function getDropboxAccessToken() {
  // Return cached token if still valid (with 60s buffer)
  if (cachedAccessToken && Date.now() < tokenExpiresAt - 60000) {
    return cachedAccessToken
  }

  const res = await fetch('https://api.dropbox.com/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${DROPBOX_APP_KEY}:${DROPBOX_APP_SECRET}`).toString('base64'),
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: DROPBOX_REFRESH_TOKEN,
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Dropbox token refresh failed: ${res.status} ${err}`)
  }

  const data = await res.json()
  cachedAccessToken = data.access_token
  tokenExpiresAt = Date.now() + (data.expires_in * 1000)
  return cachedAccessToken
}

export async function getDropboxRootNamespaceId(accessToken) {
  const res = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!res.ok) {
    throw new Error(`Dropbox get_current_account failed: ${res.status}`)
  }

  const data = await res.json()
  return data.root_info.root_namespace_id
}

export async function uploadToDropbox(accessToken, rootNamespaceId, filePath, fileBuffer) {
  const res = await fetch('https://content.dropboxapi.com/2/files/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Dropbox-API-Arg': JSON.stringify({
        path: filePath,
        mode: 'add',
        autorename: true,
        mute: true,
      }),
      'Dropbox-API-Path-Root': JSON.stringify({
        '.tag': 'root',
        root: rootNamespaceId,
      }),
      'Content-Type': 'application/octet-stream',
    },
    body: fileBuffer,
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Dropbox upload failed: ${res.status} ${err}`)
  }

  return res.json()
}

export async function createDropboxSharedLink(accessToken, rootNamespaceId, filePath) {
  const res = await fetch('https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Dropbox-API-Path-Root': JSON.stringify({
        '.tag': 'root',
        root: rootNamespaceId,
      }),
    },
    body: JSON.stringify({
      path: filePath,
      settings: { requested_visibility: 'public' },
    }),
  })

  if (!res.ok) {
    // If link already exists, fetch it
    if (res.status === 409) {
      const existing = await fetch('https://api.dropboxapi.com/2/sharing/list_shared_links', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Dropbox-API-Path-Root': JSON.stringify({
            '.tag': 'root',
            root: rootNamespaceId,
          }),
        },
        body: JSON.stringify({ path: filePath, direct_only: true }),
      })
      if (existing.ok) {
        const data = await existing.json()
        if (data.links && data.links.length > 0) {
          return data.links[0].url
        }
      }
    }
    const err = await res.text()
    throw new Error(`Dropbox shared link failed: ${res.status} ${err}`)
  }

  const data = await res.json()
  return data.url
}

export async function deleteDropboxFile(accessToken, rootNamespaceId, filePath) {
  const res = await fetch('https://api.dropboxapi.com/2/files/delete_v2', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Dropbox-API-Path-Root': JSON.stringify({
        '.tag': 'root',
        root: rootNamespaceId,
      }),
    },
    body: JSON.stringify({ path: filePath }),
  })

  if (!res.ok) {
    const err = await res.text()
    // Don't throw on 409 (not found) — file may already be deleted
    if (res.status === 409) {
      console.warn(`Dropbox delete: file not found at ${filePath}`)
      return null
    }
    throw new Error(`Dropbox delete failed: ${res.status} ${err}`)
  }

  return res.json()
}
