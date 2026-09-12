import { expect, test } from '@playwright/test';
test('unfinished novel shows saved prose and resumes in complete-story panel', async ({page}, info) => {
  let resumed = false;
  await page.route('**/api/v1/projects/*/novel-progress', route => route.fulfill({json:{run:{id:'saved-run',status:resumed?'running':'failed',stage:'writing',planned_chapters:13,chapter_index:3,characters:28000,chapters:[{title:'第一章 渡口',content:'船到渡口，主角终于见到了师父。',finished:true}],error:resumed?null:{message:'模型响应超时，正文已保存。'},can_resume:!resumed,repair_notes:[]}}}));
  await page.route('**/api/v1/projects/*/novels/saved-run/resume', route => {resumed=true;return route.fulfill({status:202,json:{run_id:'saved-run',status:'queued'}});});
  await page.goto('/');
  await page.getByRole('button',{name:'开始我的故事'}).click();
  await page.getByLabel('故事名称').fill(`续写验收-${Date.now()}`);
  await page.getByRole('button',{name:'建立故事'}).click();
  await page.getByRole('button',{name:'故事 Agent',exact:true}).click();
  await page.getByRole('button',{name:/完整故事/}).click();
  await expect(page.locator('.novel-progress')).toContainText('28,000');
  await page.locator('.novel-progress summary').last().click();
  await expect(page.locator('.novel-progress')).toContainText('船到渡口');
  await page.screenshot({path:`test-results/${info.project.name}-novel-progress.png`});
  await page.getByRole('button',{name:'继续写作',exact:true}).click();
  await expect.poll(()=>resumed).toBe(true);
});
