# Thread Handoff

Use a message’s **⋯ → Thread handoff…** action in Buzz desktop v1.0.0. Choose it on a thread starter or any published reply to open the same handoff.

- **Copy Markdown** exports the starter and up to 20 replies from Buzz’s bounded thread window, with display names, UTC timestamps, and Buzz source links. The coverage note records the number included and any limits the reader reported. Long bodies are excerpted at 3,000 characters. Open the source message for attachments or the full body. Buzz links use the recipient’s selected community.
- **Request recap** lets you edit a prompt and choose a running local Claude Code, Codex, or Goose agent listed in the channel roster. Buzz queues the wake in the source thread. The agent receives a plugin-originated request, and its harness controls the response. **Copy recap prompt** lets you paste the prompt into a reply and mention an agent yourself.

If Buzz cannot write to the clipboard, the dialog selects the text so you can use your usual copy shortcut.

## Install in Buzz desktop v1.0.0

For a local checkout, open **Settings → Plugins → Manage plugins → Add**, choose **Browse** under **Add from folder**, and select this repository’s root. Review the plugin and select **Install plugin**.

Once the GitHub repository is available, paste the following URL into **Git or GitHub repository** in the same dialog, select **Find**, then review and install the plugin.

`https://github.com/cccareers/buzz-plugin-thread-handoff`

## Build

Use Node.js 20 or later.

```sh
npm ci
npm run build
```

The build writes the self-contained `plugin.js` beside `manifest.json`. Commit the rebuilt file when you change the plugin. Buzz’s Git installer reads the committed bundle. `npm ci` also installs the pinned Buzz author types for editors.

## Automated validation

```sh
npm ci
npx playwright install --with-deps chromium firefox webkit
npm run typecheck
npm test
```

`npm test` rebuilds the installer bundle and runs the end-to-end suite in Chromium, Firefox, and WebKit. For a faster local run, use `npm run test:chromium`. To run a focused scenario after building, use `npx playwright test tests/recap.spec.ts --project=chromium`. Open failure traces with `npx playwright show-report`.

The browser harness imports the actual `plugin.js` with real React and native dialogs. It simulates only the injected Buzz services and clipboard outcomes, using the pinned author SDK contracts. Tests cover action eligibility, starter/reply navigation, bounded Markdown exports, author updates, attachments, timestamps, clipboard fallback, agent eligibility, edited recap requests, duplicate prevention, live community changes, and reader failure/retry/cleanup. Each test fails on unhandled browser errors. CI also checks that the committed installer bundle matches the source.

These tests validate plugin behavior at the Buzz API boundary. They do not launch Buzz desktop, contact a relay, or run an external agent. Before a release, install the plugin in Buzz desktop v1.0.0 and check a starter and reply export, OS clipboard permissions, and a recap request to a local agent in a disposable thread. Confirm the request appears in that source thread and inspect the agent's response; queueing alone does not guarantee a recap.
