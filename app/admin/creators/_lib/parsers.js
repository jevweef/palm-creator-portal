// A "real purchase" = tip, PPV, message unlock, post unlock, stream tip, etc.
// Explicitly excludes subscription renewals (auto-charges, not an active choice)
// and chargebacks. Used for fan-level spending math (lifetime, gaps, rolling30,
// heat status) so recurring $X subscription charges don't make a dead fan look alive.
export function isRealPurchase(t) {
  if (!t || !t.type) return true // unknown type — treat as real to be safe
  const type = String(t.type)
  return type !== 'Chargeback'
    && type !== 'Subscription'
    && type !== 'Recurring subscription'
}

// Parse OF chat HTML in the browser — mirrors parseChatHtml() in the server route.
// Running this client-side keeps large HTML (often 20-100MB of SVG/media bloat)
// off the wire; only the compact transcript (~2-5% of size) is uploaded.
export function parseChatHtmlClient(html) {
  const messages = []
  const datePositions = []
  const dateRe = /b-chat__messages__time.*?title="([^"]+)"/g
  let dm
  while ((dm = dateRe.exec(html))) {
    const rawDate = dm[1].replace(/,?\s*12:00\s*am$/i, '').trim()
    datePositions.push({ pos: dm.index, date: rawDate })
  }
  const msgRe = /class="b-chat__message\s([^"]*?)"/g
  let mm
  while ((mm = msgRe.exec(html))) {
    const pos = mm.index
    const classes = mm[1]
    const block = html.slice(pos, pos + 5000)
    const isFromMe = classes.includes('m-from-me')
    const hasMedia = classes.includes('m-has-media')
    const isTip = classes.includes('m-tip')
    const isPrice = classes.includes('m-price')
    let text = ''
    const textMatch = block.match(/class="b-chat__message__text[^"]*"[^>]*>([\s\S]*?)<\/div>/)
    if (textMatch) {
      text = textMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      text = text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&nbsp;/g, ' ')
    }
    const mediaMatch = block.match(/switcher-media-content__val-total">(\d+)/)
    const mediaCount = mediaMatch ? mediaMatch[1] : ''
    let price = ''
    if (isPrice) {
      const priceMatch = block.match(/\$\s*([\d,.]+)/)
      if (priceMatch) price = priceMatch[1]
    }
    let msgDate = ''
    for (let i = datePositions.length - 1; i >= 0; i--) {
      if (datePositions[i].pos < pos) { msgDate = datePositions[i].date; break }
    }
    let msgTime = ''
    const timeMatch = block.match(/b-chat__message__time[^>]*>[\s\S]*?<span[^>]*>\s*([\d]{1,2}:[\d]{2}\s*[ap]m)\s*<\/span/i)
    if (timeMatch) msgTime = timeMatch[1].trim()
    const sender = isFromMe ? 'CREATOR' : 'FAN'
    let line = `[${sender}]`
    if (text) line += ` ${text}`
    if (hasMedia) line += mediaCount ? ` [media x${mediaCount}]` : ' [media]'
    if (isPrice && price) line += ` [PPV $${price}]`
    if (isTip) line += ' [TIP]'
    if (text || hasMedia || isTip) {
      messages.push({ date: msgDate, time: msgTime, sender, line })
    }
  }
  let currentDate = ''
  const lines = []
  for (const msg of messages) {
    if (msg.date && msg.date !== currentDate) {
      currentDate = msg.date
      lines.push(`\n--- ${msg.date} ---`)
    }
    lines.push(msg.line)
  }
  const firstMsg = messages[0]
  const lastMsg = messages[messages.length - 1]
  const firstDate = firstMsg ? (firstMsg.time ? `${firstMsg.date}, ${firstMsg.time}` : firstMsg.date) : ''
  const lastDate = lastMsg ? (lastMsg.time ? `${lastMsg.date}, ${lastMsg.time}` : lastMsg.date) : ''
  return {
    conversation: lines.join('\n'),
    messages,
    messageCount: messages.length,
    fanMessages: messages.filter(m => m.sender === 'FAN').length,
    creatorMessages: messages.filter(m => m.sender === 'CREATOR').length,
    firstMessageDate: firstDate,
    lastMessageDate: lastDate,
  }
}
