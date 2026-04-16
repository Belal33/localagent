# Smoke Tests

Fast sanity tests (6 cases): page load, header/Phase 4 badge, thread ID pattern, input + button states, local inference badge.
No backend required.

Implemented in `tests/e2e/smoke.spec.ts`. Asserts the UI renders on first paint and
that the send button correctly toggles disabled/enabled based on input content.
Runnable with `npm run test:smoke`. These tests are the quickest signal that the
client-side app is healthy.
