#!/bin/bash
cd /Users/jevanleith/palm-creator-portal
git add -A
# Only commit and push if there are changes
if ! git diff --cached --quiet; then
  git commit -m "Auto-save: $(date '+%Y-%m-%d %H:%M')"
  git push origin main
fi
