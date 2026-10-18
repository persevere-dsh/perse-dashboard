import {execFileSync} from 'node:child_process';
import {readFile,stat} from 'node:fs/promises';import assert from 'node:assert/strict';
const pkg=JSON.parse(await readFile('package.json','utf8'));
for(const file of ['lib/index.js','lib/client.js','lib/typert.host.js','lib/typert.remote-client.js'])assert.ok((await stat(file)).size>0,file);
const bundle=await readFile('lib/client.js','utf8');assert.ok(bundle.startsWith('window.__ModuleLoader__.load('));
assert.ok(!bundle.includes('node:fs'));assert.ok(!bundle.includes('setBypassCSP'));assert.equal(pkg.name,'perse-dashboard');
const remote=await import('../lib/typert.remote-client.js');assert.equal(remote.default.descriptors.length,5);
console.log('Package surface and generated Remote contract verified');

for(const file of ['sim/browser.mjs','sim/model.mjs','sim/diagnostics.mjs'])execFileSync(process.execPath,['--check',file]);
