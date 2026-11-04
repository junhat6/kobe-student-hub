import {describe,it,expect} from 'vitest';
import {safeListPath,readListOrigin} from '../src/navigation';
describe('public list return targets',()=>{
 it('keeps only existing list filters',()=>{expect(safeListPath('/search?tag=Git&kind=article&q=先輩&from=https://evil.invalid')).toBe('/search?q=%E5%85%88%E8%BC%A9&tag=Git&kind=article');expect(safeListPath('/?kind=project')).toBe('/?kind=project');const target=safeListPath('/search?q=学び方&tag=Git');expect(safeListPath(target)).toBe(target);expect(safeListPath('/search?q='+'あ'.repeat(1000))).toBeNull()});
 it('supports study variant and public profile lists',()=>{expect(safeListPath('/study/cards?variant=b&extra=x')).toBe('/study/cards?variant=b');expect(safeListPath('/students/sample-a')).toBe('/students/sample-a')});
 it('rejects external, ambiguous and non-list targets',()=>{for(const x of [null,{},'', 'https://evil.invalid/search','//evil.invalid/search','/\\evil.invalid','javascript:alert(1)','/api/catalog','/articles/git-branches','/search#anything','/search?'+ 'x'.repeat(4096)])expect(safeListPath(x)).toBeNull()});
 it('accepts only a bounded matching origin snapshot',()=>{expect(readListOrigin({to:'/search',y:500,entryId:'git-branches'},'/search')).toEqual({to:'/search',y:500,entryId:'git-branches'});for(const y of [-1,Infinity,NaN,1000001])expect(readListOrigin({to:'/search',y,entryId:'id'},'/search')).toBeNull();expect(readListOrigin({to:'//evil.invalid',y:0,entryId:'id'},'/search')).toBeNull();expect(readListOrigin(null,'/search')).toBeNull()});
});

it('bounds profile context to one canonical non-profile list and never recursively expands it',()=>{
 const leaf='/search?q=Git&tag=Git&kind=article';const profile='/students/sample-a?from='+encodeURIComponent(leaf);expect(safeListPath(profile)).toBe(profile);expect(safeListPath('/students/sample-a?from='+encodeURIComponent('/students/sample-b?from='+encodeURIComponent(leaf)))).toBe('/students/sample-a');
 for(const bad of ['https://evil.invalid/search','/api/catalog','/search#private','/search?q='+'x'.repeat(4096)])expect(safeListPath('/students/sample-a?from='+encodeURIComponent(bad))).toBe(bad.length>4096?null:'/students/sample-a');expect(safeListPath('/students/sample-a?from=%2Fsearch&from=%2F')).toBe('/students/sample-a');
});
