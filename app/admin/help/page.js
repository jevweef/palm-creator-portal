'use client'

import { useState, useMemo } from 'react'

// ─── Help content data ───────────────────────────────────────────────

const HELP_SECTIONS = [
  {
    id: 'onboarding',
    title: 'Onboarding a New Creator',
    icon: '📋',
    tags: ['onboarding', 'new creator', 'invite', 'link', 'commission', 'setup'],
    scenario: 'You just signed a new creator and need to get them into the system.',
    steps: [
      {
        heading: 'Go to the Onboarding page',
        detail: 'Click "Onboarding" in the left sidebar. You\'ll see a table of all creators and their onboarding status.',
      },
      {
        heading: 'Click "+ Start Onboarding"',
        detail: 'Purple button, top-right corner. A form pops up.',
      },
      {
        heading: 'Fill in the creator\'s info',
        detail: 'Name (required), email (required), commission % (optional — you can set this later), and their state if you have it.',
      },
      {
        heading: 'Click "Create & Copy Link"',
        detail: 'This does two things: creates their record in the system and copies their personal onboarding link to your clipboard.',
      },
      {
        heading: 'Send them the link',
        detail: 'Paste the link into a DM, email, or text. When they open it, they\'ll land on a branded onboarding page where they fill out their survey, upload voice memos, and sign their contract.',
      },
      {
        heading: 'Track their progress',
        detail: 'Back on the Onboarding page, you\'ll see their status update as they complete steps: Link Sent → In Progress → Completed. You don\'t need to do anything in between — the system tracks it automatically.',
      },
    ],
    tips: [
      'If a creator says they lost the link, click "Copy Link" next to their name in the table — it generates a fresh one.',
      'If they already exist as a Lead in the system, you\'ll see a "Start Onboarding" button right on their row instead of using the top button.',
      'Commission % can be changed later on the Creators page — don\'t stress about getting it exact at this step.',
    ],
  },
  {
    id: 'creator-profile',
    title: 'Setting Up a Creator\'s Profile',
    icon: '🎭',
    tags: ['creator', 'profile', 'documents', 'voice memo', 'analysis', 'tags', 'AI'],
    scenario: 'A creator just finished onboarding and you need to build out their profile so the system knows what content to recommend them.',
    steps: [
      {
        heading: 'Go to Creators',
        detail: 'Click "Creators" in the sidebar. You\'ll see a list of all creators on the left.',
      },
      {
        heading: 'Click on the creator\'s name',
        detail: 'Their profile panel opens on the right. If they completed onboarding, their documents (voice memos, survey answers) should already be there.',
      },
      {
        heading: 'Check the Documents tab',
        detail: 'Click "Documents" to see what\'s been uploaded. Voice memos from onboarding, transcripts, and any PDFs will show here. If something\'s missing, you can upload it manually with the "+ Upload" button.',
      },
      {
        heading: 'Run Analysis',
        detail: 'Click "Run Analysis." The AI reads all their documents — voice memos carry the most weight — and generates their profile: a summary, brand voice notes, content direction, do\'s & don\'ts, and tag weights across categories like Persona, Tone, Setting, etc.',
      },
      {
        heading: 'Review the results',
        detail: 'Flip through the Profile tab and Tags tab. The profile text tells you who this creator is and what kind of content fits them. The tag weights show percentages — higher weight means the system will prioritize that style of content when recommending inspo.',
      },
      {
        heading: 'Refine if needed',
        detail: 'If something\'s off — like it over-indexed on "Girl Next Door" when she\'s more of a "Bratty" vibe — type feedback in the text box above the tabs and click "Refine." You\'ll see a side-by-side diff of proposed changes. Accept or discard.',
      },
    ],
    tips: [
      'Voice memos are the most valuable input. If a creator only filled out the survey, the profile will be decent but less nuanced. Getting a 2-3 minute voice memo from them about their content style makes a big difference.',
      'You can refine as many times as you want. Each refinement builds on the last.',
      'The "Reset" button wipes the entire profile and starts fresh — use it if the profile is way off and refinement isn\'t cutting it.',
    ],
  },
  {
    id: 'uploading-docs',
    title: 'Uploading Documents for a Creator',
    icon: '📎',
    tags: ['upload', 'documents', 'voice memo', 'audio', 'transcript', 'PDF', 'meeting notes'],
    scenario: 'You have a voice memo, call recording, or document about a creator that should factor into their profile.',
    steps: [
      {
        heading: 'Go to Creators → click the creator',
        detail: 'Open their profile panel.',
      },
      {
        heading: 'Click "+ Upload"',
        detail: 'A modal pops up asking for file type and the file itself.',
      },
      {
        heading: 'Select the file type',
        detail: 'Options: Audio (voice memos, call recordings), Transcript (text files), PDF, Meeting Notes, or Other. Pick the one that matches — this affects how the AI weighs the input.',
      },
      {
        heading: 'Choose the file and add notes',
        detail: 'Click to browse or drag the file in. The notes field is optional but helpful — something like "Onboarding call Jan 2026" so you remember what it is later.',
      },
      {
        heading: 'Click "Upload"',
        detail: 'File goes to Dropbox storage and registers in the system. If it\'s an audio file, it gets transcribed automatically.',
      },
      {
        heading: 'Re-run analysis',
        detail: 'After uploading new docs, click "Reanalyze" to regenerate the profile with the new info included.',
      },
    ],
    tips: [
      'Audio files get auto-transcribed. You don\'t need to transcribe them yourself.',
      'You can upload multiple files — click "Upload Another" after each one.',
      'Document weight order: voice memos (strongest), Instagram visual content (medium), meeting notes and text docs (lighter). This means a 2-minute voice memo shapes the profile more than a 5-page PDF.',
    ],
  },
  {
    id: 'invoicing',
    title: 'Invoicing a Creator',
    icon: '💸',
    tags: ['invoice', 'invoicing', 'payment', 'earnings', 'commission', 'send', 'PDF', 'paid'],
    scenario: 'It\'s the end of the billing period and you need to invoice creators for their earnings.',
    steps: [
      {
        heading: 'Go to Invoicing',
        detail: 'Click "Invoicing" in the sidebar. You\'ll see period tabs at the top — pick the billing period you\'re invoicing for.',
      },
      {
        heading: 'Check earnings',
        detail: 'Each creator has a card showing their accounts, earnings, and commission breakdown. If an earnings number is wrong, click on it to edit it inline — just type the new number and hit Enter.',
      },
      {
        heading: 'Generate the PDF',
        detail: 'Click "Manage →" on a creator\'s card. In the modal, click "Generate PDF." The system creates a formatted invoice PDF and stores it in Dropbox.',
      },
      {
        heading: 'Send the invoice',
        detail: 'Click "Send Invoice" in the same modal. You\'ll see a confirmation showing the recipient email, amount, and a link to the PDF. Confirm to send.',
      },
      {
        heading: 'Track payment',
        detail: 'Click the status pill on any invoice to cycle it: Draft → Sent → Paid. The summary bar at the top updates in real-time to show totals across all creators.',
      },
    ],
    tips: [
      'The summary bar shows Total Revenue, Total Commission, Chat Team Cost, and Net Profit for the selected period — useful for a quick financial snapshot.',
      'You can bulk-update a creator\'s invoices using "Mark All Sent" or "Mark All Paid" in their card header.',
      'Invoices are currently emailed to the address on file. If a creator doesn\'t have an email, you\'ll see a warning banner before sending.',
    ],
  },
  {
    id: 'inspo-pipeline',
    title: 'How the Inspo Pipeline Works',
    icon: '⚡',
    tags: ['pipeline', 'scrape', 'promote', 'analysis', 'inspo', 'source reels', 'inspiration'],
    scenario: 'Understanding the flow from Instagram scraping to content appearing on the creator portal.',
    steps: [
      {
        heading: 'Sources get scraped',
        detail: 'Instagram accounts are added to the Sources tab. When scraped, their recent reels get pulled into the system as "Source Reels."',
      },
      {
        heading: 'Reels get promoted',
        detail: 'The Promote step scores source reels by engagement (views, likes, comments) and promotes the best ones to the Inspiration table with status "Ready for Review."',
      },
      {
        heading: 'You review them',
        detail: 'On the Review tab, you go through promoted reels one by one — watch the reel, record voice notes about what makes it good, assign it to specific creators, and rate it 1-10.',
      },
      {
        heading: 'AI analyzes them',
        detail: 'Reviewed reels get analyzed by AI — it watches the video, reads any on-screen text, listens to audio, and writes inspo directions, tags, and "what matters most" notes.',
      },
      {
        heading: 'Creators see them',
        detail: 'Analyzed reels show up on the creator portal (app.palm-mgmt.com/inspo) where creators browse, filter by tags, and save the ones they want to recreate.',
      },
    ],
    tips: [
      'You don\'t need to manually run every step. The Pipeline page (first page you see in Inspo Board) has Scrape, Promote, and Analysis buttons that run each step in bulk.',
      'The pipeline runs continuously — new reels flow in as sources get scraped on schedule.',
    ],
  },
  {
    id: 'add-sources',
    title: 'Adding Inspo Sources',
    icon: '📡',
    tags: ['sources', 'instagram', 'scrape', 'add', 'accounts', 'handles'],
    scenario: 'You found some Instagram accounts that post great content and want to add them as inspiration sources.',
    steps: [
      {
        heading: 'Go to Inspo Board → Sources tab',
        detail: 'Click "Inspo Board" in the sidebar, then the "Sources" tab along the top.',
      },
      {
        heading: 'Click "+ Add Sources"',
        detail: 'Pink button, top area. A modal opens.',
      },
      {
        heading: 'Paste Instagram handles',
        detail: 'One per line, with or without the @. Example:\n@somegirl\ncreator_name\n@another_one',
      },
      {
        heading: 'Assign to creators (optional)',
        detail: 'Check the boxes for which creators these sources are relevant to. This helps the system know who should see reels from these accounts.',
      },
      {
        heading: 'Click "Add Sources"',
        detail: 'They get created and show up in the table. Duplicates are automatically skipped.',
      },
      {
        heading: 'Scrape them',
        detail: 'You can scrape immediately by clicking "Scrape All Visible" at the top, or wait for the next scheduled scrape.',
      },
    ],
    tips: [
      'Filter by "Unscraped" to see which sources haven\'t been pulled yet.',
      'If an account is age-restricted (18+), it\'ll be flagged — these can\'t be scraped by the automated system.',
      'Toggle a source off to stop scraping it without deleting it. Toggle it back on anytime.',
    ],
  },
  {
    id: 'review-reels',
    title: 'Reviewing Reels',
    icon: '✅',
    tags: ['review', 'rate', 'approve', 'reels', 'voice note', 'assign', 'creators'],
    scenario: 'There are reels in the review queue waiting to be approved or rejected.',
    steps: [
      {
        heading: 'Go to Inspo Board → Review tab',
        detail: 'You\'ll see a single reel card with a progress counter like "1 of 10 remaining."',
      },
      {
        heading: 'Watch the reel',
        detail: 'Click "Open Reel" to see it on Instagram, or view the thumbnail/preview on the card.',
      },
      {
        heading: 'Record a voice note (optional)',
        detail: 'Click the microphone button, speak your thoughts, stop recording. Your words get transcribed into the notes field automatically. You can also just type notes directly.',
      },
      {
        heading: 'Assign to creators',
        detail: 'Check the boxes for which creators this reel is good for. You can select multiple.',
      },
      {
        heading: 'Rate it',
        detail: 'Click a number 1-10 to approve, or click the trash icon to reject and remove it. Rating saves everything and advances to the next reel.',
      },
    ],
    tips: [
      'Skipping a reel keeps it in the queue — you\'ll see it again later.',
      'If the reel comes from an account that\'s not in your Sources yet, you\'ll see an "Add to Sources" button — click it to start tracking that account.',
      'Voice notes are the fastest way to capture your thoughts. The transcription isn\'t perfect but it\'s close enough.',
    ],
  },
  {
    id: 'import-reels',
    title: 'Importing Reels from Instagram Export',
    icon: '📥',
    tags: ['import', 'instagram', 'export', 'JSON', 'bulk', 'saved'],
    scenario: 'You saved a bunch of reels on Instagram and want to import them into the system all at once.',
    steps: [
      {
        heading: 'Export from Instagram',
        detail: 'Go to Instagram → Settings → Your Activity → Download Your Information. Request your "Saved" data as JSON. Instagram emails you a download link.',
      },
      {
        heading: 'Go to Inspo Board → Import tab',
        detail: 'You\'ll see a drag-and-drop zone.',
      },
      {
        heading: 'Drop the JSON file',
        detail: 'Drag your downloaded JSON file onto the drop zone, or click to browse and select it.',
      },
      {
        heading: 'Review the preview',
        detail: 'The system parses the file and shows you how many unique reels it found. Duplicates (already in the system) are automatically excluded.',
      },
      {
        heading: 'Click "Import"',
        detail: 'Reels get added to the review queue. You\'ll see a summary of how many were added vs. skipped.',
      },
    ],
    tips: [
      'This is great for bulk-adding inspo you\'ve been saving manually on Instagram.',
      'The system handles deduplication — don\'t worry about importing the same file twice.',
    ],
  },
  {
    id: 'editor-workflow',
    title: 'Managing the Editor Workflow',
    icon: '✂️',
    tags: ['editor', 'editing', 'tasks', 'approve', 'revisions', 'telegram', 'post'],
    scenario: 'Content has been filmed and needs to be edited, reviewed, and posted.',
    steps: [
      {
        heading: 'Go to Editor',
        detail: 'Click "Editor" in the sidebar. You\'ll see 4 tabs: Dashboard, For Review, Post Prep, and Creator Library.',
      },
      {
        heading: 'Dashboard — editing tasks',
        detail: 'Shows all editing tasks as cards. Each has a status (To Do, In Progress, Ready for Review, Approved) and is tied to a creator.',
      },
      {
        heading: 'For Review — approve or request changes',
        detail: 'When an editor submits their work, it shows up here. Watch the edit, then approve it or send revision notes. Revision feedback gets sent to the editor via Telegram automatically.',
      },
      {
        heading: 'Post Prep — schedule and send',
        detail: 'Approved edits move here. Each post card shows the creator, video preview, and caption. You can edit the caption, pick a thumbnail, then send to Telegram for posting.',
      },
      {
        heading: 'Creator Library — uploaded clips',
        detail: 'Raw clips uploaded by creators show up here. Browse and approve them to feed into the editing pipeline.',
      },
    ],
    tips: [
      'Posts have two time slots by default: Morning (~10am ET) and Evening (~7pm ET).',
      'You can log historical posts that were already made before the system was in place — use "+ Log Historical Post."',
      'Revision notes sent through the system go directly to the editor\'s Telegram. No need to message them separately.',
    ],
  },
  {
    id: 'navigation',
    title: 'Finding Your Way Around',
    icon: '🧭',
    tags: ['navigation', 'sidebar', 'tabs', 'pages', 'where', 'find'],
    scenario: 'Quick reference for what lives where.',
    steps: [
      {
        heading: 'Sidebar items',
        detail: 'The left sidebar has 5 sections: Inspo Board, Editor, Creators, Onboarding, and Invoicing. Each one opens a different page.',
      },
      {
        heading: 'Inspo Board tabs',
        detail: 'Inspo Board has 4 tabs along the top: Pipeline (run scrapes/analysis), Sources (manage Instagram accounts), Review (rate reels), Import (bulk upload JSON).',
      },
      {
        heading: 'Editor tabs',
        detail: 'Editor has 4 tabs: Dashboard (task list), For Review (approve edits), Post Prep (schedule posts), Creator Library (raw clips).',
      },
      {
        heading: 'Creators',
        detail: 'Creator list on the left, detail panel on the right. Three tabs in the detail panel: Profile, Documents, Tags.',
      },
      {
        heading: 'Onboarding',
        detail: 'Table view with status filters. Main action is starting onboarding and tracking progress.',
      },
      {
        heading: 'Invoicing',
        detail: 'Period selector at top, creator invoice cards below, summary bar with totals.',
      },
    ],
    tips: [],
  },
  {
    id: 'refine-profile',
    title: 'Refining a Creator\'s Profile',
    icon: '🎯',
    tags: ['refine', 'feedback', 'tags', 'weights', 'adjust', 'profile', 'AI'],
    scenario: 'The AI-generated profile isn\'t quite right and you want to adjust it without starting over.',
    steps: [
      {
        heading: 'Go to Creators → select the creator',
        detail: 'Open their profile panel.',
      },
      {
        heading: 'Type your feedback',
        detail: 'There\'s a text box above the tabs. Write what needs to change in plain language. Example: "She\'s more bratty than sweet — tone down Girl Next Door, bump up Soft Tease. She doesn\'t do fitness content."',
      },
      {
        heading: 'Click "Refine"',
        detail: 'The AI generates proposed changes based on your feedback.',
      },
      {
        heading: 'Review the diff',
        detail: 'You\'ll see a side-by-side comparison: current values on the left (red), proposed values on the right (green). Tag weights show a visual bar chart of changes.',
      },
      {
        heading: 'Accept or Discard',
        detail: '"Accept & Save" commits the changes. "Discard" throws away the proposal and keeps everything as-is. You can refine again as many times as needed.',
      },
    ],
    tips: [
      'Be specific in your feedback. "Make it better" won\'t help. "She never does outdoor content, remove any outdoor-related tags" will.',
      'Each refinement is logged in the Refinement History — you can see what was changed and when in the Adjustments tab.',
    ],
  },
  {
    id: 'resend-link',
    title: 'Resending an Onboarding Link',
    icon: '🔗',
    tags: ['resend', 'link', 'onboarding', 'lost', 'new link', 'token'],
    scenario: 'A creator says they can\'t find or lost their onboarding link.',
    steps: [
      {
        heading: 'Go to Onboarding',
        detail: 'Find the creator in the table.',
      },
      {
        heading: 'Click "Copy Link"',
        detail: 'Right there in their row under Actions. It generates a fresh link and copies it to your clipboard.',
      },
      {
        heading: 'Send it to them',
        detail: 'Paste wherever — DM, text, email. The old link stops working and this new one takes over.',
      },
    ],
    tips: [
      'Every time you copy a link, it generates a new token. The old link expires automatically.',
    ],
  },
  {
    id: 'check-status',
    title: 'Checking Onboarding Progress',
    icon: '📊',
    tags: ['status', 'progress', 'onboarding', 'check', 'where', 'stuck'],
    scenario: 'You want to see where a creator is in the onboarding process.',
    steps: [
      {
        heading: 'Go to Onboarding',
        detail: 'The table shows every creator with two status columns: their overall Status and their Onboarding progress.',
      },
      {
        heading: 'Check the Onboarding column',
        detail: 'Not Started = link hasn\'t been sent yet. Link Sent = they have the link but haven\'t started. In Progress = they\'ve started filling things out. Completed = they\'re done.',
      },
      {
        heading: 'Use the filter pills',
        detail: 'Click "In Progress" to see only creators who started but haven\'t finished. Click "Link Sent" to see who might need a reminder.',
      },
    ],
    tips: [
      'If someone\'s been on "Link Sent" for more than a day or two, consider resending the link or following up.',
      'The "Date Sent" column shows when the link was last sent — useful for knowing when to follow up.',
    ],
  },
  {
    id: 'run-pipeline',
    title: 'Running the Inspo Pipeline',
    icon: '🚀',
    tags: ['pipeline', 'run', 'scrape', 'promote', 'analysis', 'bulk'],
    scenario: 'You want to manually kick off a pipeline run to get fresh content processed.',
    steps: [
      {
        heading: 'Go to Inspo Board → Pipeline tab',
        detail: 'This is the first page you see when clicking "Inspo Board." It shows stats cards and action buttons.',
      },
      {
        heading: 'Run Scrape',
        detail: 'Click "Run Scrape" to pull new reels from all enabled Instagram sources. You\'ll see a progress indicator while it runs.',
      },
      {
        heading: 'Run Promote',
        detail: 'Click "Run Promote" to score and filter the scraped reels. The best ones get promoted to the review queue.',
      },
      {
        heading: 'Run Analysis',
        detail: 'Click "Run Analysis" to have AI analyze all reviewed reels that haven\'t been analyzed yet. This writes the inspo directions, tags, and notes.',
      },
    ],
    tips: [
      'Each step is independent — you can run just Scrape without running Promote, or just Analysis if you\'ve already reviewed reels.',
      'The stats cards at the top give you a snapshot: how many sources, source reels, and inspo board items exist, and their status breakdown.',
    ],
  },
]

