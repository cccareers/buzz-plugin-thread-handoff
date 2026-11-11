# Thread Handoff E2E Validation Plan

**Goal:** Validate the shipped plugin's documented workflows with repeatable browser tests, repair reproduced defects, and publish a monitored PR.

**Architecture:** Load the real self-contained plugin.js into Chromium with real React. A local mock Buzz host implements the pinned author SDK boundary and exposes deterministic snapshots, subscriptions, clipboard outcomes, and wake observations. No live agent receives a request during automated tests.

**Tech stack:** Playwright, React, esbuild, TypeScript, Node 20+.

**Behavior specification:** README.md and the vendored @buzz/author declaration contracts. This is validation of existing behavior, not a product redesign.

## Tasks

- [x] Harness: create tests/host and tests/fixtures, fixture builders, browser error capture, Playwright configuration, and npm scripts. Execute the committed bundle and verify its registration contract.
- [x] Export/action tests: exercise action visibility, starter/reply identity, Markdown content, the 20-reply and 3,000-character bounds, coverage disclosures, display names, links, timestamps, attachments, and clipboard fallbacks.
- [x] Recap/lifecycle tests: exercise all eligible-agent gates, live changes, prompt edits/limits, wake payload and failure/retry, duplicate prevention, reader errors/retry, disposal, and community changes.
- [x] Defects: demonstrate each failure before changing src/plugin.ts, make the smallest correction, rebuild plugin.js, and rerun the regression and full suite.
- [x] CI/docs: add clean-install build/type/test checks and document commands, coverage, and mock-host limitations.
- [x] Validation/review: run full suite, TypeScript checking, bundle consistency check, and independent code review; resolve findings.
- [x] Publish: commit, push, open and link PR, inspect initial checks/comments, then enable PR monitoring.

## Review focus

Reader construction/refresh failures must recover without leaked subscriptions or unhandled promises. Changing communities must remove stale actions. Agent/channel/relay changes must disable stale selections. Clipboard denial must select exactly the requested text. Tests must verify observable outcomes and payloads rather than reimplement plugin logic.

## Boundaries

Browser tests validate the plugin UI and host API interactions. They cannot prove actual Buzz installation, relay network behavior, operating-system clipboard permissions, or external agent responses. Keep those limits explicit in the PR and README.

## Validation evidence

98 scenarios passed in Chromium and WebKit (196 checks), including follow-up review coverage for non-stream replies and the exact reader root. The clipboard mock records the actual selection at copy time. Node.js v20.20.2 also passed the original 95 Chromium scenarios, build, and type checking. Source, host, fixtures, and specs pass TypeScript checking. Independent review found a clipboard permission race; its failing browser regressions now pass. Initial regression runs also demonstrated stale names, split Unicode labels, rejected refreshes, and reader initialization leaks before the fixes. Firefox is enabled in CI but could not launch on this macOS host because its plugin-container process was denied access; Linux CI supplies the remaining engine validation.
