/** Published generator scans packages/ projects; stage this standalone package without symlinking its source. */
import {WorkspaceTypertGenerator} from '@deepseek-ai/dsh-typert-generator';
import {mkdir,writeFile,readFile,cp,symlink,rm} from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd(), stage=path.join(root,'.build/codegen'), pkgRoot=path.join(stage,'packages/perse-dashboard');
await rm(stage,{recursive:true,force:true});await mkdir(pkgRoot,{recursive:true});
for(const file of ['package.json','tsconfig.json','src'])await cp(path.join(root,file),path.join(pkgRoot,file),{recursive:true});
await symlink(path.join(root,'node_modules'),path.join(stage,'node_modules'),'dir');
await cp(path.join(root,'scripts/typert-markers.d.ts'),path.join(pkgRoot,'typert-markers.d.ts'));
const config=JSON.parse(await readFile(path.join(pkgRoot,'tsconfig.json'),'utf8'));config.compilerOptions.paths={'@deepseek-ai/dsh-typert-protocol':['./typert-markers.d.ts']};config.include.push('typert-markers.d.ts');await writeFile(path.join(pkgRoot,'tsconfig.json'),JSON.stringify(config));
await writeFile(path.join(stage,'tsconfig.host.json'),JSON.stringify({files:[],references:[{path:'./packages/perse-dashboard'}]}));
const generator=new WorkspaceTypertGenerator(stage,{checkDiagnostics:false});
const discovered=generator.discover(['host']);if(!discovered.some(e=>e.package==='perse-dashboard'))throw new Error('Host face not discovered');
const artifacts=generator.generate(['perse-dashboard'],['host']);if(artifacts.length!==1)throw new Error('Expected one generated Host artifact');
for(const artifact of artifacts){
 const dest=path.join(root,'lib');await mkdir(dest,{recursive:true});
 for(const [name,data] of [[`typert.${artifact.face}.js`,artifact.js],[`typert.${artifact.face}.d.ts`,artifact.dts],['typert.remote-client.js',artifact.remote?.js],['typert.remote-client.d.ts',artifact.remote?.dts],['typert.remote-client.d.ts.map',artifact.remote?.dtsMap]]){if(data===undefined)throw new Error(`Missing ${name}`);await writeFile(path.join(dest,name),data)}
}
