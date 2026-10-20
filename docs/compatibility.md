# Compatibility and design references

`perse` = persevere. Part of Persevere with DSH.

Target: DeepSeek Harness **0.2.1-rc.2**, Cordis **4.0.5**, Node **24**. The tested local runtime comes from the installed DeepSeek Harness desktop application; no files in that application are modified. Preview APIs may change; the package pins the tested generation and the sim must run before a compatibility bump.

## Runtime generation and Session logs

The package pins exact DSH `0.2.1-rc.2` peers. A DSH `0.2.0-rc.2` Host skips the bundle as incompatible and prints `dsh: skipping profile bundle "perse-dashboard": ... incompatible with dsh 0.2.0-rc.2 ...`; the sidebar then has no Dashboard. That older Host also refuses Session logs written by `0.2.1-rc.2` because they contain `job/registered` or `job/settled`:

```text
历史加载失败: failed to observe session "...": ... contains event type
"job/registered" (seq 22) unknown to this harness and not marked ignorable;
refusing to interpret the log — it was likely written by a newer harness
```

This is the Host's Session-format boundary, not log corruption and not a plugin failure. Do not edit, downgrade or replay-skip the logs. Launch the `0.2.1-rc.2` runtime that wrote them; the same profile and installed tarball then load the Dashboard and resume the Session normally.

The official design is the authority:

- https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/web-client.md
- https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/slots.md
- https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/api-gateway.md
- https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/storage/storage-domain
- https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/core/agent

## Task input images

Task input images use the DSH attachment capability (`ctx.attachments`) when the Host composition mounts it. That capability is optional at runtime: without it the dashboard still loads text-only tasks, reports `capabilities.imageInput: false`, and refuses image drafts with a visible error. Image admission, normalization, stored dimensions and retention are owned by DSH; the plugin stores only opaque attachment references and never copies bytes into the Storage Domain. DSH keeps stored attachments indefinitely and offers no deletion API, so removing an image from a task removes the reference, not the durable object.

The plugin asks the selected Session route whether it declares the `image` input modality. A route that explicitly declares text-only, or whose capability cannot be established, blocks that image-bearing task with a visible message; it does not rely on the LLM layer's text placeholder projection. Image-capable routes include the shipped DeepSeek flash route and real-model verification must use one. Tarballs are installed per profile; older plugin builds ignore the additive `inputImages` field, so an older plugin cannot display or send the images even though the newer Host stored their references. Back up the profile before downgrading.

Borrowed ideas, with original implementation here:

- [dashi-taskboard](https://github.com/chuspeeism/dashi-taskboard): issue assignment, Kanban workflow, session handoff and explicit user acceptance.
- codex-gateway: runtime remains authoritative; views render protocol state.
- codex-dash: distinguish stale/unknown observations from live Agent status.
- AgentPulse: opt-in queue execution and explicit Host ownership.
- Hermex (Deslord319/hermex: v1 inspected 66563f43a1d58f69457f4f737a8915796815bcda; v2 audited fork ref facb55afabcd143cbca5094b0854186eed10fc3f): assigned simulator resources, locks, bounded test phases, process-group cleanup and retained result evidence.

Typert generation uses the published generator. Its package discovery expects a `packages/` tree, and its marker recognition expects workspace declarations. `scripts/gen-typert.mjs` creates a physical ignored mini-workspace, and uses `scripts/typert-markers.d.ts` copied from the official MIT-licensed `remote-model` generator fixture solely during code generation. **Production typechecking uses the actual published protocol declarations.** Generated descriptors are never hand-authored. The fixture is not shipped or used at runtime.

This plugin does not adopt Dashi's CDP injector, introduce another Agent runtime, read private DSH databases, copy auth into a dashboard store, or expose a second production HTTP service. The development-only Lab has a synthetic loopback HTTP/SSE host and is excluded from the package. The Host Storage Domain name is `perse_dashboard` because the official domain grammar requires underscores; the package and plugin id are `perse-dashboard`.
