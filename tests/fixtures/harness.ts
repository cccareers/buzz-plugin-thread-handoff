import { test as base, expect, type Page } from '@playwright/test';
export { message, agent, ROOT_ID, CHANNEL_ID, AUTHOR_ID, AGENT_ID } from './data';
export { expect };
export const test = base.extend<{ browserErrors: string[] }>({
  browserErrors: [async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await use(errors);
    expect(errors, 'No unhandled browser errors').toEqual([]);
    if (!page.isClosed()) {
      const rejections = await page.evaluate(() => window.harness?.stats().unhandledRejections ?? []);
      expect(rejections, 'No unhandled promise rejections').toEqual([]);
    }
  }, { auto: true }],
});
export async function boot(page: Page, options: Record<string, unknown> = {}) {
  await page.goto('/');
  await page.waitForFunction(() => typeof (window as any).boot === 'function');
  await page.evaluate(options => (window as any).boot(options), options);
}
declare global { interface Window { harness: any; boot: (options?: any) => void; } }
