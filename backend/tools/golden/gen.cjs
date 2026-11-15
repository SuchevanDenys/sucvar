const path=require('path'), fs=require('fs');
const OUT=process.argv[2], DEST=process.argv[3];
const R=(p)=>require(path.join(OUT,p));
const cat=R('app/data/catalog.js'), proc=R('app/lib/procurement.js'), val=R('app/lib/studio/validation.js');
const est=R('app/lib/server/estimates.js'), route=R('app/api/generate/route.js'), cfg=R('app/lib/ai/config.js');
fs.mkdirSync(DEST,{recursive:true});
// 1. catalog data
fs.writeFileSync(path.join(DEST,'catalog.json'), JSON.stringify({spaceModes:cat.SPACE_MODES, styles:cat.VISUAL_STYLES, scopes:cat.SCOPES}, null, 1));
// 2. golden cases
let seed=12345; const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff; return seed/0x7fffffff;};
const pick=(a)=>a[Math.floor(rnd()*a.length)];
const modes=Object.keys(cat.SPACE_MODES), styles=cat.VISUAL_STYLES.map(s=>s.id);
const cases=[];
for (const mode of modes) for (const space of cat.SPACE_MODES[mode].spaces) for (let k=0;k<6;k++){
  const raw={ width: +(rnd()*12+ (k===0?-2:0.5)).toFixed(2), length: k===1?'abc':+(rnd()*15+1).toFixed(2), height: +(rnd()*8).toFixed(2),
    doorsCount: Math.floor(rnd()*4), windowsCount: k===2?null:Math.floor(rnd()*7), aiStrength: Math.floor(rnd()*80+30),
    layoutPreset: pick([...space.layouts.map(l=>l.id),'bogus']), budget: pick(['economy','standard','luxury','x']),
    scope: pick(['refresh','renovation','shell','zzz']), focusIds: space.scenarios.filter(()=>rnd()<0.6).map(s=>s.id).concat(k===3?['nope']:[]) };
  const styleId=pick(styles.concat(['unknown']));
  const dims=val.sanitizeDimensions(raw, mode, space.id);
  const eng=cat.calculateEngineering(dims, mode, space.id);
  const bom=proc.buildBom({mode, spaceType:space.id, styleId:cat.getStyle(styleId).id, dimensions:dims});
  // generate-route prompt (steps 2–4 of POST /api/generate)
  const ai={ extraPrompt: k===4?'  warm cozy vibe, plants  ':undefined, negativePrompt: k===5?'ugly, blurry, Blurry':undefined };
  const sp=cat.getSpace(mode, space.id), layout=cat.getLayout(sp, raw.layoutPreset), style=cat.getStyle(styleId);
  const scenarioPrompt=cat.buildScenarioPrompt(sp, cat.sanitizeFocusIds(sp, raw.focusIds));
  const scopePrompt=cat.getScope(raw.scope).prompt;
  const budget=['economy','standard','luxury'].includes(raw.budget)?raw.budget:'standard';
  const windows=route.__readNumber(raw.windowsCount,0,50,2);
  const extra=typeof ai.extraPrompt==='string'?ai.extraPrompt.trim().slice(0,cfg.AI_LIMITS.extraPromptMaxLength):'';
  const userNeg=typeof ai.negativePrompt==='string'?ai.negativePrompt.trim().slice(0,cfg.AI_LIMITS.negativePromptMaxLength):cfg.DEFAULT_AI_SETTINGS.negativePrompt;
  const prompt=route.__buildPrompt([sp.scenePrompt, scenarioPrompt, scopePrompt, route.__getStyleSpecPrompt(style,mode), route.__cleanStylePrompt(style.prompt,mode), extra, layout.prompt, route.__budget(budget,mode), route.__light(mode,windows), 'architectural magazine photo, straight vertical lines, photorealistic, sharp focus'],72);
  const negative=route.__merge(userNeg, route.__neg(mode));
  cases.push({mode, spaceType:space.id, styleId, raw, ai, dims, eng, bom, prompt, negative});
}
fs.writeFileSync(path.join(DEST,'golden-cases.json'), JSON.stringify(cases));
// 3. estimate payload parsing
const estCases=[
  {}, null, [], {projectId:'bad id!'}, {status:'weird'}, {lineItems:'x'},
  {projectId:'abc-123', status:'sent', docNo:'  DV-0001  ', client:{name:' ACME ', vatId:'RO1', notes:'n'.repeat(2100)}, region:'', finishLevel:'premium',
   areaM2:'45.678', crew:0, contingencyPct:150, marginPct:-3, vatPct:'abc', scope:{paint:'12', tile:-5, x:'y'}, rateOverride:{a:2e7},
   lineItems:[{id:'i1',cat:'finishes',ro:'Parchet',en:'Parquet',unit:'m²',qty:'12.5',price:'33.333'},{qty:3},'junk',null], subtotal:1234.567, total:-1},
  {lineItems: Array.from({length:501},()=>({}))},
];
fs.writeFileSync(path.join(DEST,'golden-estimates.json'), JSON.stringify(estCases.map(input=>({input, output: est.parseEstimatePayload(input)}))));
console.log('cases', cases.length);
