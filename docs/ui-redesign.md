# UI revision 1.2

The task/controller contracts remain authoritative and unchanged. This revision addresses the real Desktop journey: inline forms push the board away, a 340px detail column overflows, long analysis hides actions, the queue budget resets when returning from a Session, and cards show the assignment queue even after an actual claim.

## References

- [Dashi taskboard](https://github.com/chuspeeism/dashi-taskboard) `723c400e`: separate task editor/detail surfaces, property grouping, explicit dialog dismissal and task navigation.
- [sparkDash](https://github.com/MiaAI-Lab/sparkDash) `3e6d4ef6`: compact metric cards, subtle surface borders, 16px corners, restrained amber accents, semantic state dots and readable secondary labels. The user's existing LAN deployment was visually inspected.
- DSH 0.2.1-rc.2: native slots, generated Remote, official color tokens and framework Session state. No host DOM or private state changes.

## Components and navigation

- Bounded main canvas, metric cards, one workspace/filter toolbar, task board/list and Session table.
- An automation control card explicitly distinguishes current queue execution from watching new issues. Its budget follows the actual activation and cannot disable another workspace's queue.
- Task cards show actual claimed execution Session before assignment fallback, execution phase and criterion progress.
- New task and task detail are plugin-owned native HTML dialogs, modeled after Dashi's editor. Native top-layer modality supplies inert background and focus containment. Escape/backdrop/close share one dismissal path, restore invoking focus, and protect unsaved creation, property and evidence drafts with a nested confirmation. No new OS window is spawned.
- Detail tabs separate overview/criteria/evidence, analysis/review, completion rules/properties, and activity. Header and footer stay reachable; only the dialog body scrolls. No detail view changes the board width or its scroll position.
- Long evidence, identifiers and plan entries wrap inside bounded surfaces. Narrow dialogs fill the available viewport. Controls remain keyboard accessible; reduced motion is respected.

## Verification

Retain all existing Lab and native journeys. Add browser assertions for modal geometry at desktop/narrow sizes, Escape and backdrop, focus return/containment, unsaved draft confirmation, workspace isolation of selection, list view, actual Session identity, stale edits, and persistent budget. Lab is synthetic; native lane verifies the installed tarball through real DSH. The existing local task and completion receipt must survive the Desktop upgrade.
