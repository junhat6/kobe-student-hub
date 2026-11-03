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
