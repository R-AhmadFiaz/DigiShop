import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL('../src/'+p,import.meta.url),'utf8');
test('shared navigation uses one role-filtered menu and an accessible mobile drawer',()=>{
 const source=read('layouts/ShopLayout.jsx');
 for(const value of ['showModal()','onCancel','Open navigation','Close navigation','aria-expanded','aria-controls','Main navigation','overflow=\'hidden\''])assert.ok(source.includes(value));
 assert.match(source,/secondaryLinks\.map/);
 assert.match(source,/mainSections.includes/);
 assert.match(source,/<summary>More<\/summary>/);
 assert.ok(source.includes("if(e.target.closest('a'))setMenuOpen(false)"));
});
test('ordinary expense and partner notes are optional but corrections keep their reason',()=>{
 const expense=read('pages/owner/Expenses.jsx'),capital=read('pages/owner/Partners.jsx');
 assert.match(expense,/Description \(Optional\)/);assert.match(capital,/Note \(Optional\)/);
 for(const source of [expense,capital])assert.match(source,/Correction reason.*name="reason".*required/);
});
