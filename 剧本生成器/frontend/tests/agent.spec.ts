import { expect, test } from '@playwright/test';
test('confirmed chat influences story through supporting nodes', async ({ page }, info) => {
  await page.goto('/');
  await page.getByRole('button', { name: '开始我的故事' }).click();
  await page.getByLabel('故事名称').fill(`Agent验收-${Date.now()}`);
  await page.getByRole('button', { name: '建立故事' }).click();
  await page.getByLabel('你的想法').fill('主角想寻找失踪的师父。世界里使用武功必须付出记忆。今天我很累');
  await page.getByRole('button', { name: '发送想法' }).click();
  await expect(page.locator('.message.assistant')).toHaveCount(1);
  await page.getByRole('button', { name: '故事 Agent', exact: true }).click();
  await expect(page.locator('.agent-node')).toHaveCount(3);
  await page.getByRole('button', { name: '确认全部待定主线节点' }).click();
  await expect(page.locator('.agent-node.main.confirmed')).toHaveCount(2);
  await page.locator('.agent-node.auxiliary').getByRole('button', { name: '确认节点', exact: true }).click();
  await expect(page.getByLabel('允许影响剧情（以主线为主）')).toBeChecked();
  await page.locator('.agent-node').first().getByRole('button', { name: '查看原文' }).click();
  await expect(page.getByRole('dialog')).toContainText('今天我很累');
  await page.getByRole('button', { name: '关闭节点来源' }).click();
  await page.getByRole('button', { name: '连接节点生成故事' }).click();
  await expect(page.locator('.story-chapter')).toHaveCount(2);
  await expect(page.locator('.story-chapter').first()).toContainText('模拟辅助影响');
  await expect(page.locator('.story-edge')).toHaveCount(2);
  const downloaded = page.waitForEvent('download');
  await page.getByRole('link', { name: '导出故事', exact: true }).click();
  expect((await downloaded).suggestedFilename()).toBe('story-draft.md');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path:`test-results/${info.project.name}-agent.png`, fullPage:true});
});

test('generate novel directly from conversation summaries', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '开始我的故事' }).click();
  await page.getByLabel('故事名称').fill(`一键小说-${Date.now()}`);
  await page.getByRole('button', { name: '建立故事' }).click();
  await page.getByLabel('你的想法').fill('主角想寻找失踪的师父。世界里武功以记忆为代价。今天我很累');
  await page.getByRole('button', { name: '发送想法' }).click();
  await expect(page.locator('.message.assistant')).toHaveCount(1);
  await page.getByRole('button', { name: '生成小说', exact: true }).click();
  await expect(page.locator('.story-chapter')).toHaveCount(2);
  await expect(page.locator('.story-chapter').first()).toContainText('模拟辅助影响');
  await expect(page.getByRole('button', { name: '返回对话' })).toBeVisible();
});

test('guided interview advances and records contextual answers', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '开始我的故事' }).click();
  await page.getByLabel('故事名称').fill(`世界时间线-${Date.now()}`);
  await page.getByRole('button', { name: '建立故事' }).click();
  await page.getByRole('button', { name: '开始问答引导' }).click();
  await expect(page.locator('.interview-question')).toContainText('什么时代');
  await page.getByLabel('你的想法').fill('一个渔村');
  await page.getByRole('button', { name: '发送想法' }).click();
  await expect(page.locator('.interview-question')).toContainText('最重要的一条规则');
  await page.locator('.guided-interview summary').click();
  await expect(page.locator('.guided-interview ol')).toContainText('回答：一个渔村');
  await page.reload();
  await page.getByRole('button', { name: '开始问答引导' }).click();
  await expect(page.locator('.interview-question')).toContainText('最重要的一条规则');
});
