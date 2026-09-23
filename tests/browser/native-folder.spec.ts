import { expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';

const elegantFinPath = process.env.TVL_ELEGANTFIN_CSS || '/tmp/cinema-elegantfin-theme.css';

async function setup(page: Page, rejectDvr = false) {
  await page.route('**/dist/demo.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\n(() => {
      const api = window.TvItemLayoutDemo.api, getItem = api.getItem;
      api.getItem = async id => id === 'old-recordings' ? {Id:id, Name:'Recordings', Type:'CollectionFolder', IsFolder:true} : getItem(id);
      // Mirrors the live failure: DVR identifies Recordings2, but Home opens
      // the distinct older Recordings library. Never redirect or merge them.
      api.isRecordingFolder = async id => { ${rejectDvr ? "throw new Error('Forbidden');" : "return id === 'current-recordings2';"} };
      function render() {
        if (!location.hash.includes('parentId=old-recordings')) return;
        const host=document.querySelector('.demo-native-page');
        host.className='demo-native-page page libraryPage mainAnimatedPage'; host.setAttribute('data-role','page');
        host.innerHTML='<div class="alphaPicker alphaPicker-vertical"><div class="alphaPickerRow"><button class="alphaPickerButton">A</button><button class="alphaPickerButton">B</button></div></div><div class="padded-left"><div class="itemsViewSettingsContainer"><span class="listPaging">0–0 of 0</span><button class="btnSort">Sort</button><button class="btnFilter">Filter</button></div><div class="itemsContainer" data-parentid="old-recordings"></div></div>';
        host.querySelector('.btnSort').addEventListener('click',()=>document.body.dataset.nativeSort='opened');
        host.querySelector('.btnFilter').addEventListener('click',()=>document.body.dataset.nativeFilter='opened');
        window.__folderNativeSort=host.querySelector('.btnSort');
      }
      window.addEventListener('hashchange',render); render();
    })();` });
  });
  await page.goto('/?featured=0#/list?parentId=old-recordings');
  // The native vertical row defaults to flex-direction:column. Include that
  // competing rule so a flat fixture cannot hide an oversized alphabet column.
  await page.addStyleTag({content: '.alphaPickerRow-vertical{flex-direction:column}.alphaPicker-vertical{height:70%}.alphaPickerButton:focus{transform:scale(1.75)}'});
  await page.locator('.alphaPickerRow').evaluate(node=>node.classList.add('alphaPickerRow-vertical'));
}

test('historic Recordings library receives Cinema styling while native contents and actions retain ownership', async ({ page }) => {
  await setup(page);
  const folder = page.locator('.tvl-folder-page');
  await expect(folder.getByRole('heading', { name:'Recordings', exact:true })).toBeVisible();
  await expect(folder).toHaveCSS('background-color','rgb(16, 17, 18)');
  await expect(page.locator('#tv-layout')).toHaveCount(0);
  await expect(folder).not.toHaveAttribute('aria-hidden','true');
  await expect(folder.locator('.itemsContainer')).toHaveAttribute('data-parentid','old-recordings');
  await expect(folder.locator('.alphaPickerRow')).toHaveCSS('flex-direction','row');
  await folder.getByRole('button',{name:'Sort',exact:true}).focus(); await page.keyboard.press('Enter');
  await expect(page.locator('body')).toHaveAttribute('data-native-sort','opened');
  await folder.getByRole('button',{name:'Filter',exact:true}).click();
  await expect(page.locator('body')).toHaveAttribute('data-native-filter','opened');
  await folder.getByRole('button',{name:'A',exact:true}).focus();
  await expect(folder.getByRole('button',{name:'A',exact:true})).toHaveCSS('transform','none');
  expect(await page.evaluate(()=>document.querySelector('.btnSort')===(window as any).__folderNativeSort)).toBe(true);
  await page.screenshot({path:test.info().outputPath('historic-recordings.png')});
});

test('folder theme survives native host replacement and releases on desktop, route change and destroy', async ({ page }) => {
  await setup(page);
  await expect(page.locator('.tvl-folder-heading')).toHaveCount(1);
  await page.evaluate(()=>{
    const host=document.querySelector('.tvl-folder-page')!;
    const replacement=document.createElement('main');replacement.className='demo-native-page libraryPage';
    replacement.innerHTML='<div class="itemsContainer" data-parentid="old-recordings"></div>';host.replaceWith(replacement);
  });
  await expect(page.locator('main.tvl-folder-page .tvl-folder-heading')).toHaveCount(1);
  await page.evaluate(()=>{document.body.classList.remove('layout-tv');document.documentElement.classList.remove('layout-tv');});
  await expect(page.locator('.tvl-folder-heading')).toHaveCount(0);
  await expect(page.locator('body')).not.toHaveClass(/tvl-folder-native/);
  await page.evaluate(()=>document.body.classList.add('layout-tv'));
  await expect(page.locator('.tvl-folder-heading')).toHaveCount(1);
  await page.evaluate(()=>{location.hash='/home';});
  await expect(page.locator('.tvl-folder-heading')).toHaveCount(0);
  await expect(page.locator('body')).not.toHaveClass(/tvl-folder-native/);
  await page.evaluate(()=>{location.hash='/list?parentId=old-recordings';});
  await expect(page.locator('.tvl-folder-heading')).toHaveCount(1);
  await page.evaluate(()=>window.TvItemLayout?.destroy());
  await expect(page.locator('.tvl-folder-heading')).toHaveCount(0);
  await expect(page.locator('.itemsContainer[data-parentid="old-recordings"]')).toBeAttached();
  await expect(page.locator('.demo-native-page').getByRole('button',{name:'Sort',exact:true})).toBeVisible();
});

test('library-only accounts still receive folder styling when DVR recognition is denied', async ({ page }) => {
  await setup(page,true);
  await expect(page.locator('.tvl-folder-page').getByRole('heading',{name:'Recordings',exact:true})).toBeVisible();
  await expect(page.locator('#tv-layout')).toHaveCount(0);
  await expect(page.locator('.tvl-folder-page')).not.toHaveAttribute('aria-hidden','true');
});

test('the visible native folder owns the theme when cached pages share a parent ID', async ({ page }) => {
  await setup(page);
  await expect(page.locator('.tvl-folder-heading')).toHaveCount(1);
  await page.evaluate(()=>{
    const active=document.querySelector('.tvl-folder-page')!;
    const cached=document.createElement('main');cached.className='libraryPage hide';cached.id='cached-folder';
    cached.innerHTML='<div class="itemsContainer" data-parentid="old-recordings"></div>';active.before(cached);
  });
  await expect(page.locator('#cached-folder .tvl-folder-heading')).toHaveCount(0);
  await expect(page.locator('.demo-native-page .tvl-folder-heading')).toHaveCount(1);
  await page.evaluate(()=>{
    document.querySelector('.demo-native-page')!.classList.add('hide');
    document.querySelector('#cached-folder')!.classList.remove('hide');
  });
  await expect(page.locator('#cached-folder .tvl-folder-heading')).toHaveCount(1);
  await expect(page.locator('.demo-native-page .tvl-folder-heading')).toHaveCount(0);
  await page.evaluate(()=>document.querySelector('#cached-folder')!.setAttribute('hidden',''));
  await expect(page.locator('.tvl-folder-heading')).toHaveCount(0);
  await page.evaluate(()=>document.querySelector('#cached-folder')!.removeAttribute('hidden'));
  await expect(page.locator('#cached-folder .tvl-folder-heading')).toHaveCount(1);
});

test('historic recording folders retain Cinema colours and compact alphabet with ElegantFin active', async ({ page }) => {
  test.skip(!existsSync(elegantFinPath), 'Set TVL_ELEGANTFIN_CSS to the external ElegantFin stylesheet.');
  await setup(page);
  await page.addStyleTag({content:readFileSync(elegantFinPath,'utf8').replace(/@import[^;]+;/g,'')});
  const folder=page.locator('.tvl-folder-page');
  await expect(folder).toHaveCSS('background-color','rgb(16, 17, 18)');
  await expect(folder).toHaveCSS('padding-top','88px');
  await expect(folder.getByRole('heading',{name:'Recordings',exact:true})).toBeVisible();
  await expect(folder.locator('.alphaPickerRow')).toHaveCSS('flex-direction','row');
  const alphabet=await folder.locator('.alphaPicker').boundingBox();
  expect(alphabet!.height).toBeLessThan(100);
  await folder.getByRole('button',{name:'A',exact:true}).focus();
  await expect(folder.getByRole('button',{name:'A',exact:true})).toHaveCSS('transform','none');
  await expect(folder.getByRole('button',{name:'A',exact:true})).toHaveCSS('background-color','rgb(211, 231, 222)');
  await page.screenshot({path:test.info().outputPath('historic-recordings-elegantfin.png')});
});
