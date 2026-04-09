import OpenAI from 'openai'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

/**
 * Generate an embedding vector for the given text using text-embedding-3-small.
 * Returns a Float64Array of 1536 dimensions.
 */
export async function embedText(text) {
  if (!text || text.trim().length === 0) return null
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text.trim(),
  })
  return response.data[0].embedding
}

/**
 * Cosine similarity between two embedding vectors. Returns 0-1.
 */
export function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0
  let dot = 0, magA = 0, magB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    magA += a[i] * a[i]
    magB += b[i] * b[i]
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB)
  if (denom === 0) return 0
  // Clamp to 0-1 (cosine similarity can be negative but our texts are always topically related)
  return Math.max(0, dot / denom)
}

/**
 * Build the text string to embed for a reel.
 * Uses the Notes field which contains "Inspo direction:\n...\n\nWhat matters most:\n..."
 */
export function buildReelEmbeddingText(reel) {
  const parts = []
  if (reel.notes) parts.push(reel.notes)
  if (reel.onScreenText) parts.push(`On-screen text: ${reel.onScreenText}`)
  if (reel.title) parts.push(`Title: ${reel.title}`)
  return parts.join('\n\n')
}

/**
 * Build the text string to embed for a creator profile.
 * Concatenates all profile text fields.
 */
export function buildCreatorEmbeddingText(creator) {
  const parts = []
  if (creator.profileSummary) parts.push(creator.profileSummary)
  if (creator.brandVoiceNotes) parts.push(creator.brandVoiceNotes)
  if (creator.contentDirectionNotes) parts.push(creator.contentDirectionNotes)
  if (creator.dosAndDonts) parts.push(creator.dosAndDonts)
  return parts.join('\n\n')
}
