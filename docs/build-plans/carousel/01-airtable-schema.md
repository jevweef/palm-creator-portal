# Step 1 — Airtable schema changes

## Goal
Make the data model carousel-aware. Three small Airtable changes.

## Prereq reads
- `gotchas.md`

## What to do

### A. Add `Creator Upload` to Photos.Source Type
- Base: `applLIT2t83plMqNx` (Content Operations Hub)
- Table: Photos (`tblUXDbaZGYGf2E5O`)
- Field: Source Type (`fldglWtwIr8pAikWL`), singleSelect
- Current options (verified): Instagram, Pinterest, AI Generated
- **Add**: `Creator Upload`

Use the Airtable MCP `update_field` tool. Color suggestion: greenLight2 (visually distinct from the existing three).

### B. Add `Type` field to Posts table
- Find Posts table in base `applLIT2t83plMqNx` via `list_tables_for_base`
- Create new singleSelect field named `Type` with options:
  - `Reel`
  - `Carousel`

### C. Ensure Posts.Status has `Ready to Go`
- Fetch the Posts table schema and inspect the Status field options
- If `Ready to Go` is already a choice, do nothing
- If not, add it

## How to verify
After each change, fetch the table schema again and confirm the new option/field exists. Don't trust the MCP response alone — `list_tables_for_base` should now reflect the change.

## Gotcha
Don't rename existing options. Don't remove existing options. Pure additions only — there's live data on every status that downstream code keys on.

## Verify before next step
- Print the final Source Type options (4 total) and Status options to the user before moving on. They'll catch a typo faster than the build will.
