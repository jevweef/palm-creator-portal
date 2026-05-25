// Helpers to safely interpolate user-supplied values into Airtable
// filterByFormula strings.
//
// Airtable's formula language treats string literals like SQL — unescaped
// quotes break out of the string and let the caller inject arbitrary formula
// logic. `quoteAirtableString` returns a properly single-quoted, escaped
// literal you can drop directly into a formula. `isValidRecordId` is a strict
// allowlist for `recXXXXXXXXXXXXXX` IDs.

export function quoteAirtableString(value) {
  const escaped = String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
  return `'${escaped}'`
}

export function isValidRecordId(value) {
  return typeof value === 'string' && /^rec[A-Za-z0-9]{14}$/.test(value)
}

// Throw if not a valid recordId — use at API entry points where the caller
// supplied the value (query param, body field, etc.)
export function assertRecordId(value, label = 'recordId') {
  if (!isValidRecordId(value)) {
    const err = new Error(`Invalid ${label}: expected format recXXXXXXXXXXXXXX`)
    err.status = 400
    throw err
  }
  return value
}
