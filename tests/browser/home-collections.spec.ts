import { expect, test } from '@playwright/test';
const coast='collection-coast';
const rowConfig={version:1,rows:[{id:'collections',kind:'collections',title:'Collections',collectionIds:['collection-wilderness',coast],ranked:false},{id:'trending',kind:'items',title:'Trending Movies',collectionIds:[coast],ranked:true}]};

test('choose collection cards and a ranked member row, save, reload and navigate',async({page})=>{
  await page.goto('/?featured=0#/home');
  await page.getByRole('button',{name:'Customize collection rows',exact:true}).click();
  const editor=page.getByRole('dialog',{name:'Customize collection rows'});
  await editor.getByRole('button',{name:'Add Collections row',exact:true}).click();
  const cards=editor.getByRole('group',{name:'Collections row',exact:true});
  await cards.getByRole('button',{name:'Coastal Stories',exact:true}).click();
  await editor.getByRole('button',{name:'Add collection items row',exact:true}).click();
  const members=editor.getByRole('group',{name:'Collection items row',exact:true});
  await members.getByLabel('Row title',{exact:true}).fill('Trending Movies');
  await members.getByRole('button',{name:'Coastal Stories',exact:true}).click();
  await members.getByRole('button',{name:'Ranked artwork',exact:true}).click();
  await editor.getByRole('button',{name:'Save rows',exact:true}).click();
  await expect(editor).toHaveCount(0);
  const row=page.getByRole('region',{name:'Trending Movies',exact:true});
  await expect(row.locator('.tvl-home-row-card')).toHaveCount(2);
  await expect(row.locator('.tvl-home-rank')).toHaveCount(2);
  await expect(row.locator('.tvl-home-rank').first()).toHaveAttribute('src',/^data:image\/svg\+xml,/);
  await expect(row.locator('.tvl-home-row-caption').first()).toHaveText('After the Tide');
  await row.getByRole('button',{name:'Rank 1: After the Tide',exact:true}).focus();
  await page.keyboard.press('ArrowRight');await expect(row.getByRole('button',{name:'Rank 2: A Kind of Blue',exact:true})).toBeFocused();
  await page.reload();await expect(page.getByRole('region',{name:'Trending Movies',exact:true}).locator('.tvl-home-rank')).toHaveCount(2);
  await page.getByRole('region',{name:'Collections',exact:true}).getByRole('button',{name:'Coastal Stories',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Coastal Stories collection',exact:true})).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region',{name:'Collections',exact:true}).getByRole('button',{name:'Coastal Stories',exact:true})).toBeFocused();
});

test('cancel discards edits and restores focus; saving rejects an empty selection',async({page})=>{
  await page.goto('/?featured=0#/home');const customize=page.getByRole('button',{name:'Customize collection rows',exact:true});
  await customize.click();const editor=page.getByRole('dialog',{name:'Customize collection rows'});
  await editor.getByRole('button',{name:'Add collection items row',exact:true}).click();
  await editor.getByRole('button',{name:'Save rows',exact:true}).click();await expect(editor.getByRole('status')).toContainText('Choose at least one');
  await page.keyboard.press('Escape');await expect(editor).toHaveCount(0);await expect(customize).toBeFocused();
  await customize.click();await expect(page.getByRole('group',{name:'Collection items row',exact:true})).toHaveCount(0);
});

test('configured rows preserve selection order, survive native rerender and leave Featured owned nodes in place',async({page})=>{
  await page.addInitScript(config=>localStorage.setItem(`jellyfin-cinema.home-collections.v1:${encodeURIComponent(location.origin)}:demo`,JSON.stringify(config)),rowConfig);
  await page.goto('/#/home');
  const row=page.getByRole('region',{name:'Collections',exact:true});
  await expect.poll(()=>row.locator('.tvl-home-row-card').evaluateAll(nodes=>nodes.map(node=>(node as HTMLElement).dataset.itemId))).toEqual(['collection-wilderness',coast]);
  await page.locator('.ec-root').evaluate(node=>node.setAttribute('data-original','true'));
  await page.evaluate(()=>document.dispatchEvent(new CustomEvent('demo-home-settings',{detail:{sections:['nextup','resume']}})));
  await expect(page.getByRole('region',{name:'Trending Movies',exact:true})).toBeVisible();
  await expect(page.locator('.tvl-home-collections')).toHaveCount(1);
  // Native Home owns Featured's recreation during native preference changes.
  await expect(page.locator('#homeTab .ec-root')).toHaveCount(1);
  await page.locator('.skinHeader').getByRole('button',{name:'Favourites',exact:true}).click();await expect(row).toBeHidden();
});

test('only accessible collections are fetched and account switches remove old rows',async({page})=>{
  await page.addInitScript(config=>localStorage.setItem(`jellyfin-cinema.home-collections.v1:${encodeURIComponent(location.origin)}:demo`,JSON.stringify(config)),{version:1,rows:[{id:'secret',kind:'items',title:'Unavailable',collectionIds:['not-visible'],ranked:true}]});
  await page.goto('/?featured=0#/home');
  await expect(page.getByRole('region',{name:'Unavailable',exact:true})).toContainText('No accessible collections selected');
  await page.evaluate(()=>{(window as any).TvItemLayoutDemo.api.userId='other-account';(window as any).TvItemLayout.refresh();});
  await expect(page.getByRole('region',{name:'Unavailable',exact:true})).toHaveCount(0);await expect(page.locator('.tvl-home-collections')).toHaveCount(1);
});


test('remote arrows skip empty rows and command-only remotes select a collection',async({page})=>{
  await page.addInitScript(config=>localStorage.setItem(`jellyfin-cinema.home-collections.v1:${encodeURIComponent(location.origin)}:demo`,JSON.stringify(config)),{version:1,rows:[...rowConfig.rows,{id:'missing',kind:'items',title:'Missing',collectionIds:['missing'],ranked:false}]});
  await page.goto('/?featured=0#/home');
  const last=page.getByRole('region',{name:'Trending Movies',exact:true}).getByRole('button',{name:'Rank 2: A Kind of Blue',exact:true});
  await last.focus();await page.keyboard.press('ArrowDown');await expect(page.getByRole('button',{name:'Customize collection rows',exact:true})).toBeFocused();
  await page.keyboard.press('ArrowUp');await expect(page.getByRole('region',{name:'Trending Movies',exact:true}).getByRole('button',{name:'Rank 1: After the Tide',exact:true})).toBeFocused();
  await page.getByRole('button',{name:'Customize collection rows',exact:true}).click();
  const row=page.getByRole('group',{name:'Collection items row',exact:true}).first();
  await row.getByRole('button',{name:'Into the Wilderness',exact:true}).focus();
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('command',{detail:{command:'select'}})));
  await expect(row.getByRole('button',{name:'Into the Wilderness',exact:true})).toHaveAttribute('aria-pressed','true');
});
