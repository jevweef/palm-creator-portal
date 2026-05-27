'use client'

import AiEditorBody from '@/app/ai-editor/AiEditorBody'

// Workflow tab inside AI Content — renders the same body the ai_editor user
// role sees at /ai-editor. Same shared-component pattern as admin's Editor
// tab vs editor user-role dashboard.
//
// Passed `embedded` so AiEditorBody knows to hold its inner tab state in
// React (workspace / create / carousel) instead of the URL — the outer admin
// page already owns `?tab=` for its own setup/workflow/strategy selector.
export default function WorkflowTab() {
  return <AiEditorBody embedded />
}
