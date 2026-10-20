import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(
  new URL('../src/client/style.ts', import.meta.url),
  'utf8',
)
const bundle = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
const surfaces = [
  ['source', source],
  ['built client bundle', bundle],
]
const accent =
  '--pd-accent:var(--dsw-alias-state-business-primary,#4176e6)'
const onAccent =
  '--pd-on-accent:var(--dsw-alias-label-primary-foreground,#fff)'
const legacyOrange = ['#f0b03a', '#211704']

test('primary accent uses the DSH business-blue token in source and build', () => {
  for (const [surface, css] of surfaces) {
    assert.ok(css.includes(accent), `${surface} must map the accent to business-blue`)
    assert.ok(
      css.includes(onAccent),
      `${surface} must use the theme-aware foreground token`,
    )
    for (const orange of legacyOrange)
      assert.ok(
        !css.toLowerCase().includes(orange),
        `${surface} must not contain the retired orange literal ${orange}`,
      )
  }
})

test('success and danger semantic colors are unchanged', () => {
  for (const [surface, css] of surfaces) {
    assert.ok(
      css.includes('--pd-success:#28ad79'),
      `${surface} must keep the success green`,
    )
    assert.ok(
      css.includes('--pd-danger:#df5c67'),
      `${surface} must keep the danger red`,
    )
  }
})

test('warm needs-info/in-review colors remain semantic stage colors', () => {
  for (const [surface, css] of surfaces) {
    assert.ok(
      css.includes('.pd-column[data-status=needs-info]{--stage:#e1a44c}'),
      `${surface} must keep the needs-info stage color`,
    )
    assert.ok(
      css.includes('.pd-column[data-status=in-review]{--stage:#c5a052}'),
      `${surface} must keep the in-review stage color`,
    )
  }
  assert.match(
    source,
    /Stage dots are semantic state colors:[\s\S]*not the primary accent/,
    'source must document that the warm stage colors are semantic, not brand accent',
  )
})
