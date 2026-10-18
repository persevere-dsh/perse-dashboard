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

## Implemented acceptance map (1.2.0)

| Reference capability             | Dashboard equivalent                                                                                                                          | Evidence                                                                                                                            |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Full mutable backend data        | Two Workspaces, six baseline Sessions, every task status, assignments, criteria, evidence, archives, versioned writes                         | dense + empty + automation browser cases                                                                                            |
| Fourteen selectable UI states    | first-load through detail-long in the fixture inventory                                                                                       | Each has behavior assertions and a screenshot; detail truncation maps to long evidence because this plugin does not own worker logs |
| Explicit stream scripts          | First-load release, disconnect/reconnect, Last-Event-ID replay, ordered committed frames                                                      | Lab browser + lab-stream.test.mjs                                                                                                   |
| Deterministic execution control  | Hold/release analysis, execution or review; pause while an issue is active                                                                    | automation scenario; active issue finishes, later issue stays queued                                                                |
| Real protocol fixtures           | Actual DSH Gateway snapshot, pinned runtime version, capture provenance and SHA256                                                            | fixtures/manifest.json + fixtures.test.mjs                                                                                          |
| Isolated real backend + fake LLM | Tarball-installed DSH native lane; only model adapter is deterministic                                                                        | Native artifact-binding receipt + actual Session/tool ledger                                                                        |
| Real model journey               | Native triage, actual shell result, distinct reviewer Session and exact file gate                                                             | Live lane + in-app browser observation                                                                                              |
| Managed simulator runner         | Assigned temporary state, inherited checkout lock, bounded phases, exact owned process-group cleanup, focused/repeated cases, failure bundles | scripts/sim + process ownership tests                                                                                               |
| Express/staged task management   | Analysis routing, manual flag, opt-in watcher, activation budget, three completion modes                                                      | analysis-decisions / automation / execution-failure / verification-failure / recovery                                               |

All 20 cases run twice without external inference in the full Lab gate. This establishes comparable test mechanisms and supported dashboard workflow coverage, not Hermex feature parity or proof of every possible interleaving. iOS targets, multi-server account management, cron, worker-log transport and GitHub Issue synchronization are outside this plugin's surface. Independent model review is fallible; exact file checks verify approved artifacts at the time of completion.
