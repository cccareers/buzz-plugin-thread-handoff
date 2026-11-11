import { test, expect, boot, message, ROOT_ID, CHANNEL_ID } from './fixtures/harness';

const reply = (n: number, patch = {}) => message({ id: n.toString(16).padStart(64, '0'), threadRootId: ROOT_ID, content: `Reply number ${n}.`, createdAt: 1_700_000_000 + n, ...patch });

test('exports a complete readable Markdown document with source links and UTC timestamps', async ({ page }) => {
  const root = message({ authorId: 'alice', content: 'Decision: ship\r\nOwner: Alice\rNext: verify', createdAt: 1_700_000_000, createdAtMs: 1_700_000_000_123, edited: true });
  await boot(page, { channel: { name: 'Engineering' }, thread: { root, replies: [reply(1, { authorId: 'bob' })] }, profiles: { alice: { name: 'Alice' }, bob: { name: 'Bob' } } });
  const value = await page.getByRole('textbox', { name: 'Markdown', exact: true }).inputValue();
  expect(value).toBe(`# Thread handoff · Engineering\n\nIncludes the thread starter and 1 reply, in chronological order. Buzz reported no continuation for this read.\n\n### Thread starter · Alice · 2023-11-14T22:13:20.123Z\n\n[Open message in Buzz](buzz://message?channel=${CHANNEL_ID}&id=${ROOT_ID}&thread=${ROOT_ID}) · Edited\n\n> Decision: ship\n> Owner: Alice\n> Next: verify\n\n### Bob · 2023-11-14T22:13:21.000Z\n\n[Open message in Buzz](buzz://message?channel=${CHANNEL_ID}&id=${reply(1).id}&thread=${ROOT_ID})\n\n> Reply number 1.\n`);
});

