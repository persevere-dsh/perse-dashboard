# Approval awareness and default permissions

## Observed defect

On 2026-10-18 the native DSH sidebar/composer showed an execution Session awaiting approval for a danger-full-access nested native sim command. The dashboard showed the same task as Executing, active 1, with no warning. The UI read only `running`; official `useSessionStatus` also exposes independent `pendingInteraction`. The Lab dense fixture incorrectly used kind `permission` instead of the official `approval`, and had no assertion for the warning.

## Design

- Preserve Host task lifecycle and native running truth. Pending approval, question, plan review or unknown interaction takes display precedence; it does not mutate tasks to blocked or authorize anything.
- Read the shared official Session status hook. Display workspace-scoped attention counts, banner, queue waiting state, task and Session badges, and phase-specific links. Resolved requests disappear through the same hook. Show each Session once even if linked multiple times; do not treat historical links of finished tasks as active phases.
- Display the actual DSH default permission preset and its scope (all future Sessions, including dashboard analysis, execution and review). Read the official permission catalog and Settings namespace. Edit only permission.defaultPreset through the official Settings Remote with its revision. No parallel policy store and no direct configuration/log writes.
- Settings changes need an explicit in-product confirmation, including acknowledgement that Full access removes sandbox/individual approval protections. Existing Sessions and pending decisions keep their current settings; assignments retain existing Session permissions. Errors, read-only settings and absent services remain visible.
- The dashboard opens the native Session to let DSH render the request and receive its answer. It provides no automatic approval, approval timeout or hidden permission escalation.

## Applying the saved default to existing Sessions

- Saving the default stays future-Sessions-only and never triggers an apply. The owner clicks a separate “Apply to existing Sessions” control, reviews a preview, acknowledges the one-time scope and confirms.
- Preview reads current Host live Sessions in registered workspaces and reports the target preset, target count, workspace groups, exclusions (running; pending approval/question/plan-review; already at target) and unsupported Sessions (archived, cold, child, other workspace) with reasons. It is read-only.
- Apply sends only the preview's target ids and revalidates the captured `permission.defaultPreset` Settings revision and preset. A changed revision or default fails closed with a stale error and requires a fresh preview; nothing is retried automatically.
- Each target is changed once through the official `PermissionPresetService.set`, then its effective preset, sandbox mode and approval policy are read back. Results list applied, skipped and failed Sessions with reasons; read-back mismatches remain visible.
- The action never approves, rejects or answers a pending decision. It does not append Session events directly, write configuration files or a private database, or mutate the board ledger. v1 refuses to bulk-apply `danger-full-access`; a lower catalog preset must be saved first.
- Cold/archived Sessions cannot be changed through the v1 apply action; they are listed as unsupported until an upstream bulk API exists. Child Sessions and Sessions outside registered workspaces are likewise unsupported.

## Acceptance

Synthetic Lab: approval appears while running remains true, resolves and reappears, all phases, workspace isolation, unknown interactions, missing permissions provider, default setting confirmation/cancel/conflict/reload, and no implicit grant. The permission-settings scenario also covers apply preview/cancel/confirm, stale revision, partial write failure, read-back mismatch, Full access refusal and the unchanged-existing-Session assertion after a default save. Native lane: real tool approval held while dashboard warns, then explicit rejection in the isolated sim unblocks the scripted model; verify no protected file was created. It also saves Full access, creates an existing Session at that preset, saves a lower default, applies to that Session through the preview, and reads the effective preset back while other Sessions stay unchanged. Read and restore the disposable profile's permission setting through public Remotes. Real Desktop: retain the currently pending request; do not restart/cancel the live Agent to install a UI change.
