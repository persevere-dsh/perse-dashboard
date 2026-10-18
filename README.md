# Dashboard — Persevere with DSH

`perse` = persevere.

[![verify](https://github.com/persevere-dsh/perse-dashboard/actions/workflows/ci.yml/badge.svg)](https://github.com/persevere-dsh/perse-dashboard/actions/workflows/ci.yml)

A native DeepSeek Harness dashboard for assigning work, atomically claiming tasks, reviewing evidence and opening the real execution Session. It uses official Cordis plugins, UI slots, generated Typert Remote, Storage Domains and the DSH Session Controller.

## What you can do

- View tasks by DSH Workspace, search, priority and archive state.
- Assign a task to one existing Session, or leave it in the workspace queue.
- Let agents call `dashboard_claim_next`; the Host chooses one eligible task atomically and binds the actual calling Session.
- Start an **opt-in, single-worker queue** from the dashboard. It sends tasks through the official Session Controller, uses the Host's configured model and permissions, and stops after 10 tasks, a pause, an error or a missing evidence report.
- Follow native Session running/attention state and provider-reported token usage.
- Prepare an **unsent** native DSH draft, or open a task's linked conversation.
- Analyze dashboard issues in a dedicated native Session, with express/staged/needs-info/human routing.
- Watch newly created issues with an activation budget (1–100), automatic claiming and execution.
- Choose owner acceptance, exact file checks, or independent native review as the completion policy. Low-risk express tasks can finish automatically; staged/manual-marked tasks retain owner acceptance.
- Configure completion instructions and per-criterion file checks from the task form. See [completion rules](docs/automation.md).
- Archive, restore and reopen tasks; accepted evidence is frozen until reopening.

No CDP, DOM rewriting, iframe injection, replacement Agent runtime or separate dashboard HTTP service is involved. The native panel follows DSH locale and theme.

## Install

Tested with DSH **0.2.1-rc.2**, Cordis **4.0.5**, Node **24**. Preview API generations are pinned deliberately.

```sh
npm ci
npm run check
npm pack
# Standard CLI:
dsh plugin --profile web add ./perse-dashboard-1.3.0.tgz
# This Mac's installed DSH Desktop CLI, if dsh is not on PATH:
scripts/dsh plugin --profile desktop add ./perse-dashboard-1.3.0.tgz
```

Restart the selected DSH instance after installing. Open **Dashboard** from its native sidebar. Installation is always tarball based; do not use `npm link` or a directory dependency. `scripts/dsh` only forwards to the unmodified CLI; it does not patch the application.

## Agent workflow

Create a task with its intended result and acceptance criteria. Choose **Prepare DSH draft** and send it after reviewing the prompt, or enable **Start queue** for the selected workspace.

An agent can also consume the workspace queue directly:

```text
Use dashboard_claim_next to claim one eligible task in this workspace.
Implement it, run meaningful verification, then call dashboard_report
with its taskId, returned version and concrete evidence.
```

Assigned tasks are available only to their assigned Session. Use Open DSH session to open it, then request the claim there, or start the queue; preparing a new draft is disabled for assigned tasks. A claim is durable and has no automatic expiry: a stopped agent cannot silently release work to another agent. Inspect the linked Session and explicitly return blocked work to the queue. Pausing the dispatcher stops subsequent dispatches; stop an active Agent through its normal DSH conversation controls.

The plugin's agent tools expose claim/report/triage/review, never owner acceptance or completion-policy editing. Owner Remote commands remain in DSH's trusted owner boundary; the plugin cannot prove that a physical human, rather than authorized owner automation, clicked a button.

## Simulator for agent development

The simulator borrows Hermex's resource ownership approach: a checkout lock, one isolated home/workspace/port/process group per run, bounded setup/test phases, and retained logs, screenshots and JSON results.

```sh
npm ci
npx playwright install chromium
npm run sim -- --lane lab --scenario all --repeat 2
npm run sim -- --lane native
npm run sim -- --lane live
npm run sim -- --lane native --keep
```

- **lab** provides 22 selectable scenarios with complete task/session/workspace data and a stateful backend built from the production BoardController, Dispatcher and CompletionCoordinator. It scripts only DSH execution and transport faults; no external model or installed DSH is required. Focus one case with `--scenario offline`; repeat with `--repeat 2`. Each case needs behavioral assertions.
- **native** uses the actual installed DSH Host, native browser UI, Gateway, Session Controller, Agent loop, tools and storage. Only the model adapter is deterministic; no external model is called.
- **live** copies the configured credential file into the private disposable home, uses the real default provider/model, asks it to write and read an exact file inside the disposable workspace, and removes the copied credential on cleanup. Credentials never enter the package or result report. Set `PERSEVERE_DSH_CREDENTIALS` for another credential file.
- `--keep` retains the **test instance** after the browser checks for visible inspection; Ctrl-C cleans up only that run's processes.

`PERSEVERE_DSH_COMMAND` accepts an explicit JSON command array on machines without the macOS desktop installation. `PERSEVERE_DSH_BROWSER=msedge` selects an existing Edge installation. Results live under `.build/sim/<run-id>/summary.json`; failed runs retain the failing page and logs. A model-free native or Lab run is never reported as live inference. The [Hermex comparison](docs/hermex-parity.md) records the reference commit, audit findings and supported-surface boundary.

## Structure and contracts

Read [architecture](docs/architecture.md), [wire and lifecycle contracts](docs/contracts.md), [compatibility](docs/compatibility.md), and [development](docs/development.md). `npm run codegen` uses the published Typert generator; production TypeScript checks against the real DSH declarations. CI runs independent contracts, the full browser Lab and package verification; local native/live simulations provide runtime acceptance.

One installation belongs to one DSH Host. Install it on a remote DSH Host and use that Host's existing trusted Web/SSH transport to view its work. This version does not aggregate different Hosts, broker SSH credentials, implement cron scheduling or automatically merge/deploy agent changes.

MIT.

Part of Persevere with DSH
