# Analysis, execution and completion

`perse` = persevere. Part of Persevere with DSH.

DSH remains the executor, permission authority and Session owner. A dashboard issue can enter triage; a dedicated native analysis Session returns a structured summary, plan, criteria, risk and route. Routes are express, staged, needs-info and human. Analysis cannot change owner completion checks or an existing criterion. Missing information is visible and not executable. Staged work can execute but retains human acceptance.

An opt-in watcher handles future dashboard issues while its activation budget remains. It consumes board notifications and native Agent status events, not an unbounded polling loop. Pause prevents starting subsequent issues; DSH owns stopping an already active Agent. Restart disarms the watcher and never re-executes an old in-progress claim.

## Completion policies

- manual: all criteria checked and explicit owner acceptance (legacy tasks keep this default).
- verified: express + low risk + no manual flag + nonempty evidence + an owner-defined machine check for every criterion. Checks read regular files under the registered workspace and compare exact text or SHA256. Path escapes and symlinks outside that workspace fail. No arbitrary Host shell commands bypass DSH permissions.
- reviewed: express + low risk + no manual flag + a different native reviewer Session. The reviewer must cover every criterion, supply evidence, report no remaining risks and recommend pass. A host transition after reviewer idle records the automatic completion; a model saying "done" does not complete the task. Configured machine checks still apply.

Rules are owner-owned, versioned with the task, and frozen during execution. Structured analysis and review reports are bound to the actual phase Session and expected task version. The executor cannot review itself. Partial, failed, high-risk or ambiguous outcomes remain visible for a human; no silent success or automatic external publication occurs.

Prompt templates are versioned source in src/host/prompts.ts. Owner instructions are displayed and included as a separate rule section. Untrusted issue text and evidence are serialized as data. Prompts require actual verification, disclose unavailable checks, forbid claiming human approval and describe the Host's final authority. Prompt instructions supplement mechanical policy enforcement; they do not replace it.
