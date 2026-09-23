import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function mount({ supported = true } = {}) {
  const hooks = []; let index = 0; const effects = []; const cleanups = [];
  const heard = []; const instances = []; const timers = new Map(); let timerId = 0;
  const react = {
    useState(initial) { const i = index++; if (!(i in hooks)) hooks[i] = initial; return [hooks[i], v => { hooks[i] = typeof v === 'function' ? v(hooks[i]) : v; }]; },
    useRef(initial) { const i = index++; return hooks[i] ??= { current: initial }; },
    useEffect(fn, deps) { const i = index++; if (!hooks[i] || deps.some((d, n) => d !== hooks[i][n])) effects.push(fn); hooks[i] = deps; },
  };
  class Recognition {
    constructor() { instances.push(this); }
    start() { this.started = true; }
    stop() { this.stopped = true; this.onend?.(); }
    abort() { this.aborted = true; }
  }
  const jsx = (type, props) => ({ type, props });
  const moduleHolder = { exports: {} };
  const source = fs.readFileSync(new URL('../src/components/VoiceInput.tsx', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { module: moduleHolder, exports: moduleHolder.exports, require: n => n === 'react' ? react : { jsx, jsxs: jsx },
    window: { isSecureContext: true, SpeechRecognition: supported ? Recognition : undefined },
    setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id) });
  const render = (disabled = false) => {
    index = 0; const tree = moduleHolder.exports.VoiceInput({ onTranscript: t => heard.push(t), disabled });
    while (effects.length) { const cleanup = effects.shift()(); if (cleanup) cleanups.push(cleanup); }
    return tree.props.children;
  };
  return { render, heard, instances, timers, unmount: () => cleanups.forEach(fn => fn()) };
}

test('dictation previews interim text, adds each final result once, and stops cleanly', () => {
  const h = mount(); h.render()[0].props.onClick();
  const r = h.instances[0]; assert.ok(r.started);
  r.onresult({ resultIndex: 0, results: [{ isFinal: false, 0: { transcript: 'New listing' } }] });
  assert.deepEqual(h.heard, []);
  const final = { resultIndex: 0, results: [{ isFinal: true, 0: { transcript: 'New listing in Nashville.' } }] };
  r.onresult(final); r.onresult(final);
  assert.deepEqual(h.heard, ['New listing in Nashville.']);
  assert.equal(h.render()[0].props['aria-pressed'], true);
  h.render()[0].props.onClick();
  assert.equal(h.render()[0].props['aria-pressed'], false); assert.equal(h.timers.size, 0);
});
test('permission denial gives a retry message without adding text', () => {
  const h = mount(); h.render()[0].props.onClick();
  h.instances[0].onerror({ error: 'not-allowed' }); h.instances[0].onend();
  assert.match(h.render()[1].props.children, /Allow microphone access/); assert.deepEqual(h.heard, []);
});
test('unsupported browser offers keyboard dictation, and never creates a recorder', () => {
  const h = mount({ supported: false }); h.render()[0].props.onClick();
  assert.match(h.render()[1].props.children, /keyboard/); assert.equal(h.instances.length, 0);
});
test('unmount aborts microphone and removes callbacks and recording timer', () => {
  const h = mount(); h.render()[0].props.onClick(); h.unmount();
  assert.ok(h.instances[0].aborted); assert.equal(h.instances[0].onresult, null); assert.equal(h.timers.size, 0);
});
test('starting a scan stops dictation; recording also has a time limit', () => {
  const h = mount(); h.render()[0].props.onClick(); h.render(true); assert.ok(h.instances[0].stopped);
  h.render(false)[0].props.onClick(); [...h.timers.values()][0](); assert.ok(h.instances[1].stopped);
});
