---
name: Read-only mode awareness
description: Always handle both read-only and read/write states when adding UI features
type: feedback
originSessionId: 91a9c77c-af5d-4bcc-9d26-4d929000e1b4
---
When adding any UI feature that involves editing, adding, or deleting content, always consider both states:

- **Read-only**: `readOnly = !settings.githubToken` — no GitHub token configured
- **Read/write**: token present, full editing allowed

**Why:** The app has a read-only mode for users without a GitHub PAT. Forgetting this caused editable controls to remain visible/functional when they should be hidden, requiring a separate cleanup pass.

**How to apply:**
- Hide add/edit/delete buttons with `{!readOnly && <button ...>}`
- Guard editing forms: `{isEditing && !readOnly ? <form> : <display>}`
- Hide entire sections when empty in read-only: `if (readOnly && items.length === 0) return null`
- Note: "Subscribe URL" and other read-only actions (copy, export) should remain visible regardless of readOnly state
- Pass `readOnly={readOnly}` to any new child component that renders editable controls
