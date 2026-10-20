# Changelog

## 1.6.1

- Clear the pre-acceptance machine note when the owner accepts a task, and never present that note on a completed task. Legacy completed rows with the old note are normalized on read.
- Reject a `verified` completion policy that does not have exactly one machine check per criterion at create/update time, so a task cannot be stored in a state that can never auto-complete.
- Show an explicit stopped-queue message when a workspace has eligible tasks but its queue is not running.

## 1.6.0

- Persist task language on create from the active DSH locale (`zh`/`en`). Legacy tasks without the additive field resolve deterministically: persisted value first, then Han/Latin share of owner-authored title/description (generated criteria only when that is inconclusive), then `en` for empty content. All five existing board tasks infer `zh` and keep their stored criteria, evidence and versions.
- Generate complete Chinese analysis, execution and review prompts plus Chinese bounded report reminders for `zh` tasks; English tasks keep the English prompts. `dashboard_triage`, `dashboard_report`, `dashboard_review`, field keys, `TASK_DATA=`, `EXECUTOR_EVIDENCE=`, `REPORT_REMINDER:` and the new `PERSE_PHASE=` marker remain literal.
- Localize client chrome: the intake form appends `所有者补充的验收期望：`, the prepared DSH draft prompt follows the active locale, and machine notes such as `human-acceptance-required`, `Human implementation required`, `Machine verification failed:` and `Automatic verification unavailable:` render in Chinese. Stored note tokens, accepted evidence and `completion.evidenceHash` are unchanged.
- Normalize the legacy English intake marker for display and prompt facts on Chinese tasks without rewriting storage or bumping the version; the next owner edit saves the Chinese marker.
- Add language contract, prompt, reminder, note and legacy-task tests; extend Lab with a bilingual language scenario and the native lane with zh prompt/field/reminder checks plus an inferred-English regression. Record `language-evidence.json` in the run summary, including live zh output when the live lane runs.
- Document the language priority, additive migration, frozen historical evidence and the rule that historical analysis, evidence and review are never silently translated.

## 1.5.0

- Accept pasted and attached PNG/JPEG/WebP/GIF input images in both the task-description and acceptance-criteria fields, with bounded validation, thumbnails, source labels, byte sizes and explicit removal in create and edit forms.
- Persist only normalized input-image references (attachment id, media type, byte size, dimensions, name, source) on the task; previews load through a new owner-only task-scoped `inputImage` Remote that reads one recorded attachment and rejects foreign, missing or corrupt ids. Task snapshots never carry base64.
- Send ordered labelled image content parts in analysis, execution and independent review prompts; `TASK_DATA` gains metadata only, and the bounded repair reminder stays text-only so image parts are never duplicated.
- Block an image-bearing task with a visible capability message when its selected model route is text-only instead of letting the route silently replace images with placeholders.
- Add contract coverage for input defaults/migration, create/update idempotency, edit invalidation of analysis/review/completion, prompt ordering and attachment-read confinement, plus a native browser journey that verifies every phase request contains image blocks whose SHA-256 equals the uploaded fixtures. Storage stays version 1; old tasks default to no input images.

## Unreleased

- Document the DSH 0.2.1 Session-log boundary: a 0.2.0 Host skips this pinned plugin and refuses logs containing `job/registered`, so the remedy is to launch the 0.2.1 runtime rather than downgrade or edit logs.
- Require install verification against the exact DSH app the owner runs, including Session resume, a new real-model turn and a client reload.

## 1.4.2

- Replace the orange dashboard accent with the DSH business-blue token. `--pd-accent` now follows `--dsw-alias-state-business-primary` (light `#4176e6`, dark follows the DSH theme) and primary button labels follow `--dsw-alias-label-primary-foreground`; the retired `#f0b03a` and `#211704` literals are gone from source, build output and the packed tarball.
- Keep success `#28ad79`, danger `#df5c67`, and the warm semantic stage colors needs-info `#e1a44c` and in-review `#c5a052` unchanged. These stage colors are status indicators, not the brand accent, and must not be confused with it.
- Add source/build/tarball regression assertions plus native browser checks for the primary button, focus ring, selected tab underline, attention/stat icons, audit nodes and readable light/dark/mobile screenshots.

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
