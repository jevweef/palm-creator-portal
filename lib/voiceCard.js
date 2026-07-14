/**
 * Creator Voice Card — the chatting brain's view of WHO the creator is and HOW
 * she talks, built straight from her onboarding survey answers.
 *
 * The survey (lib/onboarding/surveyQuestions.js) captures gold a chatter needs —
 * pet names, signature phrases, emoji palette, never-say words, sample replies —
 * but until now only a 1-3 sentence summary ("Brand Voice Notes") reached the
 * suggest feature; the specifics were boiled away. This assembles the raw
 * chatting-relevant answers, VERBATIM and grouped, for both the LLM prompt and
 * the human chatter's sidebar.
 *
 * Keyed by the creator (HQ Creators record id), NOT the OF account — so a
 * creator with a VIP + Free page (e.g. Tabby) shares ONE voice across both.
 */

import { SURVEY_QUESTIONS } from '@/lib/onboarding/surveyQuestions'

const OPS_BASE = 'applLIT2t83plMqNx'
const SURVEY_TABLE = 'Onboarding Survey Responses'
const AT = { Authorization: `Bearer ${process.env.AIRTABLE_PAT}` }

const Q_TEXT = Object.fromEntries(SURVEY_QUESTIONS.map((q) => [q.key, q.text]))

// Curated, ordered by what matters most to a chatter drafting a message. Pricing
// minutiae and pure-identity trivia are intentionally left out of the card — the
// dossier handles per-fan pricing; this is about voice + rules + real-life color.
const CARD_GROUPS = [
  {
    label: 'VOICE — how she talks',
    keys: ['subscriber_terms', 'signature_phrases', 'texting_style', 'common_emojis', 'text_abbreviations', 'chat_energy', 'personality_3_words', 'fan_perception', 'representation', 'morning_or_night'],
  },
  {
    label: 'NEVER — hard limits (obey these)',
    keys: ['prohibited_words', 'prohibited_terminology', 'topics_to_avoid', 'prohibited_topics', 'disliked_in_conversations', 'messages_to_redirect', 'content_restrictions'],
  },
  {
    label: 'PERSONA FACTS — keep consistent',
    keys: ['nicknames', 'perceived_age', 'perceived_birthday', 'perceived_origin', 'perceived_location', 'zodiac_sign', 'ethnicity', 'languages', 'fan_known_facts'],
  },
  {
    label: 'CHAT DYNAMIC',
    keys: ['traits_to_highlight', 'workflow_notes', 'conversation_preference', 'limitations_instructions', 'additional_personal_facts'],
  },
  {
    label: 'SMALL TALK — her real life',
    keys: ['pets', 'hobbies', 'favorite_food_drink_color', 'favorite_movies_shows', 'favorite_music', 'dream_travel', 'fun_fact'],
  },
  {
    label: 'SAMPLE REPLIES — her actual voice',
    keys: ['response_how_are_you', 'response_what_are_you_up_to', 'response_explicit'],
  },
  {
    label: 'CONTENT & SALES',
    keys: ['content_niche', 'content_abilities', 'pricing_general', 'sales_goals'],
  },
]

const isBlank = (v) => {
  const s = String(v ?? '').trim()
  return !s || s.toLowerCase() === 'n/a' || s.toLowerCase() === 'na' || s === '-'
}

// Pull this creator's survey answers → { questionKey: answer }. Keyed by the HQ
// Creators record id (the same value Palm Creators stores as `HQ Record ID`).
async function fetchSurveyAnswers(hqId) {
  const answers = {}
  const p = new URLSearchParams({ filterByFormula: `{HQ Creator ID}='${hqId}'`, pageSize: '100' })
  p.append('fields[]', 'Question Key')
  p.append('fields[]', 'Answer')
  let offset
  do {
    if (offset) p.set('offset', offset)
    const r = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent(SURVEY_TABLE)}?${p}`, { headers: AT, cache: 'no-store' })
    if (!r.ok) break
    const j = await r.json()
    for (const rec of j.records || []) {
      const k = rec.fields?.['Question Key']
      const a = rec.fields?.['Answer']
      if (k && !isBlank(a)) answers[k] = String(a).trim()
    }
    offset = j.offset
  } while (offset)
  return answers
}

/**
 * Build the Voice Card for a creator.
 * @param {string} hqId - HQ Creators record id (Palm Creators `HQ Record ID`).
 * @returns {Promise<null | { groups: Array<{label,items:[{key,label,value}]}>, text: string, answerCount: number }>}
 *   `text` is the verbatim block for an LLM prompt; `groups` drive the UI.
 *   Returns null when there are no usable answers (graceful — callers fall back).
 */
export async function buildVoiceCard(hqId) {
  if (!hqId) return null
  let answers = {}
  try { answers = await fetchSurveyAnswers(hqId) } catch { return null }
  const total = Object.keys(answers).length
  if (!total) return null

  const groups = []
  for (const g of CARD_GROUPS) {
    const items = []
    for (const k of g.keys) {
      if (!isBlank(answers[k])) items.push({ key: k, label: Q_TEXT[k] || k, value: answers[k] })
    }
    if (items.length) groups.push({ label: g.label, items })
  }
  if (!groups.length) return null

  const text = groups
    .map((g) => `[${g.label}]\n` + g.items.map((it) => `- ${it.label}: ${it.value}`).join('\n'))
    .join('\n\n')

  return { groups, text, answerCount: total }
}
