// Thin route wrapper. The actual content lives in ./AiEditorBody.js so it can
// also be rendered inside the admin shell at /admin/recreate-source?tab=workflow
// (see app/admin/recreate-source/WorkflowTab.js).

import AiEditorBody from './AiEditorBody'

export default function AiEditorPage() {
  return <AiEditorBody />
}
