# Approval awareness and default permissions

## Observed defect

On 2026-10-18 the native DSH sidebar/composer showed an execution Session awaiting approval for a danger-full-access nested native sim command. The dashboard showed the same task as Executing, active 1, with no warning. The UI read only `running`; official `useSessionStatus` also exposes independent `pendingInteraction`. The Lab dense fixture incorrectly used kind `permission` instead of the official `approval`, and had no assertion for the warning.

## Design

- Preserve Host task lifecycle and native running truth. Pending approval, question, plan review or unknown interaction takes display precedence; it does not mutate tasks to blocked or authorize anything.
- Read the shared official Session status hook. Display workspace-scoped attention counts, banner, queue waiting state, task and Session badges, and phase-specific links. Resolved requests disappear through the same hook. Show each Session once even if linked multiple times; do not treat historical links of finished tasks as active phases.
- Display the actual DSH default permission preset and its scope (all future Sessions, including dashboard analysis, execution and review). Read the official permission catalog and Settings namespace. Edit only permission.defaultPreset through the official Settings Remote with its revision. No parallel policy store and no direct configuration/log writes.
- Settings changes need an explicit in-product confirmation, including acknowledgement that Full access removes sandbox/individual approval protections. Existing Sessions and pending decisions keep their current settings; assignments retain existing Session permissions. Errors, read-only settings and absent services remain visible.
- The dashboard opens the native Session to let DSH render the request and receive its answer. It provides no automatic approval, approval timeout or hidden permission escalation.

## Acceptance

Synthetic Lab: approval appears while running remains true, resolves and reappears, all phases, workspace isolation, unknown interactions, missing permissions provider, default setting confirmation/cancel/conflict/reload, and no implicit grant. Native lane: real tool approval held while dashboard warns, then explicit rejection in the isolated sim unblocks the scripted model; verify no protected file was created. Read and restore the disposable profile's permission setting through public Remotes. Real Desktop: retain the currently pending request; do not restart/cancel the live Agent to install a UI change.
