# Workflow recovery design

## Findings

A phase can end after reasoning without calling its report tool. A missing report formerly paused every later issue. Pending native interactions were counted, but blocked tasks, human completion gates and idle unfinished phases were absent from the attention summary. Review eligibility was checked before an independent review, preventing staged work from obtaining review evidence. Recovery required discovering generic state selectors. Evidence was presented in one editable textbox.

## Boundaries and recovery

DSH continues to own Agents, permissions, Sessions and idle semantics. BoardController is the only durable task writer. A shared phase runner waits for idle, checks the actual task phase and sends at most one report reminder in the same Session. An executor reminder forbids repeating implementation. No unbounded retry or inferred report is allowed. After a second omission the task is blocked; task-local omissions do not pause unrelated work. Transport, persistence and runtime errors still pause dispatch.

Owner retry is an atomic, versioned command through update. It returns unanalyzed work to triage and analyzed execution work to todo, preserving evidence and audit history while clearing current phase links. Live Agents prevent retry. A stopped unfinished phase after restart is shown as recoverable; restart never silently replays execution. Scope edits and criterion changes invalidate analysis and previous review. Needs-info may report with no criteria until requirements are supplied; executable routes require criteria.

Dependencies use the same explicit recovery boundary. A blocked, needs-info, archived or reopened dependency durably blocks not-started successors with `dependency-invalidated:<taskId>:<status>`; transitive descendants are included, while in-progress or in-review successors keep running and show attention. The owner retries each affected successor after re-evaluating the dependency. A stale in-progress claim after restart continues to hold its lane and resource keys until owner retry or phase recovery, even when the old DSH Agent is gone; no recover command is added. Scope edits that change dependencies or resource keys invalidate analysis, review and completion and return automatic work to triage.

Review and completion are separate. Reviewed policy may obtain an independent review for staged work, while automatic completion remains restricted to express, low-risk, non-manual tasks with all existing gates. Human acceptance is explicit. A valid existing review is reused when resuming verification; a retry never replaces an active reviewer. Task details show completion blockers, remaining checks and the precise next action. The board keeps its existing task cards; it must not duplicate tasks in an additional instruction grid.

## Evidence

Text evidence is rendered as paragraphs and sections, with editing behind a disclosure. Per-criterion review results appear next to criteria. Optional image attachments reference workspace-relative PNG/JPEG/WebP files and an optional criterion index. Host reads are owner-only, bounded and restricted to attachments already recorded on that task; path traversal, escaping symlinks and invalid image bytes fail. The Client receives a data URL through generated Typert Remote, never arbitrary filesystem or HTML access. Attachments supplement evidence; their presence is not proof of a criterion.

## Verification

Add contract tests for reasoning-only stop and bounded recovery, task-local failure isolation, retry phase choice, clarification with no criteria, immutable historical evidence, reviewer reuse and completion gates. Stateful browser cases cover next steps, restart recovery, criterion editing, evidence sections and image preview. Native lane verifies the packed plugin with real DSH Host, Sessions and tools. Existing user tasks and settings are preserved during deployment; changes to their state go through owner commands.
