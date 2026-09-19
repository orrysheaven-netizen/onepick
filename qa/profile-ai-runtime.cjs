// Read trusted checked-in production code only; never start Deno/Auth/DB.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
let ts;
try { ts = require('../mobile/node_modules/typescript'); } catch { ts = require('typescript'); }
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const clone = (value) => JSON.parse(JSON.stringify(value));
const fail = () => { throw new Error('QA_PRODUCTION_CONTRACT_CHANGED'); };

function loadProduction(root = path.resolve(__dirname, '..'), selectedTone = process.env.ONEPICK_QA_TONE ?? 'direct') {
  const dir = path.join(root, 'supabase/functions/analyze-profile-taste');
  let sources;
  try { sources = Object.fromEntries(['index.ts', 'quality.ts', 'contract.ts', 'tone.ts']
    .map((name) => [name, fs.readFileSync(path.join(dir, name), 'utf8')])); } catch { fail(); }
  const parse = (name) => {
    const file = ts.createSourceFile(name, sources[name], ts.ScriptTarget.ES2022, true);
    if (file.parseDiagnostics.length) fail();
    return file;
  };
  const code = (source) => ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  } }).outputText;
  const isolatedModule = (name) => {
    if (parse(name).statements.some(ts.isImportDeclaration)) fail();
    const scope = vm.createContext({ exports: {} }, { codeGeneration: { strings: false, wasm: false } });
    vm.runInContext(code(sources[name]), scope, { timeout: 1000 });
    return scope.exports;
  };
  const quality = isolatedModule('quality.ts');
  const contract = isolatedModule('contract.ts');
  const tones = isolatedModule('tone.ts');
  const tone = tones.requireTasteTone(selectedTone);
  const instructions = tones.tasteInstructions(quality.TASTE_INSTRUCTIONS, tone);
  const source = parse('index.ts');
  let model;
  const functions = [];
  for (const statement of source.statements) {
    if (ts.isVariableStatement(statement)) for (const entry of statement.declarationList.declarations) {
      if (entry.name.getText(source) === 'MODEL') {
        if (!entry.initializer || !ts.isStringLiteral(entry.initializer)) fail();
        model = entry.initializer.text;
      }
    }
    if (ts.isFunctionDeclaration(statement) && ['record', 'outputText', 'cleanResult'].includes(statement.name?.text)) functions.push(statement.getText(source));
  }
  const calls = [];
  const walk = (node) => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'fetch' &&
      ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === 'https://api.openai.com/v1/responses') calls.push(node);
    ts.forEachChild(node, walk);
  };
  walk(source);
  if (!model || functions.length !== 3 || calls.length !== 1) fail();
  const options = calls[0].arguments[1];
  if (!ts.isObjectLiteralExpression(options)) fail();
  const body = options.properties.find((p) => p.name?.getText(source) === 'body');
  if (!body || !ts.isPropertyAssignment(body) || !ts.isCallExpression(body.initializer) ||
    body.initializer.expression.getText(source) !== 'JSON.stringify' || !ts.isObjectLiteralExpression(body.initializer.arguments[0])) fail();
  const expression = body.initializer.arguments[0].getText(source);
  const scope = vm.createContext({ MODEL: model, toneInstructions: instructions },
    { codeGeneration: { strings: false, wasm: false } });
  vm.runInContext(code(functions.join('\n')), scope, { timeout: 1000 });
  const build = (picks) => {
    scope.tasteInput = quality.buildTasteInput(picks);
    const payload = clone(vm.runInContext(`(${expression})`, scope, { timeout: 1000 }));
    const keys = Object.keys(payload).sort().join(',');
    if (keys !== 'input,instructions,max_output_tokens,model,reasoning,store,text' || payload.store !== false ||
      payload.text?.format?.strict !== true || !Number.isSafeInteger(payload.max_output_tokens) ||
      payload.max_output_tokens < 1 || payload.max_output_tokens > 4096 || payload.instructions !== instructions || payload.model !== model) fail();
    return payload;
  };
  const validate = (envelope) => {
    scope.envelope = envelope;
    const text = vm.runInContext('outputText(envelope)', scope, { timeout: 1000 });
    if (!text) throw new Error(envelope?.status === 'incomplete' ? 'QA_INCOMPLETE' : 'QA_REFUSED_OR_EMPTY');
    let parsed;
    try { parsed = JSON.parse(text); } catch { throw new Error('QA_INVALID_JSON'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
      Object.keys(parsed).sort().join(',') !== 'body,keywords,summary' ||
      !Array.isArray(parsed.keywords) || parsed.keywords.some((x) => typeof x !== 'string')) throw new Error('QA_SCHEMA_FAILED');
    scope.parsed = parsed;
    let comment;
    try { comment = clone(vm.runInContext('cleanResult(parsed)', scope, { timeout: 1000 })); } catch { throw new Error('QA_SCHEMA_FAILED'); }
    quality.assertNoAgeComment(comment);
    return comment;
  };
  const sample = build([]);
  return { build, validate, model, tone,
    promptVersion: tones.tastePromptVersion(quality.TASTE_PROMPT_VERSION, tone),
    contractVersion: contract.PROFILE_AI_CONTRACT_VERSION, minimumPicks: contract.PROFILE_AI_MIN_PICKS,
    maxOutputTokens: sample.max_output_tokens,
    sourceHashes: Object.fromEntries(Object.entries(sources).map(([name, value]) => [name, sha256(value)])),
    promptHash: sha256(sample.instructions), schemaHash: sha256(JSON.stringify(sample.text)),
  };
}
module.exports = { loadProduction, sha256 };
