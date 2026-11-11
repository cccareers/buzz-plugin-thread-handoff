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