// ─── Component ───────────────────────────────────────────────────────

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}

function SectionCard({ section, isOpen, onToggle }) {
  return (
    <div style={{
      background: '#ffffff',
      borderRadius: '16px',
      boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
      overflow: 'hidden',
      transition: 'box-shadow 0.2s',
    }}>
      {/* Header — always visible */}
      <button
        onClick={onToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '14px',
          width: '100%',
          padding: '18px 22px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span style={{ fontSize: '22px', lineHeight: 1 }}>{section.icon}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '15px', fontWeight: 600, color: '#1a1a1a' }}>
            {section.title}
          </div>
          <div style={{ fontSize: '12px', color: '#999', marginTop: '2px' }}>
            {section.scenario}
          </div>
        </div>
        <span style={{
          fontSize: '18px',
          color: '#ccc',
          transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
          transition: 'transform 0.2s',
        }}>
          ▾
        </span>
      </button>

      {/* Body — collapsible */}
      {isOpen && (
        <div style={{ padding: '0 22px 22px' }}>
          {/* Steps */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {section.steps.map((step, i) => (
              <div key={i} style={{ display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
                <div style={{
                  width: '26px',
                  height: '26px',
                  borderRadius: '50%',
                  background: '#FFF0F3',
                  color: '#E88FAC',
                  fontSize: '13px',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  marginTop: '1px',
                }}>
                  {i + 1}
                </div>
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: '#1a1a1a' }}>
                    {step.heading}
                  </div>
                  <div style={{ fontSize: '13px', color: '#666', marginTop: '3px', lineHeight: 1.55, whiteSpace: 'pre-line' }}>
                    {step.detail}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Tips */}
          {section.tips.length > 0 && (
            <div style={{
              marginTop: '18px',
              padding: '14px 16px',
              background: '#FEFCE8',
              borderRadius: '10px',
              border: '1px solid #FDE68A',
            }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#92400E', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                Tips
              </div>
              <ul style={{ margin: 0, paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {section.tips.map((tip, i) => (
                  <li key={i} style={{ fontSize: '13px', color: '#78350F', lineHeight: 1.5 }}>
                    {tip}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function HelpPage() {
  const [search, setSearch] = useState('')
  const [openIds, setOpenIds] = useState(new Set())

  const filteredSections = useMemo(() => {
    if (!search.trim()) return HELP_SECTIONS
    const q = search.toLowerCase()
    return HELP_SECTIONS.filter(s =>
      s.title.toLowerCase().includes(q) ||
      s.scenario.toLowerCase().includes(q) ||
      s.tags.some(t => t.includes(q)) ||
      s.steps.some(st => st.heading.toLowerCase().includes(q) || st.detail.toLowerCase().includes(q))
    )
  }, [search])

  function toggleSection(id) {
    setOpenIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function expandAll() {
    setOpenIds(new Set(filteredSections.map(s => s.id)))
  }

  function collapseAll() {
    setOpenIds(new Set())
  }

  // Group sections by category
  const categories = [
    {
      label: 'Getting Started',
      ids: ['navigation', 'onboarding', 'resend-link', 'check-status'],
    },
    {
      label: 'Creators',
      ids: ['creator-profile', 'uploading-docs', 'refine-profile'],
    },
    {
      label: 'Inspo Pipeline',
      ids: ['inspo-pipeline', 'add-sources', 'review-reels', 'import-reels', 'run-pipeline'],
    },
    {
      label: 'Editing & Posting',
      ids: ['editor-workflow'],
    },
    {
      label: 'Invoicing',
      ids: ['invoicing'],
    },
  ]

  // When searching, show flat list; when browsing, show categories
  const isSearching = search.trim().length > 0

  return (
    <div style={{ maxWidth: '720px' }}>
      {/* Header */}
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: 700, color: '#1a1a1a', margin: 0 }}>
          Help
        </h1>
        <p style={{ fontSize: '13px', color: '#999', margin: '4px 0 0' }}>
          How to do things in the admin portal. Search or browse by scenario.
        </p>
      </div>

      {/* Search */}
      <div style={{
        position: 'relative',
        marginBottom: '20px',
      }}>
        <div style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)' }}>
          <SearchIcon />
        </div>
        <input
          type="text"
          placeholder="Search — try &quot;onboarding&quot;, &quot;invoice&quot;, &quot;scrape&quot;, &quot;voice memo&quot;..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            width: '100%',
            padding: '12px 14px 12px 40px',
            fontSize: '14px',
            border: '1px solid #E8C4CC',
            borderRadius: '12px',
            background: '#FFF5F7',
            outline: 'none',
            color: '#1a1a1a',
            boxSizing: 'border-box',
          }}
        />
      </div>

      {/* Expand/Collapse controls */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        <button
          onClick={expandAll}
          style={{
            padding: '6px 12px',
            fontSize: '12px',
            fontWeight: 500,
            color: '#999',
            background: 'none',
            border: '1px solid #eee',
            borderRadius: '6px',
            cursor: 'pointer',
          }}
        >
          Expand all
        </button>
        <button
          onClick={collapseAll}
          style={{
            padding: '6px 12px',
            fontSize: '12px',
            fontWeight: 500,
            color: '#999',
            background: 'none',
            border: '1px solid #eee',
            borderRadius: '6px',
            cursor: 'pointer',
          }}
        >
          Collapse all
        </button>
        {isSearching && (
          <span style={{ fontSize: '12px', color: '#999', alignSelf: 'center', marginLeft: '8px' }}>
            {filteredSections.length} result{filteredSections.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Content */}
      {isSearching ? (
        // Flat search results
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {filteredSections.length === 0 ? (
            <div style={{
              padding: '40px 20px',
              textAlign: 'center',
              color: '#999',
              fontSize: '14px',
            }}>
              No results for &ldquo;{search}&rdquo;. Try different keywords.
            </div>
          ) : (
            filteredSections.map(section => (
              <SectionCard
                key={section.id}
                section={section}
                isOpen={openIds.has(section.id)}
                onToggle={() => toggleSection(section.id)}
              />
            ))
          )}
        </div>
      ) : (
        // Categorized browsing
        <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
          {categories.map(cat => {
            const catSections = cat.ids
              .map(id => HELP_SECTIONS.find(s => s.id === id))
              .filter(Boolean)
            if (catSections.length === 0) return null
            return (
              <div key={cat.label}>
                <div style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  color: '#999',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  marginBottom: '10px',
                  paddingLeft: '4px',
                }}>
                  {cat.label}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {catSections.map(section => (
                    <SectionCard
                      key={section.id}
                      section={section}
                      isOpen={openIds.has(section.id)}
                      onToggle={() => toggleSection(section.id)}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
