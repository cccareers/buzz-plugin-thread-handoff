import { test, expect, boot, message, ROOT_ID, CHANNEL_ID } from './fixtures/harness';

test('opens a modal, requests the correct reader, and disposes on Close', async ({ page }) => {
  await boot(page);
  await expect(page.getByRole('dialog', { name: 'Thread handoff', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  expect(await page.evaluate(() => window.harness.stats().threadCalls)).toEqual([{ channelId: CHANNEL_ID, rootId: ROOT_ID }]);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const stats = await page.evaluate(() => window.harness.stats());
  expect(stats.readers).toEqual([{ refreshes: 1, disposed: true, listeners: 0 }]);
  expect(Object.values(stats.subscriptions)).toEqual(expect.arrayContaining([0]));
  expect(Object.values(stats.subscriptions).every(value => value === 0)).toBe(true);
});

test('Escape dismisses and reopening creates a fresh reader', async ({ page }) => {
  await boot(page);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Open handoff' }).click();
  await expect(page.getByRole('textbox', { name: 'Markdown', exact: true })).toBeVisible();
  const stats = await page.evaluate(() => window.harness.stats());
  expect(stats.closeCalls).toBe(1);
  expect(stats.readers).toEqual([
    { refreshes: 1, disposed: true, listeners: 0 },
    { refreshes: 1, disposed: false, listeners: 1 },
  ]);
});

test('loading transitions to export when the thread snapshot arrives', async ({ page }) => {
  await boot(page, { thread: { status: 'loading', root: undefined } });
  await expect(page.getByText('Reading the thread…', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy Markdown', exact: true })).toHaveCount(0);
  await page.evaluate(root => window.harness.setThread({ status: 'ready', root }), message());
  await expect(page.getByRole('textbox', { name: 'Markdown', exact: true })).toHaveValue(/Ship the handoff plugin\./);
});

for (const scenario of ['construction failure', 'missing root', 'wrong root', 'read error'] as const) {
  test(`retry recovers from ${scenario}`, async ({ page }) => {
    const options = scenario === 'construction failure' ? { threadOpenError: 'Reader unavailable' }
      : { thread: scenario === 'missing root' ? { root: undefined } : scenario === 'wrong root'
        ? { root: message({ id: 'd'.repeat(64) }) } : { status: 'error', root: undefined, error: 'Disconnected' } };
    await boot(page, options);
    await expect(page.getByText('Buzz could not read this thread.', { exact: true })).toBeVisible();
    await page.evaluate(root => {
      window.harness.setFaults({ threadOpenError: undefined });
      window.harness.setThread({ status: 'ready', root }, false);
    }, message());
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Markdown', exact: true })).toBeVisible();
    const readers = await page.evaluate(() => window.harness.stats().readers);
    expect(readers.at(-1)).toEqual({ refreshes: 1, disposed: false, listeners: 1 });
    expect(readers.slice(0, -1).every((reader: any) => reader.disposed && reader.listeners === 0)).toBe(true);
  });
}

test('a rejected refresh exposes retry without an unhandled promise', async ({ page }) => {
  await boot(page, { thread: { status: 'loading', root: undefined }, refreshError: 'Network unavailable' });
  await expect(page.getByText('Buzz could not read this thread.', { exact: true })).toBeVisible();
  await page.evaluate(root => {
    window.harness.setFaults({ refreshError: undefined });
    window.harness.setThread({ status: 'ready', root }, false);
  }, message());
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Markdown', exact: true })).toBeVisible();
});

for (const fault of ['refreshThrow', 'subscribeError']) {
  test(`reader initialization ${fault} does not leak readers or subscriptions`, async ({ page }) => {
    await boot(page, { [fault]: 'Initialization failed' });
    await expect(page.getByText('Buzz could not read this thread.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    const readers = await page.evaluate(() => window.harness.stats().readers);
    expect(readers.length).toBe(1);
    expect(readers[0].disposed).toBe(true);
    expect(readers[0].listeners).toBe(0);
  });
}

test('profile lookup failure does not prevent export', async ({ page }) => {
  await boot(page, { ensureError: 'Profiles unavailable' });
  await expect(page.getByRole('textbox', { name: 'Markdown', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Copy Markdown', exact: true }).click();
  await expect(page.getByText('Markdown copied.', { exact: true })).toBeVisible();
});

test('a late refresh rejection cannot affect a reopened dialog', async ({ page }) => {
  await boot(page, { refreshDeferred: true });
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Open handoff' }).click();
  await expect(page.getByRole('textbox', { name: 'Markdown', exact: true })).toBeVisible();
  await page.evaluate(() => window.harness.rejectRefresh(0, 'Late failure'));
  await expect(page.getByRole('textbox', { name: 'Markdown', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
  const readers = await page.evaluate(() => window.harness.stats().readers);
  expect(readers[0]).toEqual({ refreshes: 1, disposed: true, listeners: 0 });
  expect(readers[1]).toEqual({ refreshes: 1, disposed: false, listeners: 1 });
});

test('a synchronous snapshot failure cleans up the allocated reader', async ({ page }) => {
  await boot(page, { snapshotError: 'Snapshot unavailable' });
  await expect(page.getByText('Buzz could not read this thread.', { exact: true })).toBeVisible();
  const readers = await page.evaluate(() => window.harness.stats().readers);
  expect(readers).toEqual([{ refreshes: 0, disposed: true, listeners: 0 }]);
});

test('StrictMode cleanup leaves one active reader and no listeners after dismissal', async ({ page }) => {
  await boot(page, { strictMode: true });
  await expect(page.getByRole('textbox', { name: 'Markdown', exact: true })).toBeVisible();
  const readers = await page.evaluate(() => window.harness.stats().readers);
  expect(readers.length).toBeGreaterThan(1);
  expect(readers.filter((reader: any) => !reader.disposed)).toHaveLength(1);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  const stats = await page.evaluate(() => window.harness.stats());
  expect(stats.readers.every((reader: any) => reader.disposed && reader.listeners === 0)).toBe(true);
  expect(Object.values(stats.subscriptions).every(value => value === 0)).toBe(true);
});
