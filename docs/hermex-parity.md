# Hermex comparison and acceptance boundary

`perse` = persevere. Part of Persevere with DSH.

Reference inspected on 2026-10-18: Deslord319/hermex `codex/mac-catalyst` at `facb55afabcd143cbca5094b0854186eed10fc3f`. The user's existing checkout at 66563f4 was preserved; references were read from fetched Git objects.

## Audit of dashboard 1.0.0

The resource-owning runner and real-host/live-model journeys were useful, but they were **not equivalent** to the reference's scenario coverage. Fifteen assertions along one main journey do not establish a full application lab. There was no analysis phase, no persistent opt-in intake watcher, no configurable completion policy, and every completion required an owner action. Atomic claiming and bounded execution did exist.

## Reference mechanisms

- `scripts/test-sim`: assigned resources, inherited locks, bounded phases, failure bundles, repeat/focused selection and cleanup.
- `KanbanLabView.swift:2551`: 14 selectable scenarios: first load, dense, empty, filtered empty, partial capability, authentication, network, server unavailable, incompatible contract, delayed live updates, offline snapshot, empty detail, detail error and truncated log.
- `KanbanLabClient`: mutable cards/boards, idempotent create, edits, comments, filtering, dispatch and partial failures. This is stateful fixture data, not a screenshot gallery.
- `ScriptedSSEStreamFixture`: explicitly stepped disconnect/reconnect/replay; stops drop stale events.
- captured Hermes fixtures: version/commit manifest and real protocol decode checks.
- triage roles and express/staged routing: ready-for-agent is eligible for autonomous implementation; needs-manual-validation retains a manual gate. These documents do not claim that all changes auto-merge or that the reference has proven every possible path.

## Dashboard equivalent

Keep three independently named layers: domain/policy tests; a stateful lab using the production task controller with complete synthetic data and fault/replay controls; packed-plugin native DSH journeys (plus a real-model lane). The lab must cover every supported owner command, agent phase and reverse action. Model-free fixture results never count as live inference.

A checked-in scenario manifest and coverage report are the acceptance inventory. A scenario needs behavioral assertions, not just a screenshot. Include loading, empty/filter-empty, dense all-state data, unavailable/auth/network/contract/partial/stream failures, detail extremes, stale writes, concurrent claims, analysis decisions, manual/verified/reviewed completion, failed checks, reopen, restart and workspace isolation. Unsupported Hermex-specific surfaces (iOS extensions, cron, multi-server credentials) are explicitly outside this plugin's surface.

Scope: dashboard issues only; GitHub issue synchronization is excluded by the user's 2026-10-18 clarification.

## Implemented acceptance map (1.4.1)

Approval coverage was missing before 1.3: the Lab used the wrong pending kind (`permission` instead of `approval`) and no assertion checked the dashboard warning. The attention and permission-settings scenarios now cover this explicitly, and the native lane holds/rejects a real DSH approval request.

| Reference capability             | Dashboard equivalent                                                                                                                          | Evidence                                                                                                                            |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Full mutable backend data        | Two Workspaces, six baseline Sessions, every task status, assignments, criteria, evidence, archives, versioned writes                         | dense + empty + automation browser cases                                                                                            |
| Fourteen selectable UI states    | first-load through detail-long in the fixture inventory                                                                                       | Each has behavior assertions and a screenshot; detail truncation maps to long evidence because this plugin does not own worker logs |
| Explicit stream scripts          | First-load release, disconnect/reconnect, Last-Event-ID replay, ordered committed frames                                                      | Lab browser + lab-stream.test.mjs                                                                                                   |
| Deterministic execution control  | Hold/release analysis, execution or review; pause while an issue is active                                                                    | automation scenario; active issue finishes, later issue stays queued                                                                |
| Real protocol fixtures           | Actual DSH Gateway snapshot, pinned runtime version, capture provenance and SHA256                                                            | fixtures/manifest.json + fixtures.test.mjs                                                                                          |
| Isolated real backend + fake LLM | Tarball-installed DSH native lane; only model adapter is deterministic                                                                        | Native artifact-binding receipt + actual Session/tool ledger                                                                        |
| Real model journey               | Native triage, actual shell result, distinct reviewer Session and exact file gate                                                             | Live lane + retained native screenshots                                                                                             |
| Managed simulator runner         | Assigned temporary state, inherited checkout lock, bounded phases, exact owned process-group cleanup, focused/repeated cases, failure bundles | scripts/sim + process ownership tests                                                                                               |
| Express/staged task management   | Analysis routing, manual flag, opt-in watcher, activation budget, three completion modes                                                      | analysis-decisions / automation / execution-failure / verification-failure / recovery                                               |
| Native attention awareness       | Pending approval/question/plan review surfaced with workspace scoping without rewriting task lifecycle                                       | attention scenario + native pending-approval hold/reject check                                                                      |
| DSH default permissions          | Official catalog and Settings Remote, explicit confirmation, revision conflict, read-only/unavailable failure                                  | permission-settings scenario + native read-only Settings check                                                                      |
| Workflow recovery                | One bounded report reminder, task-local failure isolation, explicit owner retry and visible completion gates                                  | workflow-recovery scenario + native reasoning-only/recovery check                                                                   |
| Rich review evidence             | Structured execution/review sections, per-criterion results and bounded workspace image preview                                              | workflow-recovery scenario + native image readback check                                                                            |
| Image task input                 | Create/edit paste, durable references, owner-only preview Remote, ordered image parts in analysis/execution/review with a route capability guard | input-images scenario + native image-input trace with fixture SHA-256 assertions                                                     |