for (const count of [0, 20, 21, 23]) {
  test(`bounded export of ${count} published replies keeps the most recent twenty`, async ({ page }) => {
    await boot(page, { thread: { root: message({ replyCount: count }), replies: Array.from({ length: count }, (_, n) => reply(n + 1)) } });
    const value = await page.getByRole('textbox', { name: 'Markdown', exact: true }).inputValue();
    expect(value.match(/^### /gm)).toHaveLength(1 + Math.min(count, 20));
    for (let n = 1; n <= count; n++) {
      if (n <= count - 20) expect(value).not.toContain(`> Reply number ${n}.`);
      else expect(value).toContain(`> Reply number ${n}.`);
    }
    if (count > 20) expect(value).toContain(`${count - 20} earlier ${count === 21 ? 'reply was' : 'replies were'} left out by the export limit.`);
    if (count > 1) expect(value.indexOf(`> Reply number ${Math.max(1, count - 19)}.`)).toBeLessThan(value.indexOf(`> Reply number ${count}.`));
  });
}

for (const [label, snapshot, expected] of [
  ['failed partial read', { status: 'error' }, 'The thread read could not confirm coverage beyond these messages.'],
  ['forward continuation', { direction: 'forward', canLoadMore: true }, 'Newer replies may be missing.'],
  ['forward limited range', { direction: 'forward', limited: true }, 'Newer replies may be missing.'],
  ['backward continuation', { direction: 'older', canLoadMore: true }, 'Earlier replies may exist outside the loaded window.'],
  ['backward limited range', { direction: 'older', limited: true }, 'Earlier replies may exist outside the loaded window.'],
  ['reply count mismatch', { root: message({ replyCount: 99 }) }, 'Buzz reports more replies than this read returned.'],
  ['complete read', { root: message({ replyCount: 0 }), replies: [] }, 'Buzz reported no continuation for this read.'],
] as const) {
  test(`coverage accurately describes ${label}`, async ({ page }) => {
    await boot(page, { thread: snapshot });
    expect(await page.getByRole('textbox', { name: 'Markdown', exact: true }).inputValue()).toContain(expected);
    await expect(page.getByRole('status').filter({ hasText: expected })).toBeVisible();
  });
}

test('unpublished replies do not consume the twenty-reply limit', async ({ page }) => {
  const published = Array.from({ length: 20 }, (_, n) => reply(n + 1));
  await boot(page, { thread: { root: message({ replyCount: 20 }), replies: [...published, reply(21, { delivery: 'sending' }), reply(22, { delivery: 'failed' }), reply(23, { delivery: 'unknown' }), reply(24, { id: 'pending-local' })] } });
  const value = await page.getByRole('textbox', { name: 'Markdown', exact: true }).inputValue();
  expect(value).toContain('20 replies');
  expect(value).toContain('Unpublished replies are excluded.');
  expect(value).toContain('> Reply number 1.');
  for (const n of [21, 22, 23, 24]) expect(value).not.toContain(`> Reply number ${n}.`);
});

test('long Unicode bodies are bounded without splitting emoji and Markdown stays quoted', async ({ page }) => {
  await boot(page, { thread: { root: message({ content: 'a'.repeat(2999) + '😀tail\n# Not a heading' }), replies: [reply(1, { content: '# heading\n\n<script>alert(1)</script>\n```\ncode\n```' })] } });
  const value = await page.getByRole('textbox', { name: 'Markdown', exact: true }).inputValue();
  expect(value).toContain('> ' + 'a'.repeat(2999) + '\n\n*Message text shortened for this export.*');
  expect(value).not.toContain('tail');
  expect(value.isWellFormed()).toBe(true);
  expect(value).toContain('> # heading\n> \n> <script>alert(1)</script>\n> ```\n> code\n> ```');
  await expect(page.locator('script').filter({ hasText: 'alert(1)' })).toHaveCount(0);
});

test('escapes display names, qualifiers and channel names as literal headings', async ({ page }) => {
  await boot(page, { channel: { name: '  Team\n[red] *bold*  ' }, thread: { root: message({ authorId: 'alice' }) }, names: { alice: { name: ' Alice\n[Admin] ', qualifier: 'ops_*' } } });
  const value = await page.getByRole('textbox', { name: 'Markdown', exact: true }).inputValue();
  expect(value).toContain('# Thread handoff · Team \\[red\\] \\*bold\\*');
  expect(value).toContain('Thread starter · Alice \\[Admin\\] \\(ops\\_\\*\\) ·');
});

test('unknown author, empty content and attachments have explicit fallbacks', async ({ page }) => {
  await boot(page, { thread: { root: message({ authorId: '1234567890abcdef', content: ' \n ' }), replies: [reply(1, { content: '', attachments: [{ url: 'https://example.test/file' }] as any }), reply(2, { content: 'See files', attachments: [{ url: 'https://example.test/a' }, { url: 'https://example.test/b' }] as any }), reply(3, { createdAt: 1e20 })] }, profiles: {}, names: {} });
  const value = await page.getByRole('textbox', { name: 'Markdown', exact: true }).inputValue();
  expect(value).toContain('Unknown author \\(1234567890\\)');
  expect(value).toContain('*No message text.*');
  expect(value).toContain('*1 attachment available in the source message.*');
  expect(value).toContain('> See files\n\n*2 attachments available in the source message.*');
  expect(value).toContain('Time unavailable');
  expect(value).not.toContain('https://example.test');
});

for (const [clipboard, execCopy, notice] of [
  ['success', false, 'Markdown copied.'],
  ['reject', true, 'Markdown copied.'],
  ['reject', false, 'Clipboard unavailable. Use your copy shortcut on the selected Markdown.'],
] as const) {
  test(`Markdown clipboard ${clipboard}, legacy copy ${execCopy}`, async ({ page }) => {
    await boot(page, { clipboard, execCopy });
    const field = page.getByRole('textbox', { name: 'Markdown', exact: true });
    const expected = await field.inputValue();
    await page.getByRole('button', { name: 'Copy Markdown', exact: true }).click();
    await expect(page.getByText(notice, { exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.harness.stats().clipboardWrites)).toEqual(clipboard === 'success' || execCopy ? [expected] : []);
    expect(await page.evaluate(() => window.harness.stats().copyAttempts)).toEqual([expected]);
    if (clipboard === 'reject') {
      await expect(field).toBeFocused();
      expect(await field.evaluate((el: HTMLTextAreaElement) => el.value.slice(el.selectionStart, el.selectionEnd))).toBe(expected);
    }
  });
}

test('profile updates replace fallback names in an already open export', async ({ page }) => {
  await boot(page, { profiles: {}, names: {}, thread: { root: message({ authorId: 'alice-author' }) } });
  const field = page.getByRole('textbox', { name: 'Markdown', exact: true });
  await expect(field).toHaveValue(/Unknown author/);
  await page.evaluate(() => window.harness.setProfiles({ 'alice-author': { name: 'Alice Updated' } }));
  await expect(field).toHaveValue(/Thread starter · Alice Updated ·/);
});

test('independent name updates refresh author labels and qualifiers', async ({ page }) => {
  await boot(page, { profiles: { alice: { name: 'Profile Alice' } }, names: { alice: { name: 'Alice', qualifier: 'first' } }, thread: { root: message({ authorId: 'alice' }) } });
  const field = page.getByRole('textbox', { name: 'Markdown', exact: true });
  await expect(field).toHaveValue(/Alice \\\(first\\\)/);
  await page.evaluate(() => window.harness.setNames({ alice: { name: 'Alice Renamed', qualifier: 'second' } }));
  await expect(field).toHaveValue(/Alice Renamed \\\(second\\\)/);
  await page.getByRole('button', { name: 'Copy Markdown', exact: true }).click();
  expect(await page.evaluate(() => window.harness.stats().clipboardWrites)).toEqual([await field.inputValue()]);
});

test('long Unicode display names remain valid text when bounded', async ({ page }) => {
  const longName = 'a'.repeat(199) + '😀tail';
  await boot(page, { channel: { name: longName }, names: { alice: { name: longName } }, thread: { root: message({ authorId: 'alice' }) } });
  const value = await page.getByRole('textbox', { name: 'Markdown', exact: true }).inputValue();
  expect(value.isWellFormed()).toBe(true);
  expect(value).not.toContain('tail');
});

test('source links encode channel identifiers without adding query parameters', async ({ page }) => {
  const channelId = 'team & design/#東京?thread=other';
  await boot(page, { message: message({ channelId }), channel: { id: channelId, name: 'Design' }, thread: { root: message({ channelId }), replies: [reply(1, { channelId })] } });
  const value = await page.getByRole('textbox', { name: 'Markdown', exact: true }).inputValue();
  const links = [...value.matchAll(/\[Open message in Buzz\]\(([^)]+)\)/g)].map(match => new URL(match[1]));
  expect(links).toHaveLength(2);
  for (const link of links) {
    expect(link.protocol).toBe('buzz:');
    expect(link.hostname).toBe('message');
    expect([...link.searchParams.keys()]).toEqual(['channel', 'id', 'thread']);
    expect(link.searchParams.get('channel')).toBe(channelId);
    expect(link.searchParams.get('thread')).toBe(ROOT_ID);
  }
  expect(links.map(link => link.searchParams.get('id'))).toEqual([ROOT_ID, reply(1).id]);
});

test('supports a host without the optional names service', async ({ page }) => {
  await boot(page, { names: null });
  await expect(page.getByRole('textbox', { name: 'Markdown', exact: true })).toHaveValue(/Thread starter · Alice ·/);
});

for (const absent of [false, true]) {
  test(`manual copy fallback handles ${absent ? 'absent clipboard API' : 'throwing legacy copy'}`, async ({ page }) => {
    await boot(page, { clipboard: 'reject', execCopy: 'throw' });
    if (absent) await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }));
    const field = page.getByRole('textbox', { name: 'Markdown', exact: true });
    const value = await field.inputValue();
    await page.getByRole('button', { name: 'Copy Markdown', exact: true }).click();
    await expect(page.getByText('Clipboard unavailable. Use your copy shortcut on the selected Markdown.', { exact: true })).toBeVisible();
    await expect(field).toBeFocused();
    expect(await field.evaluate((el: HTMLTextAreaElement) => el.value.slice(el.selectionStart, el.selectionEnd))).toBe(value);
  });
}

test('pending clipboard denial never silently copies a changed export', async ({ page }) => {
  await boot(page, { clipboardDeferred: true, execCopy: true });
  await page.getByRole('button', { name: 'Copy Markdown', exact: true }).click();
  await page.evaluate(() => window.harness.setChannel({ name: 'Renamed channel' }));
  await page.evaluate(() => window.harness.rejectClipboard(0));
  await expect(page.getByText('Text changed while copying. Please copy again.', { exact: true })).toBeVisible();
  expect((await page.evaluate(() => window.harness.stats())).clipboardWrites).toEqual([]);
});
