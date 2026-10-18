# Compatibility and design references

`perse` = persevere. Part of Persevere with DSH.

Target: DeepSeek Harness **0.2.1-rc.2**, Cordis **4.0.5**, Node **24**. The tested local runtime comes from the installed DeepSeek Harness desktop application; no files in that application are modified. Preview APIs may change; the package pins the tested generation and the sim must run before a compatibility bump.

The official design is the authority:

- https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/web-client.md
- https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/slots.md
- https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/api-gateway.md
- https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/storage/storage-domain
- https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/core/agent

Borrowed ideas, with original implementation here:

- [dashi-taskboard](https://github.com/chuspeeism/dashi-taskboard): issue assignment, Kanban workflow, session handoff and explicit user acceptance.
- codex-gateway: runtime remains authoritative; views render protocol state.
- codex-dash: distinguish stale/unknown observations from live Agent status.
- AgentPulse: opt-in queue execution and explicit Host ownership.
- Hermex (Deslord319/hermex: v1 inspected 66563f43a1d58f69457f4f737a8915796815bcda; v2 audited fork ref facb55afabcd143cbca5094b0854186eed10fc3f): assigned simulator resources, locks, bounded test phases, process-group cleanup and retained result evidence.

Typert generation uses the published generator. Its package discovery expects a `packages/` tree, and its marker recognition expects workspace declarations. `scripts/gen-typert.mjs` creates a physical ignored mini-workspace, and uses `scripts/typert-markers.d.ts` copied from the official MIT-licensed `remote-model` generator fixture solely during code generation. **Production typechecking uses the actual published protocol declarations.** Generated descriptors are never hand-authored. The fixture is not shipped or used at runtime.

This plugin does not adopt Dashi's CDP injector, introduce another Agent runtime, read private DSH databases, copy auth into a dashboard store, or expose a second production HTTP service. The development-only Lab has a synthetic loopback HTTP/SSE host and is excluded from the package. The Host Storage Domain name is `perse_dashboard` because the official domain grammar requires underscores; the package and plugin id are `perse-dashboard`.
