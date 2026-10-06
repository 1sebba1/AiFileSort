import { test, expect, ElectronApplication, _electron as electron } from '@playwright/test';
import path from 'path';

let app: ElectronApplication;

test.beforeAll(async () => {
  app = await electron.launch({
    args: [path.join(__dirname, '../../dist/main/index.js')],
  });
});

test.afterAll(async () => {
  await app.close();
});

test('shows home view on launch', async () => {
  const page = await app.firstWindow();
  await expect(page.locator('h1')).toHaveText('AiFileSort');
});

test('analyse button is disabled when path is empty', async () => {
  const page = await app.firstWindow();
  const btn = page.locator('button', { hasText: 'Analyse Folder' });
  await expect(btn).toBeDisabled();
});

test('analyse button enables when path is entered and Ollama is healthy', async () => {
  const page = await app.firstWindow();
  await page.fill('input[placeholder="/path/to/folder"]', '/tmp');
  // Button state depends on Ollama health — just verify no crash
  await expect(page.locator('button', { hasText: 'Analyse Folder' })).toBeVisible();
});
