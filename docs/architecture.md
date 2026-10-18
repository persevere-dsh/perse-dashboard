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

A plugin installation belongs to one DSH Host. Local and SSH-accessible DSH instances each retain their own state and access boundary. This version displays the active Host; it does not pretend a Session id is globally unique or aggregate unrelated hosts. Connect to a remote DSH Web instance through its existing trusted transport/SSH forwarding; the same plugin runs inside that remote Host. Multi-host credential brokering is outside v1.

## Development simulation

Hermex `scripts/test-sim` inspired assigned resources, stable advisory locks, bounded boot/test phases, captured process-group cleanup and retained evidence. `scripts/sim` creates a fresh DSH_HOME, packages and installs the actual tarball into a fresh Web profile, then boots the local DSH runtime on an isolated loopback port. Native lane uses a scripted LLM plugin through the official LLM registry, never replaces Host/controller/transport. Live lane loads only the configured model credentials into the isolated home and proves a real model turn. Browser assertions exercise native slots, task mutations, draft handoff, agent claim/report, conflicts and reload. summary.json records lane, runtime version, source commit, artifact hash, assertions and cleanup.

The simulator allocates its runtime home and workspace **outside the checkout**. A self-named Node package can otherwise resolve to the checkout rather than the installed tarball. A read-only simulation probe asserts the Host client artifact realpath equals the installed package realpath before browser acceptance. Local artifacts remain under `.build/sim`; `state` links to the retained external runtime state.
