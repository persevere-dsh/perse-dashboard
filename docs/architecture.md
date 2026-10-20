# Architecture

`perse` = persevere. Part of Persevere with DSH.

## Ownership

DSH Host is authoritative for Sessions, Workspaces, agent status, projections, prompts, approvals, persistence and remote access. This plugin owns tasks, acceptance criteria, evidence and an audit ledger in a versioned `perse-dashboard` Storage Domain. It never duplicates the agent runtime, credentials, conversation timeline or worktree registry.

Native client entry registers `main` and `sidebar.panellist` slots. A pure presentation layer receives framework `useSessions`, `useWorkspaces`, `useSessionStatus`, resource hooks, localized copy and injected callbacks. Native `uiWorkspace` prepares unsent drafts and opens linked Sessions. Live work always remains in the DSH conversation. Host APIs use `TypertRemoteService` and published codegen; runtime peers remain external. Each Client generation replaces its task resource baseline.

## Directory

- src/contract: wire types and domain rules; no UI or Host imports.
- src/host: task store and controller, DSH storage and tool adapters.
- src/client: registration, components, localization and semantic styles.
- scripts: build, codegen, package gate and resource-owning sim runner.
- test: offline contracts, failure injection, lifecycle and concurrency tests.
- sim: real-host browser journeys, deterministic model provider, live model probe.
- docs: design, contracts, compatibility and operational instructions.

## Runtime topology

A plugin installation belongs to one DSH Host. Local and SSH-accessible DSH instances each retain their own state and access boundary. This version displays the active Host; it does not pretend a Session id is globally unique or aggregate unrelated hosts. Connect to a remote DSH Web instance through its existing trusted transport/SSH forwarding; the same plugin runs inside that remote Host. Multi-host credential brokering is outside this version.

## Development simulation

Hermex `scripts/test-sim` inspired assigned resources, stable advisory locks, bounded boot/test phases, captured process-group cleanup and retained evidence. `scripts/sim` creates a fresh DSH_HOME, packages and installs the actual tarball into a fresh Web profile, then boots the local DSH runtime on an isolated loopback port. Native lane uses a scripted LLM plugin through the official LLM registry, never replaces Host/controller/transport. Live lane loads only the configured model credentials into the isolated home and proves a real model turn. Browser assertions exercise native slots, task mutations, draft handoff, agent claim/report, conflicts and reload. summary.json records lane, runtime version, source commit, artifact hash, assertions and cleanup.

The simulator allocates its runtime home and workspace **outside the checkout**. A self-named Node package can otherwise resolve to the checkout rather than the installed tarball. A read-only simulation probe asserts the Host client artifact realpath equals the installed package realpath before browser acceptance. Local artifacts remain under `.build/sim`; `state` links to the retained external runtime state.

## Intake and completion architecture

BoardController is the single mutation authority. Dispatcher consumes board changes and official `agent/status` events, runs a bounded sequential analysis/execution pipeline and tracks a process-local activation budget. CompletionCoordinator serializes post-execution verification and native independent review. All use official Session creation, prompt and idle APIs. Rules and prompt templates live in policy.ts and prompts.ts. UI configuration is explicit owner policy; analysis cannot expand it.

Task language is task-local, not Host-global. The Client captures the active DSH locale on create; the Host persists it where present and otherwise resolves legacy content deterministically (owner-authored Han share first, generated criteria only when inconclusive, `en` for empty content). prompts.ts and the bounded reminder select the matching template, while machine tokens and field keys remain language-independent. Client dictionaries own owner-facing chrome and machine-note presentation. Historical generated text, evidence and review remain byte-identical; only the known legacy intake marker is normalized for display and prompt facts, and the next owner edit persists it.

Task input images are a Host-owned reference layer over the optional `ctx.attachments` capability. Create/update drafts are validated and saved before the board mutation, so the board persists metadata only. Ordered prompt content is built in phases.ts: the prompt text, then each image's source/order label and bytes. The dispatcher and completion coordinator resolve the exact Session route's declared `image` modality before prompting and block image work when the route is text-only. Client previews of saved images go through the owner-only task-scoped Remote; no attachment bytes enter task snapshots or the Storage Domain.

Lab uses the same presentation components and production controllers. `sim/lab/backend.mjs` owns complete mutable fixture state, Sessions, Workspaces, scripted execution and JSON persistence; `server.mjs` provides loopback-only development HTTP/SSE and fault controls; `client.tsx` supplies synthetic framework hooks. Lab transport is explicitly synthetic and excluded from the production package. `sim/fixtures/scenarios.json` is the coverage inventory. Native/live lanes independently prove the real DSH integration and exact installed artifact.

## Client surfaces

The board, list, Session table and top-layer task dialogs share one scoped token system. Dialogs are ordinary HTML `dialog` elements inside the plugin slot, with native modality, focus return and nested draft confirmation. They neither register OS windows nor read or modify host DOM. Task properties and evidence retain their captured version while dirty; external resource changes require an explicit reload. See [UI revision](ui-redesign.md).

## Permission and attention UI

Native `useSessionStatus` supplies independent running and pending-interaction facts. Approval/question/plan-review takes presentation precedence without rewriting task lifecycle or running semantics. Workspace-scoped attention includes unlinked Sessions; task badges follow current phase identities only. Default permissions come from the official permission catalog and Settings namespace through a separate capability fiber, so unavailable optional services do not remove the board. No permission store is duplicated.

## Workflow recovery

See [workflow recovery design](workflow-recovery.md). The shared phase runner permits one report repair turn over the official native prompt/idle APIs. Task-local omissions are isolated from runtime/persistence failures. Presentation derives actionable next steps from durable task truth, the dispatcher and native Session state; it never treats an idle Agent as completion. Independent review and automatic completion are separate operations. Owner recovery and criterion editing use atomic versioned task updates. Image evidence uses the owner-only generated Remote and the registered workspace boundary.
