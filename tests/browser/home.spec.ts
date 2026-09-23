import { expect, test, type Page } from '@playwright/test';

const home=(page:Page)=>page.locator('#indexPage #homeTab');
const sections=(page:Page)=>home(page).locator('.sections.homeSectionsContainer');
async function settings(page:Page,detail:Record<string,unknown>){
  await page.evaluate(value=>document.dispatchEvent(new CustomEvent('demo-home-settings',{detail:value})),detail);
}

test('Home preserves native user sections and navigation without a replacement modal or Back heading',async({page})=>{
  await page.goto('/?featured=0#/home');
  await expect(page.locator('body')).toHaveClass(/tvl-home/);
  await expect(page.locator('#tv-layout')).toHaveCount(0);
  await expect(home(page)).toBeVisible();
  await expect(page.locator('#indexPage')).not.toHaveAttribute('aria-hidden','true');
  await expect(page.locator('.headerBackButton')).toBeHidden();
  await expect(home(page).getByRole('heading',{name:'Home',exact:true})).toHaveCount(0);
  await expect(home(page).getByRole('region',{name:'My Media',exact:true}).locator('.card')).toHaveCount(5);
  await expect(home(page).getByRole('region',{name:'Continue listening',exact:true}).locator('.card')).toHaveCount(2);
  await expect(home(page).getByRole('region',{name:'Next up',exact:true}).locator('.card')).toHaveCount(2);
  await expect(page.locator('.skinHeader').getByRole('button',{name:'Home',exact:true})).toBeVisible();
  await expect(page.locator('.skinHeader').getByRole('button',{name:'Home',exact:true})).toHaveCSS('font-size','0px');
});

test('Home respects native section order, hidden libraries and exclusions from Latest',async({page})=>{
  await page.goto('/?featured=0&homeSections=nextup,librarybuttons,resumeaudio,latestmedia&libraryOrder=library-music,library-tv,library-movies,library-live&hiddenLibraries=library-tv&hiddenLatest=library-movies#/home');
  await expect.poll(()=>sections(page).locator('[data-home-section]').evaluateAll(nodes=>nodes.map(node=>(node as HTMLElement).dataset.homeSection))).toEqual(['nextup','librarybuttons','resumeaudio','latestmedia']);
  await expect.poll(()=>home(page).locator('.homeLibraryButton').evaluateAll(nodes=>nodes.map(node=>node.textContent))).toEqual(['Music','Movies','Live TV']);
  await expect(home(page).getByRole('region',{name:'Continue watching',exact:true})).toHaveCount(0);
  await expect(home(page).getByRole('region',{name:'Latest in Movies',exact:true})).toHaveCount(0);
  await expect(home(page).getByRole('region',{name:'Latest in TV Shows',exact:true})).toHaveCount(0);
  await expect(home(page).getByRole('region',{name:'Latest in Music',exact:true})).toBeVisible();
});

test('Native preferences can replace and reorder Home rows after activation',async({page})=>{
  await page.goto('/?featured=0#/home');
  await settings(page,{sections:['resumeaudio','librarybuttons','nextup'],hiddenLibraries:['library-live'],libraryOrder:['library-tv','library-music','library-movies','library-live']});
  await expect.poll(()=>sections(page).locator('[data-home-section]').evaluateAll(nodes=>nodes.map(node=>(node as HTMLElement).dataset.homeSection))).toEqual(['resumeaudio','librarybuttons','nextup']);
  await expect.poll(()=>home(page).locator('.homeLibraryButton').evaluateAll(nodes=>nodes.map(node=>node.textContent))).toEqual(['TV Shows','Music','Movies']);
  await expect(home(page).getByRole('region',{name:'Continue watching',exact:true})).toHaveCount(0);
  await expect(home(page).getByRole('region',{name:'Live TV',exact:true})).toHaveCount(0);
  await expect(page.locator('#tv-layout')).toHaveCount(0);
  const target=home(page).getByRole('region',{name:'Continue listening',exact:true}).locator('.card').first();
  await target.focus();await page.keyboard.press('ArrowRight');await expect(target.locator('..').locator('.card').nth(1)).toBeFocused();
});

test('Native Home library and item handlers retain detail navigation and Back focus',async({page})=>{
  await page.goto('/?featured=0#/home');
  const library=home(page).getByRole('region',{name:'My Media',exact:true}).getByRole('button',{name:'Movies',exact:true});
  await library.click();await expect(page.getByRole('dialog',{name:'Movies',exact:true})).toBeVisible();
  await expect(page.locator('body')).not.toHaveClass(/tvl-home/);
  await page.keyboard.press('Escape');await expect(home(page)).toBeVisible();await expect(library).toBeFocused();
  const film=home(page).getByRole('region',{name:'Continue watching',exact:true}).getByRole('button',{name:'After the Tide',exact:true});
  await film.click();await expect(page.getByRole('dialog',{name:'After the Tide details',exact:true})).toBeVisible();
  await page.keyboard.press('Escape');await expect(film).toBeFocused();
});

