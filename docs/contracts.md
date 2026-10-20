# Contracts v2

`perse` = persevere. Part of Persevere with DSH.

## State and authority

Dashboard intake only; GitHub Issues synchronization is outside this version. Lifecycle:

```text
triage → needs-info / blocked / todo
 todo → in-progress → blocked / in-review → done
```

Native analysis returns an immutable-criteria plan, risk and route. Needs-info requires questions. Human routing blocks implementation. Staged and manual-marked work can execute, but cannot automatically finish. Existing tasks migrate to manual completion, with intake disabled. `docs/automation.md` defines the owner-approved policies and point-in-time verification boundary.

DSH owns registered Workspaces and Sessions. Every agent phase checks the actual calling Session and workspace. Analysis/review Sessions cannot claim execution work or receive execution assignments. Review uses a fresh Session different from both analyst and executor. No agent tool exposes owner acceptance, policy editing or automatic completion. Only Host code applies completion gates after the relevant native Agents are idle.

## Commands and durability

Remote namespace `perseDashboard`: snapshot, create, update, dispatch, analyze, verify, image, inputImage, watch. All are owner-only under DSH policy and checked at the service boundary. No production HTTP service outside DSH Gateway is introduced.

`inputImage` is task-scoped: it resolves one attachment id recorded in that task's `inputImages`, reads and verifies it through `ctx.attachments`, and returns a data URL. Foreign, missing and corrupt ids fail without falling back to workspace paths. The separate `image` Remote continues to read recorded workspace-relative evidence files.

Task mutations create/update and agent reports carry a requestId; updates and phase reports also carry expectedVersion. The Host serializes decisions and atomically commits task + ledger + dedup receipt in one Storage Domain global write, before publishing or returning success. An identical request returns its original result; reusing its id with a different payload or actor fails. Stale writes fail without a phantom revision. Receipts are retained across restart within the bounded storage retention policy.

Analyze/verify coordinate native side effects. They validate the expected task version but do **not** promise durable exactly-once execution of the complete multi-step command. Clients do not automatically retry them. Inspect the linked phase Session and task before explicitly retrying; a lost response is not evidence that no Session was created. Dispatch activation is process-local and disarmed on restart.

Tools: `dashboard_claim_next`, `dashboard_report`, `dashboard_triage`, `dashboard_review`. Claim atomically binds one eligible task to the actual Session. Only one in-progress task per Session is allowed. Report requires concrete evidence and enters in-review or blocked. Analysis/review reports require a matching phase Session and version. Analysis can propose criteria only when none existed; it cannot rewrite existing criteria or owner rules.

## Completion and recovery

Manual acceptance requires nonempty evidence, at least one criterion, every criterion checked, and an owner action. Verified completion requires a check covering every criterion; create/update rejects a `verified` policy that does not have exactly one check per criterion, so an unsatisfiable policy cannot be stored. Acceptance clears the pre-acceptance machine note, and completed tasks never present a pending automation gate. Reviewed completion requires a separate native reviewer, all criteria passing with evidence, low risk and no remaining risks. Optional approved file checks apply to reviewed tasks too. All automatic modes additionally require express, low risk, no manual flag and an evidence report. Receipts record rule version, prompt/policy hash, evidence hash, criterion results, file-check results and reviewer identity.

File checks compare exact UTF-8 text or SHA256 for a bounded regular file inside the registered workspace. They reject absolute paths, traversal and escaping symlinks. They are point-in-time checks; they do not prove future immutability or arbitrary program correctness. A reviewer is another model Session, not a human or an independent formal verifier. The selected owner policy is the authority to use this evidence.

Failure, cancellation, missing reports and failed/partial review never imply done. Each phase has at most one same-Session report reminder after idle; execution reminders forbid repeating side effects. A repeated omission blocks only that task, while infrastructure failures pause dispatch. Owner `update/retry` restores unanalyzed intake to triage and already analyzed or manual execution to todo; it retains evidence and audit history. Lifecycle changes are also blocked while phase preparation or completion jobs are active. Errors remain visible. Restart preserves task state, disarms dispatch, and never replays an old in-progress claim. Explicitly inspect and requeue stuck work; a pending automatic verification can be retried from its detail panel. Pause stops subsequent issues; native DSH controls stop an active Agent.

