# Follow-up UI scoped review

Independent review identified cross-project carryover of unsent forms, restoration of already-submitted background forms, and returning A-B-A before a delayed response. Fixes: per-project form drafts/input tracking; background cache cleared only when equal to submitted snapshot; restored visible submission cleared only when content remains equal. Newer form edits remain intact. Focused native tests cover matching decision IDs across projects and each delayed response variant. Hidden-project drafts participate in the logout guard; session reset discards pending replies and clears caches.

Exporter inspection found no follow-up disclosure leakage or dangling generated links. Node421 and focused actual Main/UI tests pass with local fixture actors. This is not packaged/production/real company account evidence.