test('Native Home/Favourites tabs work without changing the hash, including direct Favourites entry',async({page})=>{
  await page.goto('/?featured=0#/home');
  const tabs=page.locator('.skinHeader .headerTabs');
  await tabs.getByRole('button',{name:'Favourites',exact:true}).click();
  await expect(page).toHaveURL(/#\/home$/);await expect(page.locator('#favoritesTab')).toBeVisible();await expect(home(page)).toBeHidden();
  await tabs.getByRole('button',{name:'Home',exact:true}).click();await expect(home(page)).toBeVisible();await expect(page.locator('#tv-layout')).toHaveCount(0);
  await page.goto('/?featured=0#/home?tab=1');await expect(page.locator('#favoritesTab')).toBeVisible();
  await tabs.getByRole('button',{name:'Home',exact:true}).click();await expect(page).toHaveURL(/#\/home\?tab=1$/);await expect(home(page)).toBeVisible();
  await expect(page.locator('body')).toHaveClass(/tvl-home/);
});

test('Native Home global links remain reachable and other routes leave the Home skin',async({page})=>{
  for(const [name,target] of [['Search',/#\/search(?:\?|$)/],['Now playing',/#\/queue(?:\?|$)/],['Settings',/#\/mypreferencesmenu(?:\?|$)/]] as const){
    await page.goto('/?featured=0#/home');await page.locator('.skinHeader').getByRole('link',{name,exact:true}).click();
    await expect(page).toHaveURL(target);await expect(page.locator('body')).not.toHaveClass(/tvl-home/);await expect(page.locator('#tv-layout')).toHaveCount(0);
  }
  await page.goto('/?featured=0#/home');await home(page).getByRole('region',{name:'Live TV',exact:true}).getByRole('link',{name:'Recordings',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Recordings',exact:true})).toBeVisible();
});

test('Featured-owned Home nodes keep their position, event listeners, keyboard actions and custom height',async({page})=>{
  await page.goto('/#/home');
  const featured=home(page).locator('.ec-root');await expect(featured).toBeVisible();
  await featured.evaluate(node=>{(node as HTMLElement).style.height='535px';node.setAttribute('data-instance','original');});
  await featured.getByRole('button',{name:'Resume',exact:true}).focus();await page.keyboard.press('ArrowRight');
  await expect(featured).toHaveAttribute('data-featured-key','ArrowRight');await expect(featured.getByRole('link',{name:'Details',exact:true})).toBeFocused();
  await expect(featured).toHaveCSS('height','535px');
  await expect.poll(()=>featured.evaluate(node=>node.parentElement?.firstElementChild===node&&!!node.nextElementSibling?.hasAttribute('data-home-section'))).toBe(true);
  await featured.getByRole('link',{name:'Details',exact:true}).click();await expect(page.getByRole('dialog',{name:'After the Tide details',exact:true})).toBeVisible();
  await page.keyboard.press('Escape');await expect(featured).toHaveAttribute('data-instance','original');await expect(featured.getByRole('link',{name:'Details',exact:true})).toBeFocused();
});

test('A late native Home host and later section insertions remain visible without being masked or cloned',async({page})=>{
  await page.route('**/dist/demo.js',async route=>{const response=await route.fetch();await route.fulfill({response,body:`${await response.text()}\n(()=>{const host=document.getElementById('indexPage');host.remove();document.addEventListener('mount-native-home',()=>document.body.append(host),{once:true});})();`});});
  await page.goto('/?featured=0#/home');await expect(page.locator('body')).toHaveClass(/tvl-home/);await expect(page.locator('#indexPage')).toHaveCount(0);
  await page.evaluate(()=>document.dispatchEvent(new Event('mount-native-home')));await expect(home(page)).toBeVisible();
  await page.evaluate(()=>{const target=document.querySelector('#homeTab .sections')!;const late=document.createElement('section');late.className='verticalSection';late.id='late-native-section';late.innerHTML='<h2 class="sectionTitle">Native extension</h2><button>Extension action</button>';late.querySelector('button')!.addEventListener('click',()=>{late.dataset.clicked='true';});target.append(late);});
  await page.getByRole('button',{name:'Extension action',exact:true}).click();await expect(page.locator('#late-native-section')).toHaveAttribute('data-clicked','true');
  await expect(page.locator('#indexPage')).not.toHaveClass(/tvl-native-hidden/);await expect(page.locator('#tv-layout')).toHaveCount(0);
});

test('Desktop Home retains native content without the TV Home skin',async({page})=>{
  await page.addInitScript(()=>document.addEventListener('DOMContentLoaded',()=>{document.body.classList.remove('layout-tv');document.body.classList.add('layout-desktop');}));
  await page.goto('/?featured=0#/home');await expect(home(page)).toBeVisible();await expect(page.locator('body')).not.toHaveClass(/tvl-home/);
  await expect(page.locator('#tv-layout')).toHaveCount(0);await expect(page.locator('.headerBackButton')).toBeVisible();
});
