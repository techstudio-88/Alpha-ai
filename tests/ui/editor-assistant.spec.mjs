import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const url='/studio?demo=1&view=editor&project=11111111-1111-4111-8111-111111111111&clip=clip-0';

test('signup reflects enabled providers and offers immediate email signup only when confirmation is disabled',async({page})=>{
  await page.route('**/api/auth/options',route=>route.fulfill({json:{configured:true,githubEnabled:true,emailEnabled:false,emailConfirmationRequired:true}}));
  await page.goto('/studio?mode=signup');
  await expect(page.getByRole('button',{name:'Continue with GitHub'})).toBeVisible();
  await expect(page.getByText('Email sign-in is turned off for this project.',{exact:false})).toBeVisible();
  await expect(page.getByLabel('Email address')).toHaveCount(0);
  await page.unroute('**/api/auth/options');
  await page.route('**/api/auth/options',route=>route.fulfill({json:{configured:true,githubEnabled:true,emailEnabled:true,emailConfirmationRequired:false}}));
  await page.reload();
  await expect(page.getByLabel('Email address')).toBeVisible();
  await expect(page.getByText('Your workspace opens immediately after signup.')).toBeVisible();
});

test('selected-clip assistant splits a real draft, supports caption removal, and shares undo/redo with manual controls',async({page})=>{
  await page.goto(url);await page.getByRole('tab',{name:'AI assistant',exact:true}).click();
  await page.getByLabel('What should change?').fill('Split it in two parts and remove captions');
  await page.getByRole('button',{name:'Prepare edit plan'}).click();
  await expect(page.getByRole('region',{name:'Proposed edit plan'})).toContainText('2 clips');
  await page.getByRole('button',{name:'Apply to draft'}).click();
  await expect(page.locator('.editor-parts button')).toHaveCount(2);
  await expect(page.getByRole('button',{name:'Render 2 clips'})).toBeVisible();
  await expect(page.locator('.editor-caption-preview')).toHaveCount(0);
  await page.getByRole('button',{name:'Undo edit'}).click();
  await expect(page.locator('.editor-parts button')).toHaveCount(0);
  await expect(page.locator('.editor-caption-preview')).toBeVisible();
  await page.getByRole('button',{name:'Redo edit'}).click();
  await expect(page.locator('.editor-parts button')).toHaveCount(2);
  const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
  expect(axe.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
test('manual caption corrections update the preview without removing speech, and can be undone',async({page})=>{
  await page.goto(url);await page.locator('.transcript-words button').first().click();
  await page.getByLabel('Caption word',{exact:true}).fill('These');
  await page.getByRole('button',{name:'Apply caption text'}).click();
  await expect(page.locator('.transcript-words button').first()).toHaveText('These');
  await expect(page.getByLabel('Caption preview')).toContainText('These');
  await page.getByLabel('Find a word').fill('not-in-the-transcript');
  await expect(page.getByLabel('Caption preview')).toContainText('These');
  await page.getByLabel('Find a word').fill('');
  await expect(page.locator('.transcript-words button.removed')).toHaveCount(0);
  await page.getByRole('button',{name:'Undo edit'}).click();
  await expect(page.locator('.transcript-words button').first()).toHaveText('The');
});
test('workspace assistant carries a selected clip request into the editor without touching real jobs',async({page})=>{
  await page.goto('/studio?demo=1&view=assistant');
  await page.getByLabel('Assistant context',{exact:true}).click();
  await page.getByRole('option',{name:'A question beats a perfect plan',exact:true}).click();
  await page.getByRole('button',{name:'Split it in two parts',exact:true}).click();
  await page.getByRole('button',{name:'Send message',exact:true}).click();
  await page.getByRole('button',{name:'Review edit in the editor'}).click();
  await expect(page.getByLabel('What should change?')).toHaveValue('Split it in two parts');
  await expect(page.getByRole('tab',{name:'AI assistant',exact:true})).toHaveAttribute('data-state','active');
  await page.getByRole('button',{name:'Prepare edit plan'}).click();
  await expect(page.getByRole('region',{name:'Proposed edit plan'})).toContainText('2 clips');
});
test('landing animation preferences persist and interactive assistant previews reflect caption edits',async({page},info)=>{
  await page.goto('/');
  if(info.project.name==='mobile')await page.getByRole('button',{name:'Open website navigation'}).click();
  await page.getByRole('button',{name:'Pause animations',exact:true}).click();
  if(info.project.name==='mobile')await page.keyboard.press('Escape');
  await expect(page.locator('html')).toHaveAttribute('data-motion','paused');
  await page.reload();await expect(page.locator('html')).toHaveAttribute('data-motion','paused');
  await page.locator('#ai-editor').getByRole('button',{name:'Remove captions',exact:true}).click();
  await expect(page.locator('#ai-editor .showcase-caption')).toHaveCount(0);
  await expect(page.locator('#ai-editor .showcase-parts .showcase-clip')).toHaveCount(1);
  expect(await page.locator('.hero-copy h1').evaluate(n=>getComputedStyle(n).animationName)).toBe('none');
});
test('assistant workspace is accessible and responsive in both themes',async({page})=>{
  await page.goto('/studio?demo=1&view=assistant');
  await expect(page.getByRole('heading',{level:1,name:'AI assistant',exact:true})).toBeVisible();
  for(const theme of ['dark','light']){
    if(theme==='light')await page.getByRole('button',{name:'Switch to light theme'}).click();
    const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
    expect(result.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))).toEqual([]);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  }
});
