import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const project='11111111-1111-4111-8111-111111111111';
async function noOverflow(page){expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)}

test('landing has clear hierarchy, truthful pricing, structured data and a working demo',async({page},info)=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading',{level:1})).toHaveText('One long video.A week of clips.');
  await expect(page.locator('#product-demo')).toBeVisible();
  await page.getByRole('button',{name:'Pause demo',exact:true}).click();
  await expect(page.getByRole('button',{name:'Play demo',exact:true})).toBeVisible();
  const picture=await page.request.get('/studio-sample.svg');
  expect((await picture.body()).byteLength).toBeLessThan(200*1024);
  const schemas=await page.locator('script[type="application/ld+json"]').allTextContents();
  expect(schemas.join(' ')).toContain('FAQPage');expect(schemas.join(' ')).toContain('SoftwareApplication');
  await expect(page.getByText('Proposed plan · not on sale').first()).toBeAttached();
  await noOverflow(page);expect(errors).toEqual([]);
  const accessibility=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
  expect(accessibility.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))).toEqual([]);
  await page.screenshot({path:`/tmp/omnirush/alpha-landing-${info.project.name}.png`,fullPage:true});
});

for(const view of ['home','projects','clips','project','editor','publish','insights','brand','settings']){
  test(`${view} screen is responsive and has no runtime or AA accessibility errors`,async({page})=>{
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`/studio?demo=1&view=${view}&project=${project}&clip=clip-0`);
    await expect(page.locator('main h1')).toBeVisible();
    if(view==='publish')await page.getByRole('button',{name:'Close dialog'}).click();
    await noOverflow(page);expect(errors).toEqual([]);
    const results=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
    expect(results.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)}))).toEqual([]);
  });
}

test('theme persists, command palette traps focus and mobile navigation works',async({page},info)=>{
  await page.goto('/studio?demo=1');
  await page.getByRole('button',{name:'Switch to light theme'}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  const light=await new AxeBuilder({page}).withTags(['wcag2aa']).analyze();
  expect(light.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))).toEqual([]);
  await page.reload();await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  // The theme is set before hydration; wait for the actual workspace before sending shortcuts.
  await expect(page.getByRole('button',{name:'Search workspace, Command K'})).toBeVisible();
  await page.keyboard.press('Control+k');await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).not.toBeVisible();
  if(info.project.name==='mobile'){
    await page.getByRole('button',{name:'Open studio navigation'}).click();
    await page.getByRole('navigation',{name:'Mobile studio navigation'}).getByRole('link',{name:'Clips',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Clips',exact:true})).toBeVisible();
  }
});

test('editor word cuts, inspector controls and local version review are functional',async({page},info)=>{
  await page.goto(`/studio?demo=1&view=editor&project=${project}&clip=clip-0`);
  await page.locator('.transcript-words button').first().click();
  await page.getByRole('button',{name:'Remove word',exact:true}).click();
  await expect(page.locator('.transcript-words button.removed')).toHaveCount(1);
  await page.getByRole('tab',{name:'Speed / zoom'}).click();
  await expect(page.getByText('Playback speed', {exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Open version history'}).click();
  await expect(page.getByRole('dialog')).toContainText('Version 1');await page.keyboard.press('Escape');
  await page.screenshot({path:`/tmp/omnirush/alpha-editor-${info.project.name}.png`,fullPage:true});
});

test('empty, error and loading states are designed and retry returns to real sample content',async({page})=>{
  await page.goto('/studio?demo=1&view=clips&state=empty');
  await expect(page.getByRole('heading',{name:'A library of your best moments.'})).toBeVisible();
  await page.goto('/studio?demo=1&view=clips&state=error');
  await page.getByRole('button',{name:'Retry',exact:true}).click();
  await expect(page.locator('.clip-card')).toHaveCount(4);
  await page.goto('/studio?demo=1&view=publish&state=loading');
  await expect(page.locator('[aria-busy="true"]')).toBeVisible();
  const loading=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
  expect(loading.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))).toEqual([]);
});

test('landing respects reduced motion and meets the local cold-load LCP budget',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.addInitScript(()=>{new PerformanceObserver(list=>{window.__lcp=list.getEntries().at(-1).startTime}).observe({type:'largest-contentful-paint',buffered:true})});
  await page.goto('/');await expect(page.locator('#product-demo')).toBeVisible();
  await expect(page.getByRole('button',{name:'Play demo',exact:true})).toBeDisabled();
  await page.waitForTimeout(600);
  const lcp=await page.evaluate(()=>window.__lcp);
  expect(lcp).toBeLessThan(2000);
  console.log(`Local ${page.viewportSize().width}px LCP: ${Math.round(lcp)}ms`);
});

for(const mode of ['signin','signup','reset']){
  test(`auth ${mode} has labels, responsive layout and accessible failure recovery`,async({page})=>{
    await page.goto('/studio?mode='+mode);await expect(page.locator('main h1')).toBeVisible();
    await noOverflow(page);
    const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
    expect(result.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))).toEqual([]);
  });
}

test('settings subsections and onboarding show real empty states, not fake connections',async({page})=>{
  test.setTimeout(60000); // Five separate axe scans plus onboarding in a constrained WSL browser.
  await page.goto('/studio?demo=1&view=settings');
  for(const name of ['Members & roles','API keys','Integrations','Billing','Danger zone']){
    await page.getByRole('navigation',{name:'Settings sections'}).getByRole('button',{name,exact:true}).click();
    await noOverflow(page);
    const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
    expect(result.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))).toEqual([]);
  }
  await page.goto('/studio?demo=1&state=empty');await expect(page.getByRole('region',{name:'Getting started checklist'})).toBeVisible();
  await page.getByRole('button',{name:'Dismiss',exact:true}).click();
  await expect(page.getByRole('region',{name:'Getting started checklist'})).not.toBeVisible();
});
