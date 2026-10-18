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

Remote namespace `perseDashboard`: snapshot, create, update, dispatch, analyze, verify, watch. All are owner-only under DSH policy and checked at the service boundary. No production HTTP service outside DSH Gateway is introduced.

Task mutations create/update and agent reports carry a requestId; updates and phase reports also carry expectedVersion. The Host serializes decisions and atomically commits task + ledger + dedup receipt in one Storage Domain global write, before publishing or returning success. An identical request returns its original result; reusing its id with a different payload or actor fails. Stale writes fail without a phantom revision. Receipts are retained across restart within the bounded storage retention policy.

Analyze/verify coordinate native side effects. They validate the expected task version but do **not** promise durable exactly-once execution of the complete multi-step command. Clients do not automatically retry them. Inspect the linked phase Session and task before explicitly retrying; a lost response is not evidence that no Session was created. Dispatch activation is process-local and disarmed on restart.

Tools: `dashboard_claim_next`, `dashboard_report`, `dashboard_triage`, `dashboard_review`. Claim atomically binds one eligible task to the actual Session. Only one in-progress task per Session is allowed. Report requires concrete evidence and enters in-review or blocked. Analysis/review reports require a matching phase Session and version. Analysis can propose criteria only when none existed; it cannot rewrite existing criteria or owner rules.

## Completion and recovery

Manual acceptance requires nonempty evidence, at least one criterion, every criterion checked, and an owner action. Verified completion requires a check covering every criterion. Reviewed completion requires a separate native reviewer, all criteria passing with evidence, low risk and no remaining risks. Optional approved file checks apply to reviewed tasks too. All automatic modes additionally require express, low risk, no manual flag and an evidence report. Receipts record rule version, prompt/policy hash, evidence hash, criterion results, file-check results and reviewer identity.

File checks compare exact UTF-8 text or SHA256 for a bounded regular file inside the registered workspace. They reject absolute paths, traversal and escaping symlinks. They are point-in-time checks; they do not prove future immutability or arbitrary program correctness. A reviewer is another model Session, not a human or an independent formal verifier. The selected owner policy is the authority to use this evidence.

Failure, cancellation, missing reports and failed/partial review never imply done. Errors remain visible. Restart preserves task state, disarms dispatch, and never replays an old in-progress claim. Explicitly inspect and requeue stuck work; a pending automatic verification can be retried from its detail panel. Pause stops subsequent issues; native DSH controls stop an active Agent.

## Client and compatibility

The native resource starts with a full replacement snapshot and reconnect replaces its baseline. Command responses do not overwrite the streamed task resource. Unknown fields are tolerated; malformed/incompatible task generations disable mutation and retain a last confirmed baseline. Scope, rule and lifecycle changes are rejected while a linked execution/analysis/review Agent is running. Accepted evidence is frozen until explicit reopening. Archives preserve evidence and have a restore path.

Domain storage stays version 1 with defaults for the new optional persisted fields; the wire vocabulary and rule generation are v2. This is a forward migration: old plugin builds are not guaranteed to read triage/needs-info states; back up the isolated profile before downgrading. DSH preview APIs remain pinned to the tested runtime generation.

UI editing captures the task version when the draft begins. A streamed version change preserves the draft and disables its save until explicit reload; successful saves still use the existing expectedVersion gate. Closing a dirty task, creating draft or navigating to a linked Session requires draft dismissal. Native modal background inertness prevents simultaneous workspace/filter changes. The UI never infers completion from the current tab or visual execution state.
