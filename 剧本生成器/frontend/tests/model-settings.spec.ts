import { expect, test } from '@playwright/test';

test('model setup button opens a private key form and handles connection errors', async ({ page }, info) => {
  await page.route('**/api/v1/model/connect', route => route.fulfill({status:502, contentType:'application/json', body: JSON.stringify({error:{code:'MODEL_AUTH_FAILED',message:'DeepSeek 密钥无效或没有访问权限。'}})}));
  await page.goto('/');
  await page.getByRole('button', {name:'接入模型 API', exact:true}).click();
  const dialog = page.getByRole('dialog', {name:'接入模型 API'});
  await expect(dialog).toBeVisible();
  await expect(page.getByLabel('DeepSeek API Key')).toHaveAttribute('type','password');
  await page.getByLabel('DeepSeek API Key').fill('invalid-demo-key');
  await page.getByRole('button', {name:'检查连接并启用'}).click();
  await expect(dialog.getByRole('alert')).toContainText('密钥无效');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path:`test-results/${info.project.name}-model-settings.png`});
  await page.getByRole('button', {name:'关闭模型设置'}).click();
  await page.getByRole('button', {name:'接入模型 API', exact:true}).click();
  await expect(page.getByLabel('DeepSeek API Key')).toHaveValue('');
});