All 24 cases run with behavioral assertions in the full Lab gate and support `--repeat 2` without external inference. This establishes comparable test mechanisms and supported dashboard workflow coverage, not Hermex feature parity or proof of every possible interleaving. iOS targets, multi-server account management, cron, worker-log transport and GitHub Issue synchronization are outside this plugin's surface. Independent model review is fallible; exact file checks verify approved artifacts at the time of completion.

## 1.4.1 evidence (2026-10-19)

| Lane   | Run                  | Result                                                                                                                     |
| ------ | -------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Lab    | `20261019-185223-f81c3d` | 23 scenarios × 2 repeats, 28 assertions per repeat, cleanup passed, synthetic model only                               |
| Native | `20261019-190014-3da978` | 22 assertions passed against the packed tarball, real DSH 0.2.1-rc.2 Host/Sessions/tools, deterministic model, cleanup passed |
| Live   | `20261019-190044-43170a` | 17 assertions passed with real `deepseek-official/deepseek-flash`; exact artifact SHA256 `63fb4e53…`, cleanup passed    |

Source commit `118269a` was clean for all three runs; package SHA256 `7d43a4ba…` and installed-artifact binding `e148a0a9…` are identical in the native and live receipts. `npm test` passed 37 domain/contract tests, the process-ownership suite passed 6 tests, and `npm run check` passed inside both packed lanes. Browser journeys used the host Chrome 155 channel because Playwright-managed Chromium was absent on this machine; every scenario has behavioral assertions, not screenshot-only checks. Full receipts are in [acceptance.json](../evidence/acceptance.json) and each run's `summary.json` / `coverage.json` under `.build/sim/<run-id>/`.

## 1.5.0 evidence (2026-10-20)

| Lane   | Run                  | Result                                                                                                                     |
| ------ | -------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Lab    | `20261020-152241-770bde` | 24 scenarios, behavioral assertions passed including the new `input-images` case, synthetic backend only, cleanup passed |
| Native | `20261020-152013-de7588` | 39 assertions passed against the packed tarball, real DSH 0.2.1-rc.2 Host/Sessions/tools, deterministic image-capable model |
| Live   | `20261020-152030-c60a9c` | 26 assertions passed with real `deepseek-official/deepseek-flash`; the pasted fixture was perceived and `live-image.txt` contained exactly `RED` |

For the native image journey, the pasted PNG/JPEG/WebP fixtures produced three image blocks in each analysis, execution and review request; the adapter recorded their resolved attachment SHA-256 values and the browser matched them to the checked-in fixtures. The analysis repair reminder carried zero image blocks. A task assigned to the declared text-only `sim-text` route was blocked with the image-capability message instead of prompting. `npm test` passed 48 domain/contract tests, the process-ownership suite passed 6 tests, and `npm run check` passed inside both packed lanes. Package SHA256 `cedd17b8…` and installed-artifact binding `afe436d9…` agree across the native and live receipts; screenshots and the filtered model trace are retained under `evidence/`.

A disposable copy of the owner desktop profile installed the same packed tarball (`DSH_HOME=<disposable> dsh plugin --profile desktop add …`), booted the same 0.2.1-rc.2 build on an isolated loopback port and served the installed client bundle. The real desktop profile was **not** modified: updating it and reloading the live app still requires explicit owner approval and a recheck of the image workflow there. See [install-check](../evidence/acceptance.json) and `.build/install-check/summary.json` for the disposable receipt.
