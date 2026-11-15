// Transpiles the reference TS sources to CJS in OUT so we can execute them for golden data.
const path = require('path'), fs = require('fs');
const REF = process.argv[2], OUT = process.argv[3];
const ts = require(path.join(REF, 'node_modules/typescript'));
function walk(d){ return fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]); }
const files = [...walk(path.join(REF,'app/data')), ...walk(path.join(REF,'app/lib')), ...walk(path.join(REF,'app/types')), path.join(REF,'app/api/generate/route.ts')].filter(f=>/\.ts$/.test(f));
for (const f of files) {
  let src = fs.readFileSync(f,'utf8').replace(/^import 'server-only';.*$/m,'');
  const rel = path.relative(REF, f);
  if (rel === 'app/api/generate/route.ts') src += '\nexport { buildPrompt as __buildPrompt, getStyleSpecPrompt as __getStyleSpecPrompt, cleanStylePrompt as __cleanStylePrompt, getBudgetPromptDetails as __budget, getLightingPrompt as __light, mergeTerms as __merge, getMandatoryNegatives as __neg, estimateTokens as __est, readNumber as __readNumber };\n';
  let js = ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  const outFile = path.join(OUT, rel.replace(/\.ts$/,'.js'));
  js = js.replace(/require\("@\/(app\/[^"]+)"\)/g,(m,p)=>`require(${JSON.stringify(path.join(OUT,p))})`);
  fs.mkdirSync(path.dirname(outFile),{recursive:true}); fs.writeFileSync(outFile, js);
}
console.log('transpiled', files.length);
