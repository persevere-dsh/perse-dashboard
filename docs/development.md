# Agent development

`perse` = persevere. Part of Persevere with DSH.

1. Read AGENTS.md, architecture and contracts. Decide the authoritative owner of each change.
2. Change a narrow behavior; run `npm test` for domain changes and `npm run typecheck` for client changes.
3. Run `npm run check` before packing. Never edit generated artifacts; change source contracts and run codegen.
4. Run `npm run sim -- --lane native`. It exercises the actual packed artifact, independently installed into a disposable profile in the local DSH runtime.
5. Run `--lane live` when claiming model execution works. It verifies an exact file and an Agent evidence report, not just a completed API call.
6. Review screenshots (`dashboard.png`, `mobile.png`, `dark.png`), the linked conversation and `summary.json`. State exactly which lane passed.

The runner holds an advisory lock inherited by owned children. It bounds package install, boot and browser execution, and terminates only process groups whose leader PID it captured at spawn. Keyboard interruption and SIGTERM take the same cleanup path. It does not terminate the user's desktop app or any service discovered by process-name matching.

Failed runs retain artifacts. A failing contract, screenshot error, missing tool report, duplicate claim, stale write, package load failure or absent live result must fail the lane. Do not change assertions to make unexpected behavior pass. Deterministic model fixtures must adhere to the provider contract, including injected model-visible context messages, real tool result roles and title-generation calls.

A plain clone is self-contained. Test folders contain no personal paths, credentials, production transcripts or service tokens. `.build/`, package archives and generated artifacts are ignored. There is no dependency on sibling plugin repositories.
