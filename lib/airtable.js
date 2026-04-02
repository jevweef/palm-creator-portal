const Airtable = require('airtable')

const base = new Airtable({ apiKey: process.env.AIRTABLE_PAT }).base('applLIT2t83plMqNx')

const INSPIRATION_TABLE = 'tblnQhATaMtpoYErb'

export async function getInspirationRecords() {
  const records = []

  await base(INSPIRATION_TABLE)
    .select({
      filterByFormula: "AND({Status} = 'Complete', NOT({Hidden from Board}))",
      fields: [
        'Title',
        'Status',
        'Tags',
        'Film Format',
        'Notes',
        'On-Screen Text',
        'Views',
        'Likes',
        'Comments',
        'Shares',
        'Engagement Score',
        'Normalized Score',
        'Z Score',
        'Thumbnail',
        'DB Share Link',
        'DB Raw = 1',
        'DB Embed Code',
        'Username',
        'Content link',
        'Transcript',
        'Suggested Tags',
        'Saved By',
        'Creator Posted Date',
      ],
      sort: [{ field: 'Engagement Score', direction: 'desc' }],
    })
    .eachPage((pageRecords, fetchNextPage) => {
      pageRecords.forEach((record) => {
        const thumbnail = record.get('Thumbnail')
        const thumbUrl = thumbnail && thumbnail.length > 0 ? thumbnail[0].url : null

        records.push({
          id: record.id,
          title: record.get('Title') || 'Untitled',
          tags: record.get('Tags') || [],
          suggestedTags: record.get('Suggested Tags') || [],
          filmFormat: record.get('Film Format') || [],
          notes: record.get('Notes') || '',
          onScreenText: record.get('On-Screen Text') || '',
          views: record.get('Views') || 0,
          likes: record.get('Likes') || 0,
          comments: record.get('Comments') || 0,
          shares: record.get('Shares') || 0,
          engagementScore: record.get('Engagement Score') || 0,
          normalizedScore: record.get('Normalized Score') || 0,
          zScore: record.get('Z Score') || 0,
          thumbnail: thumbUrl,
          dbShareLink: record.get('DB Share Link') || '',
          dbRawLink: record.get('DB Raw = 1') || '',
          dbEmbedCode: record.get('DB Embed Code') || '',
          username: record.get('Username') || '',
          contentLink: record.get('Content link') || '',
          transcript: record.get('Transcript') || '',
          savedBy: (record.get('Saved By') || []).map((r) => r.id || r),
          creatorPostedDate: record.get('Creator Posted Date') || '',
        })
      })
      fetchNextPage()
    })

  return records
}

export async function getAllTags() {
  const records = await getInspirationRecords()
  const tagSet = new Set()
  records.forEach((r) => {
    r.tags.forEach((t) => tagSet.add(t))
  })
  return Array.from(tagSet).sort()
}

export async function getAllFilmFormats() {
  const records = await getInspirationRecords()
  const formatSet = new Set()
  records.forEach((r) => {
    r.filmFormat.forEach((f) => formatSet.add(f))
  })
  return Array.from(formatSet).sort()
}
