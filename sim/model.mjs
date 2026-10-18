/** Deterministic model adapter; only used by the native sim lane. Real DSH tools execute every call. */
import { appendFile } from 'node:fs/promises'
import path from 'node:path'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
export const inject = ['llm']
class SimulationAdapter extends LlmAdapter {
  async listModels() {
    return [
      {
        provider: 'dashboard-sim',
        id: 'sim',
        name: 'Deterministic simulation',
        context: { maxTokens: 64000 },
      },
    ]
  }
  async *stream(options) {
    options.signal?.throwIfAborted()
    const messages = options.messages
    const lastUser = messages.findLastIndex(
      (m) =>
        m.role === 'user' &&
        (m.content ?? []).some(
          (b) =>
            b.type === 'text' &&
            /^(Analyze dashboard issue|Review dashboard task|Work on dashboard task|Use dashboard_claim_next)/.test(
              b.text,
            ),
        ),
    )
    const tail = messages.slice(lastUser + 1)
    const toolResults = tail.filter((m) => m.role === 'tool')
    const user = (messages[lastUser]?.content ?? [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
    await appendFile(
      path.join(process.env.DSH_HOME, 'sim-model-trace.jsonl'),
      JSON.stringify({
        roles: messages.map((m) => m.role),
        user,
        toolResults,
      }) + '\n',
    )
    const call = (name, args) => ({
      type: 'tool-call',
      id: crypto.randomUUID(),
      name,
      arguments: JSON.stringify(args),
    })
    let block
    const data = user.includes('TASK_DATA=')
      ? JSON.parse(user.split('TASK_DATA=')[1].split('\n')[0])
      : null
    const quote = (value) =>
      "'" + String(value).replaceAll("'", "'\"'\"'") + "'"
    if (
      user.startsWith('Analyze dashboard issue') &&
      data &&
      !toolResults.length
    ) {
      block = call('dashboard_triage', {
        taskId: data.taskId,
        expectedVersion: data.version,
        criteria: data.criteria.length
          ? data.criteria
          : ['Native workspace artifact is verified'],
        analysis: {
          summary: 'Deterministic analysis through the actual DSH tool',
          plan: [
            'Produce isolated artifact',
            'Read back result',
            'Report evidence',
          ],
          risk: 'low',
          route: 'express',
          questions: [],
        },
      })
    } else if (user.startsWith('Review dashboard task') && data) {
      if (!toolResults.length)
        block = call('bash', {
          command: data.completionPolicy.checks.length
            ? data.completionPolicy.checks
                .map((c) => 'cat -- ' + quote(c.path))
                .join(' && ')
            : 'cat sim-shell.txt',
          description:
            'Independently read the actual native workspace artifact',
        })
      else if (toolResults.length === 1)
        block = call('dashboard_review', {
          taskId: data.taskId,
          expectedVersion: data.version,
          review: {
            verdict: 'pass',
            risk: 'low',
            results: data.criteria.map((c, criterion) => ({
              criterion,
              passed: true,
              evidence:
                'Actual native shell readback: ' +
                JSON.stringify(toolResults[0].content),
            })),
            remainingRisks: [],
            evidence:
              'Independent native DSH Session read the workspace artifact using its actual bash tool.',
          },
        })
    } else if (user.includes('already claimed')) {
      const id = user.match(/task ([a-f0-9-]+), version (\d+)/)
      if (!toolResults.length && id)
        block = call('bash', {
          command:
            'printf DSH_SIM_SHELL_OK > sim-shell.txt' +
            (data?.completionPolicy.checks ?? [])
              .filter((c) => c.kind === 'text-equals')
              .map(
                (c) =>
                  ' && printf %s ' + quote(c.expected) + ' > ' + quote(c.path),
              )
              .join(''),
          description: 'Verify a native DSH workspace tool',
        })
      else if (toolResults.length === 1 && id)
        block = call('dashboard_report', {
          taskId: id[1],
          expectedVersion: Number(id[2]),
          evidence:
            'SIM: real DSH tool execution verified; deterministic model, no external inference.',
        })
    } else if (user.includes('dashboard_claim_next')) {
      const id = user.match(/taskId "([^"]+)"/)
      if (!toolResults.length)
        block = call('dashboard_claim_next', id ? { taskId: id[1] } : {})
      else if (toolResults.length === 1) {
        const text = toolResults[0].content.find((b) => b.type === 'text')?.text
        const task = JSON.parse(text)
        block = call('dashboard_report', {
          taskId: task.id,
          expectedVersion: task.version,
          evidence:
            'SIM: task claimed and reported through official DSH Agent tools.',
        })
      }
    }
    if (!block)
      block = {
        type: 'text',
        text: 'SIM_NATIVE_OK: verified the native dashboard task workflow.',
      }
    yield { type: 'block-start', index: 0, blockType: block.type }
    yield { type: 'block-end', index: 0, block }
    yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 10 } }
    yield {
      type: 'finish',
      reason: { kind: block.type === 'tool-call' ? 'tool-calls' : 'stop' },
    }
  }
}
export function apply(ctx) {
  ctx.effect(
    () => ctx.llm.registerAdapter(['dashboard-sim'], new SimulationAdapter()),
    'dashboard sim adapter',
  )
}
