import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { validSnapshot } from '../lib/types/client/validation.js'
import { boardSchema } from '../lib/types/host/board.js'
test('version-pinned captured real DSH snapshot decodes and rejects malformed generations', async () => {
  const root = new URL('../sim/fixtures/', import.meta.url),
    manifest = JSON.parse(
      await readFile(new URL('manifest.json', root), 'utf8'),
    )
  assert.equal(manifest.runtimeVersion, '0.2.1-rc.2')
  assert.equal(manifest.syntheticModel, true)
  for (const file of manifest.files) {
    const bytes = await readFile(new URL(file.path, root))
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256)
    const captured = JSON.parse(bytes)
    assert.equal(validSnapshot(captured.snapshot), true)
    const parsed = boardSchema.parse({ ...captured.snapshot, receipts: [] })
    assert.equal(parsed.tasks.length, captured.snapshot.tasks.length)
    assert.ok(parsed.tasks.some((t) => t.completion?.kind === 'reviewed'))
    assert.equal(
      validSnapshot({
        ...captured.snapshot,
        tasks: [
          { ...captured.snapshot.tasks[0], analysis: { summary: 'broken' } },
        ],
      }),
      false,
    )
    assert.equal(
      validSnapshot({
        ...captured.snapshot,
        tasks: [{ ...captured.snapshot.tasks[0], status: 'future-state' }],
      }),
      false,
    )
  }
})
