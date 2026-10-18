import {defineConfig} from 'tsdown'
const peers=[/^@deepseek-ai\//,'zod'];
export default defineConfig([
 {entry:{index:'lib/types/index.js'},outDir:'lib',format:'esm',platform:'node',target:'node24',dts:false,clean:false,fixedExtension:false,deps:{neverBundle:peers}},
 {entry:{client:'lib/types/client/index.js'},outDir:'lib',format:'cjs',outExtensions:()=>({js:'.js'}),platform:'browser',target:'es2022',dts:false,clean:false,fixedExtension:false,deps:{neverBundle:['react','react/jsx-runtime','@deepseek-ai/dsh-client-store'],alwaysBundle:['zod','perse-dashboard/remote',/^@deepseek-ai\/dsh-typert-protocol\//]},outputOptions:{banner:'window.__ModuleLoader__.load({id:"perse-dashboard",factory:(require)=>{var module={exports:{}};var exports=module.exports;',footer:'return module.exports;}});'}}
])
