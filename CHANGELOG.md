# Changelog

## 1.4.1

- Remove the duplicate next-step task grid above the board. Keep recovery reasons, completion gates and actions in task details; task cards retain their compact status.

## 1.4.0

- Recover reasoning-only and missing-report stops with one bounded same-Session reminder; isolate task-local failures while infrastructure errors still pause dispatch.
- Add next-step guidance, explicit versioned owner recovery and visible completion gates; review staged work without automatically accepting it.
- Show readable execution sections, per-criterion review results and bounded workspace image evidence with preview.
- Generate criteria from optional owner expectations and allow criterion editing before execution; invalidate stale analysis/review and preserve accepted evidence.
- Reuse a fully passed independent review while waiting for human acceptance; keep failed or partial reviews fresh.
- Add workflow recovery browser/native journeys and contract coverage.

## 1.3.0

- Show native DSH approval, question and plan-review waits across workspace attention counts, Session badges and task phases without changing task lifecycle or running semantics.
- Display the official default permission preset and update only `permission.defaultPreset` through the owner Settings Remote with revision checks and explicit confirmation; fail closed when settings are read-only or unavailable.
- Include dashboard analysis, execution and review Sessions in workspace-scoped attention; navigate to the native Session for the decision and never approve automatically.
- Add attention and permission-settings Lab scenarios plus native approval hold/reject coverage; correct the fixture's pending-interaction kind.

## 1.2.1

- Replace every dropdown inside the new task panel with accessible chip radio groups: workspace, priority, assigned session, completion policy and machine-check kind. Hidden native radios keep arrow-key navigation and the group caption keeps its accessible name; long dynamic session lists wrap inside a bounded scrollable surface with no text truncation.
- Restore the invoking focus after nested dialogs close together.
- Add create-panel screenshots and browser assertions that each chip selection reaches the durable task through both the Lab fixture and the packed native lane.

## 1.2.0

- Redesign the dashboard around a bounded canvas, metric cards, one workspace/filter toolbar, task board/list and Session table.
- Replace inline forms and the 340px detail column with plugin-owned native HTML dialogs for create and detail, with top-layer modality, focus containment, unsaved-draft confirmation, and a shared Escape/backdrop/close dismissal path.
- Split task detail into overview/criteria/evidence, analysis/review, completion rules/properties and activity; keep header and footer reachable while only the body scrolls.
- Show the actual claimed execution Session before assignment fallback, execution phase and criterion progress; keep the automation budget attached to the real activation.
- Add responsive dialog geometry, keyboard access, reduced-motion support and shared light/dark theme tokens.

## 1.1.0

- Add dashboard issue triage, frozen criteria and express/staged/needs-info/human routes using dedicated native analysis Sessions.
- Add event-driven opt-in watching, bounded activation budgets and automatic execution through official DSH Session APIs.
- Add manual, verified and reviewed completion policies, configurable instructions and per-criterion exact-text/SHA256 file checks.
- Require independent native review identity, complete criterion evidence, low risk and no remaining risks before automatic completion. Persist rule/prompt/evidence hashes, review and machine-check receipts.
- Add stateful development Lab with complete task/session/workspace fixtures and 19 selectable scenarios, stepped execution gates, disconnect/reconnect/replay, restart persistence and focused/repeated browser runs.
- Add version-pinned real Gateway fixture, policy and process ownership tests, CI browser Lab, and packed native/live journeys covering automatic completion.
- Retain legacy tasks under manual policy. Restart disarms watching and preserves old claims. Freeze accepted evidence until explicit reopen.
- Fix duplicate React component keys exposed by stepped execution; disable modifications while any linked phase Agent is running.

Scope: dashboard issues only. DSH remains the runtime, access and approval authority. No automatic Git merge, release or deployment is provided by the plugin.
