import assert from 'node:assert/strict';
import { test } from 'node:test';
import { homeCollectionKey, parseHomeCollections, rankImage, orderHomeItems } from '../src/home-collection-settings.ts';

test('home collection preferences reject corrupt data, bound choices and preserve chosen order',()=>{
  assert.deepEqual(parseHomeCollections({version:2,rows:[]}),{version:1,rows:[]});
  const settings=parseHomeCollections({version:1,rows:[
    {id:'row',kind:'collections',title:' Collections ',collectionIds:['second','first','second',null],ranked:true},
    {id:'row',kind:'items',collectionIds:['hidden']},
    {id:'single',kind:'items',collectionIds:['a','b'],ranked:true},
  ]});
  assert.deepEqual(settings.rows,[{id:'row',kind:'collections',title:'Collections',collectionIds:['second','first'],ranked:false,placement:'end',itemSort:'collection',itemOrder:[]},{id:'single',kind:'items',title:'',collectionIds:['a'],ranked:true,placement:'end',itemSort:'collection',itemOrder:[]}]);
});
test('server and user storage scopes cannot overlap',()=>{
  assert.notEqual(homeCollectionKey('server-a','alice'),homeCollectionKey('server-a','bob'));
  assert.notEqual(homeCollectionKey('server-a','alice'),homeCollectionKey('server-b','alice'));
  assert.notEqual(homeCollectionKey('a:b','c'),homeCollectionKey('a','b:c'));
});
test('rank artwork contains vector outlines, including multiple digits, rather than caption text',()=>{
  const svg=decodeURIComponent(rankImage(10).split(',')[1]);
  assert.equal((svg.match(/<path /g)||[]).length,2);assert.match(svg,/viewBox="0 0 174 140"/);assert.doesNotMatch(svg,/<text/);
});

test('item sorting is stable, leaves source untouched and appends newly added items after custom choices',()=>{
  const items=[{Id:'b',Name:'Beta',ProductionYear:2023},{Id:'a',Name:'Alpha',ProductionYear:2025},{Id:'c',Name:'Gamma'},{Id:'d',Name:'Delta',ProductionYear:2025}];
  const ids=(sort: Parameters<typeof orderHomeItems>[1]['itemSort'], itemOrder:string[]=[])=>orderHomeItems(items,{itemSort:sort,itemOrder}).map(item=>item.Id);
  assert.deepEqual(ids('title'),['a','b','d','c']);
  assert.deepEqual(ids('newest'),['a','d','b','c']);
  assert.deepEqual(ids('oldest'),['b','a','d','c']);
  assert.deepEqual(ids('custom',['removed','d','b']),['d','b','a','c']);
  assert.deepEqual(items.map(item=>item.Id),['b','a','c','d']);
});
test('legacy row preferences gain defaults and invalid new settings are bounded',()=>{
  const rows=parseHomeCollections({version:1,rows:[{id:'a',kind:'items',collectionIds:['x'],itemSort:'unsupported',placement:'javascript:bad',itemOrder:['a','a',null,'b']}, {id:'b',kind:'items',collectionIds:['y'],itemSort:'custom',placement:'native:next up:1',itemOrder:['z','x']}]}).rows;
  assert.equal(rows[0].itemSort,'collection');assert.equal(rows[0].placement,'end');assert.deepEqual(rows[0].itemOrder,['a','b']);
  assert.equal(rows[1].placement,'native:next up:1');assert.equal(rows[1].itemSort,'custom');
});
