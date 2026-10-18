# Contracts v1

`perse` = persevere. Part of Persevere with DSH.

Task status: todo -> in-progress -> in-review -> done; blocked and return to todo are explicit actions. Agent completion only reports in-review with evidence; done requires explicit human confirmation and all criteria checked. Each task belongs to an existing DSH Workspace; Session linking verifies the Session belongs to that Workspace. Archives do not delete evidence. Native Agent status is displayed separately from task status.

Every mutation supplies requestId and expected task version. The Host serializes decisions, rejects stale versions and reused request ids with different payloads, commits task + ledger + dedup record in one Storage Domain global write, then publishes a full replacement snapshot. Responses are only returned after durability. Repeated identical requests return the original task result. A restart preserves request deduplication. No mutation auto-retries on the Client.

Remote namespace `perseDashboard`: snapshot, create, update, dispatch and watch. All owner-only by DSH default policy, additionally checked at the service boundary. Untrusted peers cannot enumerate task data. Agent tools run in their own Session context and can claim/report only a task in that Session's workspace; task acceptance is unavailable as an agent tool. Inputs and persisted data are validated. Evidence is plain text, never executable markup.

Tool claim links the actual Session id and moves the task to in-progress. Report requires nonempty evidence and moves to in-review. A stopped, cancelled or failed agent never completes a task. UI handoff creates an unsent draft, so opening a task cannot spend tokens or execute commands.

Client resource streams begin with a full snapshot. All task views consume the single ordered resource stream, rather than replacing local state from command responses; each snapshot includes its durable revision. Reconnect replaces the resource baseline. Unknown task links are visible as unavailable; missing lifecycle data remains unknown. No direct HTTP endpoint outside DSH Gateway is introduced.

A Session may hold only one active claim. An explicit claim for another task fails until that claim is reported or returned. Dispatcher transport failures block the active task and pause subsequent dispatches. Scope edits are allowed only while queued; mutations are rejected while the linked native Agent is running. Assigned tasks open their assigned conversation; an unsent new-session draft is available only for unassigned tasks.
