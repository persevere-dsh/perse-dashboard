/** Prove that DSH loaded the tarball installation, never the checkout's self package. */
import { realpathSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
export const inject = ['clientModules']
export function apply(ctx) {
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
