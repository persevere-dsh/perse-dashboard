/** Prove that DSH loaded the tarball installation, never the checkout's self package. */
import { realpathSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
export const inject = ['clientModules', 'tools', 'approval']
export function apply(ctx) {
  ctx.tools.register(
    defineTool({
      name: 'sim_request_approval',
      description:
        'Isolated sim only: request a real DSH approval before writing the protected fixture.',
      parameters: {},
      async execute(_args, exec) {
        if (!exec.agent) throw Error('Agent required')
        const outcome = await ctx.approval.request({
          agent: exec.agent,
          toolName: 'sim_request_approval',
          reason:
            'Isolated dashboard simulation: a protected fixture write requires an explicit decision.',
        })
        if (outcome === 'allowed-once') {
          const runtime = JSON.parse(
            readFileSync(
              path.join(process.env.PERSEVERE_DSH_SIM_RUN, 'runtime.json'),
            ),
          )
          writeFileSync(
            path.join(runtime.workspace, 'sim-approval-granted.txt'),
            'ALLOWED',
          )
        }
        return JSON.stringify({ outcome })
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
    }),
  )
  let checked = false
  const poll = () => {
    if (checked) return
    const b = ctx.clientModules.artifactBaseline('perse-dashboard')
    if (!b) return
    const actual = realpathSync(b.path),
      expected = realpathSync(process.env.PERSEVERE_DSH_EXPECT_CLIENT)
    if (actual !== expected)
      throw Error(
        `Sim resolved the wrong client artifact: ${actual}; expected ${expected}`,
      )
    writeFileSync(
      path.join(process.env.PERSEVERE_DSH_SIM_RUN, 'artifact-binding.json'),
      JSON.stringify(
        {
          installedPackage: true,
          clientPath: actual,
          expectedPath: expected,
          sha256: createHash('sha256')
            .update(readFileSync(actual))
            .digest('hex'),
        },
        null,
        2,
      ),
    )
    checked = true
  }
  poll()
  const timer = setInterval(poll, 200)
  ctx.effect(() => () => clearInterval(timer))
}