## Client and compatibility

The native resource starts with a full replacement snapshot and reconnect replaces its baseline. Command responses do not overwrite the streamed task resource. Unknown fields are tolerated; malformed/incompatible task generations disable mutation and retain a last confirmed baseline. Scope, rule and lifecycle changes are rejected while a linked execution/analysis/review Agent is running. Accepted evidence is frozen until explicit reopening. Archives preserve evidence and have a restore path.

Optional image attachments and a persisted review prompt hash are additive fields; old tasks default to no images/no hash. `image` is an owner-only, bounded read of a recorded workspace-relative PNG/JPEG/WebP attachment, with path and symlink confinement. Criterion edits before execution invalidate analysis and review. Needs-info/human reports may have no criteria; executable routes cannot. Independent review can collect evidence for staged work, with automatic completion still held for explicit owner acceptance.

Task input images are a separate, additive field. Create accepts up to four bounded PNG/JPEG/WebP/GIF drafts; update accepts new drafts plus opaque `keep` references, so an edit never re-uploads unchanged bytes. The Host validates every member, saves the batch through `ctx.attachments.saveImages`, and persists only `{attachmentId, mediaType, bytes, width, height, name, source}` with `source` identifying the description or acceptance-criteria field. Task and snapshot records never contain base64. Text-only tasks parse and load with an empty list. Editing images has the same scope-invalidation effect as editing description or criteria: analysis, review, completion and automation notes are cleared and the task returns to triage under an automatic policy.

Analysis, execution and independent review receive the task prompt plus, for each image in order, an `INPUT_IMAGE n/total` text label naming its source and metadata followed by the image content part. Prompt facts include image metadata but no bytes. The bounded repair reminder is text-only; image parts are never resent. A selected model route that does not declare image input blocks the task with a visible capability message rather than allowing the route to project images to text placeholders.

Domain storage stays version 1 with defaults for the new optional persisted fields; the wire vocabulary and rule generation are v2. This is a forward migration: old plugin builds are not guaranteed to read triage/needs-info states; back up the isolated profile before downgrading. DSH preview APIs remain pinned to the tested runtime generation.

## Task language

`Task.language` (`zh` | `en` | `null`) is an additive persisted field. New tasks record the active DSH locale when the owner creates them; an older client that omits it falls back to content inference. Legacy tasks remain `null` until an owner edit saves the normalized description. Resolution priority is: persisted task language, then deterministic content inference, then `en` for empty content. Inference counts Han and Latin letters in owner-authored title/description first; generated criteria are considered only when that text is inconclusive, so English-generated criteria on a Chinese task do not flip it. The legacy `Acceptance expectations supplied by owner:` marker is ignored during inference and rendered/prompted as `所有者补充的验收期望：` for Chinese tasks.

Phase prompts, bounded report reminders and Host machine notes follow the resolved task language. Machine contracts do not change with language: tool names (`dashboard_triage`, `dashboard_report`, `dashboard_review`), field keys, `TASK_DATA=`, `EXECUTOR_EVIDENCE=`, `REPORT_REMINDER:` and the `PERSE_PHASE=` marker stay literal. Switching the UI language never retargets existing tasks, and historical analysis, evidence and review text is never silently translated or rewritten; accepted evidence remains frozen by `completion.evidenceHash` until explicit reopening. Only display-time description normalization and the next owner edit are localized.

UI editing captures the task version when the draft begins. A streamed version change preserves the draft and disables its save until explicit reload; successful saves still use the existing expectedVersion gate. Closing a dirty task, creating draft or navigating to a linked Session requires draft dismissal. Native modal background inertness prevents simultaneous workspace/filter changes. The UI never infers completion from the current tab or visual execution state.

Approval wait is an execution substate, not completion review or a durable task transition. Dashboard controls only navigate to the native Session; no Remote/tool here decides an approval. Permission defaults are read from the DSH catalog and updated only as `permission.defaultPreset` through the owner Settings Remote, with advertised choices, the captured revision and explicit client confirmation. This global default affects subsequently created Sessions. Existing Sessions and pending decisions retain their current state. Missing/read-only settings are visible and fail closed. See [approval awareness](approval-awareness.md).
