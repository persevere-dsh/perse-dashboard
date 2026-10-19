# Agent development

`perse` = persevere. Part of Persevere with DSH.

1. Read AGENTS.md, architecture and contracts. Decide the authoritative owner of each change.
2. Change a narrow behavior; run `npm test` for domain changes and `npm run typecheck` for client changes.
3. Run `npm run check` before packing. Never edit generated artifacts; change source contracts and run codegen.
4. Run `npm run sim -- --lane lab --scenario all --repeat 2` for full fixture flows, then `npm run sim -- --lane native`. It exercises the actual packed artifact, independently installed into a disposable profile in the local DSH runtime.
5. Run `--lane live` when claiming model execution works. It verifies an exact file and an Agent evidence report, not just a completed API call.
6. Review screenshots (`dashboard.png`, `mobile.png`, `dark.png`), the linked conversation and `summary.json`. State exactly which lane passed.

## Install verification against the owner's runtime

The simulator always boots its local `/Applications` DSH build. That is evidence for exactly that build and no other app copy. Before claiming an installation works, also:

1. Record the executable path and `--version` of the DSH app the owner actually runs.
2. Copy the owner's Home and profile to a disposable location, boot that same app (or its CLI) on an isolated port, and open an existing Session written by that build. A cross-generation log must fail with the Host's unknown-event diagnostic; a matching build must resume.
3. Create a new Session in the isolated Host, complete one real model turn, reload the client, and open the Session again.
4. Confirm the Dashboard slot loads and the installed client artifact realpath and SHA256 match the acceptance binding.

Never point these checks at the real Home, and never describe a plugin as broken when an older Host cannot read newer Session logs. Report the exact Host version, app path and error instead.

The runner holds an advisory lock inherited by owned children. It bounds package install, boot and browser execution, and terminates only process groups whose leader PID it captured at spawn. Keyboard interruption and SIGTERM take the same cleanup path. It does not terminate the user's desktop app or any service discovered by process-name matching.

Failed runs retain artifacts. A failing contract, screenshot error, missing tool report, duplicate claim, stale write, package load failure or absent live result must fail the lane. Do not change assertions to make unexpected behavior pass. Deterministic model fixtures must adhere to the provider contract, including injected model-visible context messages, real tool result roles and title-generation calls.

A plain clone is self-contained. Test folders contain no personal paths, credentials, production transcripts or service tokens. `.build/`, package archives and generated artifacts are ignored. There is no dependency on sibling plugin repositories.

The simulator allocates its runtime home and workspace **outside the checkout**. A self-named Node package can otherwise resolve to the checkout rather than the installed tarball. A read-only simulation probe asserts the Host client artifact realpath equals the installed package realpath before browser acceptance. Local artifacts remain under `.build/sim`; `state` links to the retained external runtime state.

Fixture modules and the patch file also live in that external runtime root, under a separate private package. DSH discovers client halves through plugin source-package provenance; putting a simulation plugin inside the business package can accidentally advertise the checkout client bundle. `artifact-binding.json` is a required acceptance receipt, and a mismatch stops the run before browser/model execution. A source commit and dirty-state flag identify the tested tree.

## Scenario coverage and replay

Lab has a checked-in 23-case inventory. `--scenario <id>` focuses a case and `--repeat N` repeats a browser suite into distinct evidence folders. Browser assertions exercise the production UI against the stateful controller backend, not static screenshot variants. HTTP faults, explicit first-load release, disconnect/reconnect and recovery are controlled steps. Domain tests additionally exercise ordered SSE replay from Last-Event-ID, stale writes without committed frames, workspace isolation, concurrent claims, rule failures and persisted restart.

Native/live fixtures record the actual versioned DSH Gateway snapshot. Fixture refreshes must retain manifest version, capture origin and SHA256; review the data and run boundary/decode tests. Never capture credentials, authentication URLs, private conversations or production workspace files. Record synthetic vs real-model origin explicitly.
