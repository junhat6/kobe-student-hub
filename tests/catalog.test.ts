import {describe,it,expect} from 'vitest';
import {sampleCatalog} from '../src/sample';
import {searchCatalog,relatedEntries} from '../src/catalog';
import {isCatalog} from '../src/validation';
describe('discovery',()=>{
 it('supports Japanese and normalized keywords',()=>{expect(searchCatalog(sampleCatalog,'Ｇｉｔ')[0].id).toBe('git-branches')});
 it('intersects tag and kind and all query words',()=>{expect(searchCatalog(sampleCatalog,'制作 ノート','article','制作').map(e=>e.id)).toEqual(['learning-notes']);expect(searchCatalog(sampleCatalog,'','project','Git')).toEqual([])});
 it('finds content through student display name',()=>{expect(searchCatalog(sampleCatalog,'サンプルの先輩')).toHaveLength(2)});
 it('keeps related content excluding itself',()=>{expect(relatedEntries(sampleCatalog.entries[0],sampleCatalog.entries).map(e=>e.id)).toEqual(['tiny-notes'])});
 it('handles empty and invalid catalog responses',()=>{expect(searchCatalog(sampleCatalog,'存在しない')).toEqual([]);expect(isCatalog(sampleCatalog)).toBe(true);expect(isCatalog({entries:[{}],profiles:[],mode:'sample'})).toBe(false);expect(isCatalog(null)).toBe(false)});
});

describe('combined article and corresponding author search',()=>{
 it('matches AND terms across content and its author, independent of order',()=>{
  for(const query of ['Git サンプルの先輩','サンプルの先輩 Git','　ＧｉＴ　サンプルの先輩  IT分野 '])
   expect(searchCatalog(sampleCatalog,query).map(e=>e.id)).toEqual(['git-branches']);
 });
 it('does not borrow another author or another entry to satisfy a term',()=>{
  expect(searchCatalog(sampleCatalog,'Git サンプルの学生')).toEqual([]);
  expect(searchCatalog(sampleCatalog,'Git 制作ノート サンプルの先輩')).toEqual([]);
 });
 it('normalizes stored author fields as well as queries',()=>{
  const catalog={...sampleCatalog,profiles:sampleCatalog.profiles.map(p=>p.id==='sample-a'?{...p,name:'ＳＥＮＰＡＩ',department:'ＩＴ分野'}:p)};
  expect(searchCatalog(catalog,'git senpai it分野').map(e=>e.id)).toEqual(['git-branches']);
 });
 it('keeps type/tag intersection and updated date ordering',()=>{
  expect(searchCatalog(sampleCatalog,'制作 サンプル','article','制作').map(e=>e.id)).toEqual(['learning-notes']);
  expect(searchCatalog(sampleCatalog,'Git サンプルの先輩','project')).toEqual([]);
  expect(searchCatalog(sampleCatalog,'Git サンプルの先輩','article','制作')).toEqual([]);
  expect(searchCatalog(sampleCatalog,'サンプル IT分野').map(e=>e.id)).toEqual(['learning-notes','git-branches','tiny-notes','first-team']);
 });
 it('still finds an entry without a matching profile by its own content',()=>{
  expect(searchCatalog({...sampleCatalog,profiles:[]},'Git').map(e=>e.id)).toEqual(['git-branches']);
 });
});
