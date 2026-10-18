import { execFileSync } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import assert from 'node:assert/strict'
const pkg = JSON.parse(await readFile('package.json', 'utf8'))
for (const file of [
  'lib/index.js',
  'lib/client.js',
  'lib/typert.host.js',
  'lib/typert.remote-client.js',
])
  assert.ok((await stat(file)).size > 0, file)
const bundle = await readFile('lib/client.js', 'utf8')
assert.ok(bundle.startsWith('window.__ModuleLoader__.load('))
assert.ok(!bundle.includes('node:fs'))
assert.ok(!bundle.includes('setBypassCSP'))
assert.equal(pkg.name, 'perse-dashboard')
const remote = await import('../lib/typert.remote-client.js')
assert.equal(remote.default.descriptors.length, 8)
assert.deepEqual(
  remote.default.descriptors.map((d) => d.name ?? d.method).sort(),
  ['analyze', 'create', 'dispatch', 'image', 'snapshot', 'update', 'verify', 'watch'],
)
console.log('Package surface and generated Remote contract verified')

for (const file of ['sim/browser.mjs', 'sim/model.mjs', 'sim/diagnostics.mjs'])
  execFileSync(process.execPath, ['--check', file])

const packed = JSON.parse(
  execFileSync('npm', ['pack', '--dry-run', '--json'], { encoding: 'utf8' }),
)[0]
assert.ok(
  packed.files.every((f) => !/^sim\/|^test\/|^\.build\//.test(f.path)),
  'Lab/test/runtime artifacts must never enter the production package',
)
assert.ok(
  packed.files.every((f) => !/ 2\./.test(f.path)),
  'Local duplicate source and document copies must not enter the package',
)
console.log(
  'Synthetic Lab and private runtime artifacts excluded from production tarball',
)
