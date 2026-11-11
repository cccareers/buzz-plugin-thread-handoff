import { test, expect, boot, message, ROOT_ID, CHANNEL_ID } from './fixtures/harness';

// These cases exercise the shipped action registration in a real browser.
for (const delivery of [undefined, 'accepted', 'seen', 'sending', 'unknown', 'failed']) {
  test(`action publication gating: ${delivery ?? 'signed history'}`, async ({ page }) => {
    await boot(page, { open: false, message: message({ delivery: delivery as any }) });
    expect(await page.evaluate(value => window.harness.matches(value), { delivery })).toBe(delivery === undefined || delivery === 'accepted' || delivery === 'seen');
  });
}

for (const [label, patch] of [
  ['local optimistic id', { id: 'local-pending-1' }],
  ['uppercase id', { id: 'A'.repeat(64) }],
  ['short id', { id: 'a'.repeat(63) }],
  ['invalid canonical root', { threadRootId: 'not-published' }],
  ['membership announcement', { membership: { action: 'join', pubkey: 'member' } }],
  ['huddle announcement', { huddle: { room: 'room', state: 'started' } }],
] as const) {
  test(`action excludes ${label}`, async ({ page }) => {
    await boot(page, { open: false, message: message(patch as any) });
    expect(await page.evaluate(value => window.harness.matches(value), patch)).toBe(false);
  });
}

test('action requires an active community scope', async ({ page }) => {
  await boot(page, { open: false, scope: null });
  expect(await page.evaluate(() => window.harness.matches({}))).toBe(false);
});

for (const channelType of ['stream', 'dm', 'solo', 'system']) {
  for (const threaded of [false, true]) {
    test(`${channelType}: ${threaded ? 'existing thread' : 'standalone message'} action availability`, async ({ page }) => {
      await boot(page, { open: false, channel: { channelType }, message: message({ replyCount: threaded ? 1 : 0 }) });
      expect(await page.evaluate(replyCount => window.harness.matches({ replyCount }), threaded ? 1 : 0)).toBe(threaded || channelType === 'stream');
    });
  }
}

test('starter and a nested reply export the same canonical thread', async ({ page }) => {
  await boot(page);
  const starterExport = await page.getByRole('textbox', { name: 'Markdown', exact: true }).inputValue();
  await boot(page, { message: message({ id: 'c'.repeat(64), threadRootId: ROOT_ID, replyParentId: 'd'.repeat(64), replyCount: 0 }) });
  await expect(page.getByRole('textbox', { name: 'Markdown', exact: true })).toHaveValue(starterExport);
  expect(await page.evaluate(() => window.harness.stats().threadCalls)).toEqual([{ channelId: CHANNEL_ID, rootId: ROOT_ID }]);
  const prompt = await page.getByRole('textbox', { name: 'Recap prompt', exact: true }).inputValue();
  expect(prompt).toContain(`id=${ROOT_ID}&thread=${ROOT_ID}`);
});

test('installer bundle registers the handoff action with its required host services', async ({ page }) => {
  await boot(page, { open: false });
  const stats = await page.evaluate(() => window.harness.stats());
  expect(stats.inject).toEqual(['react', 'conversation', 'relay', 'agents']);
  expect(stats.registrations).toEqual([{ id: 'thread-handoff', title: 'Thread handoff…' }]);
  await page.getByRole('button', { name: 'Open handoff' }).click();
  await expect(page.getByRole('dialog', { name: 'Thread handoff', exact: true })).toBeVisible();
});

for (const channelType of ['dm', 'solo', 'system']) {
  test(`${channelType}: a published reply with no replies of its own remains eligible`, async ({ page }) => {
    await boot(page, { channel: { channelType }, message: message({ id: 'c'.repeat(64), threadRootId: ROOT_ID, replyCount: 0 }) });
    await expect(page.getByRole('dialog', { name: 'Thread handoff', exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.harness.stats().threadCalls)).toEqual([{ channelId: CHANNEL_ID, rootId: ROOT_ID }]);
  });
}
