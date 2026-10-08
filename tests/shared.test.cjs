const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../extension/shared.js'), 'utf8');
function load(extra = {}) {const c = vm.createContext({URL, ...extra}); vm.runInContext(source, c); return c.YTOfflineRemove;}
const api = load();
test('accepts only www.youtube.com watch URLs with exact 11-character ids', () => {
  assert.equal(api.videoId('https://www.youtube.com/watch?v=AbCdEf_1234&list=downloads'), 'AbCdEf_1234');
  for (const url of ['https://evil.example/watch?v=AbCdEf_1234', 'http://www.youtube.com/watch?v=AbCdEf_1234', 'https://www.youtube.com/shorts/AbCdEf_1234', '/watch?v=bad', 'garbage']) assert.equal(api.videoId(url), null);
});
test('normalizes spacing and Unicode without fuzzy matching', () => {
  assert.equal(api.normalize('  REMOVE \n from  Downloads '), 'remove from downloads');
  assert.notEqual(api.normalize('Remove from playlist'), api.normalize('Remove from downloads'));
});
test('defaults are validated and arrays capped/deduplicated', () => {
  const settings = api.sanitizeSettings({panelTitles:[' Downloads ','Downloads',null,''],removeLabels:Array(30).fill('Remove from downloads')});
  assert.equal(settings.panelTitles.length,1); assert.equal(settings.removeLabels.length,1);
  assert.equal(api.sanitizeSettings({panelTitles:[],removeLabels:null}).panelTitles[0],'Downloads');
  assert.equal(api.sanitizeSettings({panelTitles:Array.from({length:20},(_,i)=>'Title '+i)}).panelTitles.length,12);
});
test('storage degrades safely without an extension API', async () => {
  assert.equal(JSON.stringify(await api.storage('get','key')), '{}');
});
test('generic destructive labels cannot enter settings through sync storage', () => {
  const settings=api.sanitizeSettings({removeLabels:['Delete','REMOVE','Remove from downloads']});
  assert.equal(settings.removeLabels.length,1);
  assert.equal(settings.removeLabels[0],'Remove from downloads');
});
test('Chromium callback storage bridge reads/writes', async () => {
  const values = {};
  const chrome = {runtime:{},storage:{sync:{get:(key,cb)=>cb(values),set:(payload,cb)=>{Object.assign(values,payload);cb();}}}};
  const api = load({chrome}); await api.storage('set',{key:123}); assert.equal((await api.storage('get','key')).key,123);
});
test('Firefox Promise storage bridge reads/writes', async () => {
  const values = {};
  const browser = {storage:{sync:{get:async()=>values,set:async p=>Object.assign(values,p)}}};
  const api = load({browser}); await api.storage('set',{key:456}); assert.equal((await api.storage('get','key')).key,456);
});
test('Chromium storage errors propagate', async () => {
  const chrome = {runtime:{lastError:{message:'Denied'}},storage:{sync:{get:(_key,cb)=>cb({})}}};
  await assert.rejects(load({chrome}).storage('get','key'),/Denied/);
});
test('manifests use only storage and narrowly scoped content scripts', () => {
  for (const name of ['chromium','firefox']) {
    const m = JSON.parse(fs.readFileSync(path.join(__dirname,'../manifests/'+name+'.json'),'utf8'));
    assert.deepEqual(m.permissions,['storage']); assert.equal(m.manifest_version,3);
    assert.deepEqual(m.content_scripts[0].matches,['https://www.youtube.com/*']);
    assert.equal(m.background,undefined); assert.equal(m.host_permissions,undefined);
  }
});