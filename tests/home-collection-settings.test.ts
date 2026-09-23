import assert from 'node:assert/strict';
import { test } from 'node:test';
import { homeCollectionKey, parseHomeCollections, rankImage } from '../src/home-collection-settings.ts';

test('home collection preferences reject corrupt data, bound choices and preserve chosen order',()=>{
  assert.deepEqual(parseHomeCollections({version:2,rows:[]}),{version:1,rows:[]});
  const settings=parseHomeCollections({version:1,rows:[
    {id:'row',kind:'collections',title:' Collections ',collectionIds:['second','first','second',null],ranked:true},
    {id:'row',kind:'items',collectionIds:['hidden']},
    {id:'single',kind:'items',collectionIds:['a','b'],ranked:true},
  ]});
  assert.deepEqual(settings.rows,[{id:'row',kind:'collections',title:'Collections',collectionIds:['second','first'],ranked:false},{id:'single',kind:'items',title:'',collectionIds:['a'],ranked:true}]);
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
