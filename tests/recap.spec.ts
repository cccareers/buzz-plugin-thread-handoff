import { test, expect, boot, agent, message, ROOT_ID, CHANNEL_ID } from './fixtures/harness';

test('queues the edited, trimmed prompt once in the source thread', async ({ page }) => {
  const chosen = agent();
  await boot(page, { agents: [chosen], message: message({ id: 'b'.repeat(64), threadRootId: ROOT_ID }) });
  await page.getByRole('combobox', { name: 'Agent', exact: true }).selectOption(chosen.key);
  await page.getByRole('textbox', { name: 'Recap prompt', exact: true }).fill('  Decisions and owners, please.  ');
  await page.getByRole('button', { name: 'Request recap', exact: true }).click();
  await expect(page.getByText(`Recap request queued for ${chosen.name}.`, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Request recap', exact: true })).toBeDisabled();
  const stats = await page.evaluate(() => window.harness.stats());
  expect(stats.wakeCalls).toEqual([{ key: chosen.key, channel: CHANNEL_ID, root: ROOT_ID, text: 'Decisions and owners, please.' }]);
});

test('requires a selected agent and nonblank prompt; browser caps input length', async ({ page }) => {
  const chosen = agent();
  await boot(page, { agents: [chosen] });
  const request = page.getByRole('button', { name: 'Request recap', exact: true });
  await expect(request).toBeDisabled();
  await page.getByRole('combobox', { name: 'Agent', exact: true }).selectOption(chosen.key);
  await expect(request).toBeEnabled();
  const prompt = page.getByRole('textbox', { name: 'Recap prompt', exact: true });
  await prompt.fill(' \n ');
  await expect(request).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Copy recap prompt' })).toBeDisabled();
  await prompt.fill('x'.repeat(3001));
  await expect(prompt).toHaveValue('x'.repeat(3000));
});

for (const type of ['buzz.claude-code/claude-code', 'buzz.codex/codex', 'buzz.goose/goose']) {
  test(`supports local ${type} agents`, async ({ page }) => {
    const chosen = agent({ type });
    await boot(page, { agents: [chosen] });
    await page.getByRole('combobox', { name: 'Agent', exact: true }).selectOption(chosen.key);
    await expect(page.getByRole('button', { name: 'Request recap', exact: true })).toBeEnabled();
  });
}

const exclusions = [
  ['unsupported harness', { type: 'other/agent' }],
  ['remote agent', { place: 'elsewhere' }],
  ['other community', { relay: 'wss://other.example' }],
  ['malformed relay', { relay: 'not a URL' }],
  ['nonmember', { pubkey: 'f'.repeat(64) }],
] as const;
for (const [reason, patch] of exclusions) {
  test(`does not offer ${reason}`, async ({ page }) => {
    await boot(page, { agents: [agent(patch as any)] });
    await expect(page.getByRole('combobox', { name: 'Agent', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Request recap', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Copy recap prompt' })).toBeEnabled();
    expect((await page.evaluate(() => window.harness.stats())).wakeCalls).toEqual([]);
  });
}

for (const patch of [{ readOnly: true }, { archived: true }, { cached: true }, { members: [] }]) {
  test(`does not wake agents in unavailable channel ${JSON.stringify(patch)}`, async ({ page }) => {
    await boot(page, { agents: [agent()], channel: patch });
    await expect(page.getByRole('button', { name: 'Request recap', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Copy recap prompt' })).toBeEnabled();
  });
}

for (const patch of [{ status: 'connecting' }, { cached: true }, { origin: 'invalid' }]) {
  test(`does not wake through unavailable relay ${JSON.stringify(patch)}`, async ({ page }) => {
    await boot(page, { agents: [agent()], relay: patch as any });
    await expect(page.getByRole('button', { name: 'Request recap', exact: true })).toHaveCount(0);
  });
}

test('normalizes websocket origins, case, default ports, and trailing dots', async ({ page }) => {
  const chosen = agent({ relay: 'wss://BUZZ.EXAMPLE.:443/agent' });
  await boot(page, { agents: [chosen], relay: { origin: 'https://buzz.example/path' } });
  await page.getByRole('combobox', { name: 'Agent', exact: true }).selectOption(chosen.key);
  await expect(page.getByRole('button', { name: 'Request recap', exact: true })).toBeEnabled();
});

test('removes a stopped agent and restores eligibility on live roster changes', async ({ page }) => {
  const chosen = agent();
  await boot(page, { agents: [chosen] });
  await page.getByRole('combobox', { name: 'Agent', exact: true }).selectOption(chosen.key);
  await page.evaluate(() => window.harness.setAgents([]));
  await expect(page.getByRole('button', { name: 'Request recap', exact: true })).toHaveCount(0);
  await page.evaluate(value => window.harness.setAgents([JSON.parse(value)]), JSON.stringify(chosen));
  await expect(page.getByRole('button', { name: 'Request recap', exact: true })).toBeEnabled();
  await page.evaluate(() => window.harness.setChannel({ readOnly: true }));
  await expect(page.getByRole('button', { name: 'Request recap', exact: true })).toHaveCount(0);
  expect((await page.evaluate(() => window.harness.stats())).wakeCalls).toEqual([]);
});

test('surfaces wake failure and allows retry without losing the edited prompt', async ({ page }) => {
  const chosen = agent();
  await boot(page, { agents: [chosen], wakeError: 'Agent stopped' });
  await page.getByRole('combobox', { name: 'Agent', exact: true }).selectOption(chosen.key);
  await page.getByRole('textbox', { name: 'Recap prompt', exact: true }).fill('Summarize blockers');
  await page.getByRole('button', { name: 'Request recap', exact: true }).click();
  await expect(page.getByText('Agent stopped', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Recap prompt', exact: true })).toHaveValue('Summarize blockers');
  await page.evaluate(() => window.harness.setFaults({ wakeError: undefined }));
  await page.getByRole('button', { name: 'Request recap', exact: true }).click();
  await expect(page.getByText(`Recap request queued for ${chosen.name}.`, { exact: true })).toBeVisible();
});

for (const status of ['idle', 'loading', 'error'] as const) {
  test(`does not queue recap while thread is ${status}`, async ({ page }) => {
    const chosen = agent();
    await boot(page, { agents: [chosen], thread: { status } });
    await page.getByRole('combobox', { name: 'Agent', exact: true }).selectOption(chosen.key);
    await expect(page.getByRole('button', { name: 'Request recap', exact: true })).toBeDisabled();
    expect((await page.evaluate(() => window.harness.stats())).wakeCalls).toEqual([]);
  });
}

test('community switch removes export and recap controls', async ({ page }) => {
  await boot(page, { agents: [agent()] });
  await expect(page.getByRole('textbox', { name: 'Markdown', exact: true })).toBeVisible();
  await page.evaluate(() => window.harness.switchSession());
  await expect(page.getByText('The Buzz community changed. Open Thread handoff again from the message.')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Markdown', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Copy recap prompt' })).toHaveCount(0);
  expect((await page.evaluate(() => window.harness.stats())).wakeCalls).toEqual([]);
});

for (const changed of ['agent', 'channel', 'relay', 'thread'] as const) {
  test(`revalidates ${changed} immediately before wake even without a render`, async ({ page }) => {
    const chosen = agent();
    await boot(page, { agents: [chosen] });
    await page.getByRole('combobox', { name: 'Agent', exact: true }).selectOption(chosen.key);
    await page.evaluate(changed => {
      if (changed === 'agent') window.harness.setAgents([], false);
      if (changed === 'channel') window.harness.setChannel({ members: [] }, false);
      if (changed === 'relay') window.harness.setRelay({ cached: true }, false);
      if (changed === 'thread') window.harness.setThread({ status: 'error' }, false);
      [...document.querySelectorAll('button')].find(button => button.textContent === 'Request recap')!.click();
    }, changed);
    expect((await page.evaluate(() => window.harness.stats())).wakeCalls).toEqual([]);
  });
}

test('copies the edited recap prompt and selects it when both clipboard methods fail', async ({ page }) => {
  await boot(page, { agents: [], clipboard: 'reject', execCopy: false });
  await page.getByRole('textbox', { name: 'Recap prompt', exact: true }).fill('My custom recap request');
  await page.getByRole('button', { name: 'Copy recap prompt' }).click();
  await expect(page.getByText('Clipboard unavailable. Use your copy shortcut on the selected prompt.', { exact: true })).toBeVisible();
  expect(await page.getByRole('textbox', { name: 'Recap prompt', exact: true }).evaluate((field: HTMLTextAreaElement) => ({
    focused: document.activeElement === field, selected: field.value.slice(field.selectionStart, field.selectionEnd),
  }))).toEqual({ focused: true, selected: 'My custom recap request' });
});

test('double-clicking a recap request queues only one wake', async ({ page }) => {
  const chosen = agent();
  await boot(page, { agents: [chosen] });
  await page.getByRole('combobox', { name: 'Agent', exact: true }).selectOption(chosen.key);
  await page.getByRole('button', { name: 'Request recap', exact: true }).dblclick();
  expect((await page.evaluate(() => window.harness.stats())).wakeCalls).toHaveLength(1);
});

test('pending clipboard denial never silently copies subsequent prompt edits', async ({ page }) => {
  await boot(page, { clipboardDeferred: true, execCopy: true });
  const prompt = page.getByRole('textbox', { name: 'Recap prompt', exact: true });
  await prompt.fill('Prompt at the time of the click');
  await page.getByRole('button', { name: 'Copy recap prompt' }).click();
  await prompt.fill('New edits to preserve');
  await page.evaluate(() => window.harness.rejectClipboard(0));
  await expect(page.getByText('Text changed while copying. Please copy again.', { exact: true })).toBeVisible();
  await expect(prompt).toHaveValue('New edits to preserve');
  expect((await page.evaluate(() => window.harness.stats())).clipboardWrites).toEqual([]);
  await page.evaluate(() => window.harness.setFaults({ clipboardDeferred: false }));
  await page.getByRole('button', { name: 'Copy recap prompt' }).click();
  expect((await page.evaluate(() => window.harness.stats())).clipboardWrites).toEqual(['New edits to preserve']);
});
