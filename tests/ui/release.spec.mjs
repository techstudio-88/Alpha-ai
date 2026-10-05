import {test,expect} from '@playwright/test';

test('release smoke: landing, sample editor and public health load without errors',async({page,request})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const response=await page.goto('/');expect(response.status()).toBe(200);
  await expect(page.getByRole('heading',{level:1})).toHaveText('One long video.A week of clips.');
  await expect(page.getByRole('link',{name:'Explore the sample studio'})).toBeVisible();
  const health=await request.get('/api/health');expect(health.status()).toBe(200);
  expect((await health.json()).ok).toBe(true);
  await page.goto('/studio?demo=1&view=editor&project=11111111-1111-4111-8111-111111111111&clip=clip-0');
  await expect(page.getByRole('heading',{level:1})).toContainText('A question beats a perfect plan');
  await expect(page.getByRole('button',{name:'Render clip',exact:true})).toBeVisible();
  expect(errors).toEqual([]);
});

test('navigation exposes mobile links and a genuinely collapsible desktop sidebar',async({page},info)=>{
  if(info.project.name==='mobile'){
    await page.goto('/');
    await page.getByRole('button',{name:'Open website navigation'}).click();
    await page.getByRole('navigation',{name:'Mobile website navigation'}).getByRole('link',{name:'Pricing',exact:true}).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(page.locator('#pricing')).toBeInViewport();
  }else{
    await page.goto('/studio?demo=1');
    await page.getByRole('button',{name:'Collapse studio sidebar'}).click();
    await expect(page.locator('html')).toHaveAttribute('data-studio-sidebar','collapsed');
    await expect(page.getByRole('navigation',{name:'Studio navigation'}).getByRole('link',{name:'Projects',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Expand studio sidebar'}).click();
    await expect(page.locator('html')).toHaveAttribute('data-studio-sidebar','expanded');
  }
});

test('legacy reset links reach the shared auth screen and expired confirmation is recoverable',async({page})=>{
  await page.goto('/auth/reset');
  await expect(page.getByRole('heading',{level:1})).toHaveText('Reset your password');
  await expect(page.getByLabel('Email address')).toBeVisible();
  await page.goto('/auth/confirm');
  await expect(page.getByRole('button',{name:'Retry',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Retry',exact:true}).click();
  await expect(page.getByRole('heading',{level:1})).toHaveText('Welcome back.');
});
