# Analysis, execution and completion

`perse` = persevere. Part of Persevere with DSH.

DSH remains the executor, permission authority and Session owner. A dashboard issue can enter triage; a dedicated native analysis Session returns a structured summary, plan, criteria, risk and route. Routes are express, staged, needs-info and human. Analysis cannot change owner completion checks or an existing criterion. Missing information is visible and not executable. Staged work can execute but retains human acceptance.

An opt-in watcher handles future dashboard issues while its activation budget remains. It consumes board notifications and native Agent status events, not an unbounded polling loop. Pause prevents starting subsequent issues; DSH owns stopping an already active Agent. A phase that stops without reporting receives one bounded report reminder. An executor reminder requests a report from existing results and forbids repeating implementation. A second omission blocks that issue while other issues continue; infrastructure errors pause the queue. Restart disarms the watcher and never re-executes an old in-progress claim.

## Completion policies

- manual: all criteria checked and explicit owner acceptance (legacy tasks keep this default).
- verified: express + low risk + no manual flag + nonempty evidence + an owner-defined machine check for every criterion. Checks read regular files under the registered workspace and compare exact text or SHA256. Path escapes and symlinks outside that workspace fail. No arbitrary Host shell commands bypass DSH permissions.
- reviewed: express + low risk + no manual flag + a different native reviewer Session. The reviewer must cover every criterion, supply evidence, report no remaining risks and recommend pass. A host transition after reviewer idle records the automatic completion; a model saying "done" does not complete the task. Configured machine checks still apply.

Rules are owner-owned, versioned with the task, and frozen during execution. Structured analysis and review reports are bound to the actual phase Session and expected task version. The executor cannot review itself. Partial, failed, high-risk or ambiguous outcomes remain visible for a human; no silent success or automatic external publication occurs.

Prompt templates are versioned source in src/host/prompts.ts. Each template is selected by the resolved task language (persisted task value, then legacy content inference, then `en`). Chinese tasks receive Chinese analysis, execution, review and bounded-reminder text; English tasks keep English. Tool names, argument keys, `TASK_DATA=`, `EXECUTOR_EVIDENCE=`, `REPORT_REMINDER:` and `PERSE_PHASE=` markers are literal in both languages so the Host, simulations and phase identity checks do not depend on prose. Owner instructions are displayed and included as a separate rule section. Untrusted issue text and evidence are serialized as data. Prompts require actual verification, disclose unavailable checks, forbid claiming human approval and describe the Host's final authority. Prompt instructions supplement mechanical policy enforcement; they do not replace it. Historical analysis, evidence and review are not translated, and accepted evidence stays frozen until explicit reopening.

## Visible recovery and acceptance

The board retains one task list. Its attention count includes blocked, needs-info, stopped unfinished and review-held work; compact card status and task detail explain the next action. There is no additional task grid above the board. Recover task is an explicit owner command; it preserves report/audit history and clears the active claim. Start the queue afterward. Scope and generated criterion edits require a fresh analysis.

Reviewed policy collects independent evidence even for staged work; staged/medium-risk/manual-marked tasks still require owner acceptance. A fully passed review may be reused while waiting for human acceptance; failed/partial/high-risk/missing reports and failed machine verification require fresh checks. The exact review prompt hash is retained for the completion receipt. Native pending approvals remain exclusively in DSH.
