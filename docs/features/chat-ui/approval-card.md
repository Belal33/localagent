# Approval Card

HITL UI card displaying flagged tool calls and allowing approve / reject-with-reason / edit-args decisions.
JSON-validated edit mode; sends back a `{action, reason?, newArgs?}` decision payload.

Implemented in `src/app/components/ApprovalCard.tsx`. Amber-themed card listing each
flagged call's tool name, reason for flagging, and args JSON. Edit mode presents an
editable JSON textarea that is validated before submit; reject mode shows an optional
reason input. The decision is sent to `/api/chat/resume`, which converts it into the
LangGraph `Command({ resume })` payload consumed by the human-review node.
Uses Lucide's `ShieldAlert` icon.
