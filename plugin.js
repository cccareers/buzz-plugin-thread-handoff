// src/plugin.ts
var inject = ["react", "conversation", "relay", "agents"];
var MAX_REPLIES = 20;
var MAX_BODY_LENGTH = 3e3;
var MAX_PROMPT_LENGTH = 3e3;
var EVENT_ID = /^[a-f0-9]{64}$/;
var WAKE_TYPES = ["buzz.claude-code/claude-code", "buzz.codex/codex", "buzz.goose/goose"];
function published(message) {
  return EVENT_ID.test(message.id) && (!message.delivery || message.delivery === "accepted" || message.delivery === "seen");
}
function sourceLink(message, root) {
  const query = new URLSearchParams({ channel: message.channelId, id: message.id, thread: root });
  return `buzz://message?${query}`;
}
function inlineText(value) {
  return value.replace(/\s+/g, " ").trim().slice(0, 200).replace(/[\\`*_{}\[\]()#+\-.!<>|&]/g, "\\$&");
}
function messageBody(message) {
  const body = message.content.trim();
  const excerpt = body.slice(0, MAX_BODY_LENGTH).replace(/[\uD800-\uDBFF]$/, "");
  const quote = excerpt.replace(/\r\n?/g, "\n").split("\n").map((line) => `> ${line}`).join("\n");
  const attachments = message.attachments.length;
  return [
    body && quote,
    body.length > excerpt.length && "*Message text shortened for this export.*",
    attachments > 0 && `*${attachments} ${attachments === 1 ? "attachment" : "attachments"} available in the source message.*`,
    !body && !attachments && "*No message text.*"
  ].filter(Boolean).join("\n\n");
}
function selectThread(snapshot, rootId) {
  const root = snapshot.root;
  if (!root || root.id !== rootId || !published(root)) return;
  const replies = snapshot.replies.filter(published);
  const recent = replies.slice(-MAX_REPLIES);
  const coverage = [
    `Includes the thread starter and ${recent.length} ${recent.length === 1 ? "reply" : "replies"}, in chronological order.`
  ];
  if (replies.length > recent.length) {
    const omitted = replies.length - recent.length;
    coverage.push(`${omitted} earlier ${omitted === 1 ? "reply was" : "replies were"} left out by the export limit.`);
  }
  if (snapshot.status !== "ready") {
    coverage.push("The thread read could not confirm coverage beyond these messages.");
  } else if (snapshot.direction === "forward" && (snapshot.canLoadMore || snapshot.limited)) {
    coverage.push("This relay returned a bounded range starting near the thread starter. Newer replies may be missing.");
  } else if (snapshot.canLoadMore || snapshot.limited) {
    coverage.push("Earlier replies may exist outside the loaded window.");
  } else if (root.replyCount > replies.length) {
    coverage.push("Buzz reports more replies than this read returned.");
  } else {
    coverage.push("Buzz reported no continuation for this read.");
  }
  if (replies.length < snapshot.replies.length) coverage.push("Unpublished replies are excluded.");
  return { rows: [root, ...recent], coverage: coverage.join(" ") };
}
function relayOrigin(address) {
  if (!address) return;
  try {
    const url = new URL(address);
    if (url.protocol === "wss:") url.protocol = "https:";
    if (url.protocol === "ws:") url.protocol = "http:";
    if (url.hostname.endsWith(".")) url.hostname = url.hostname.slice(0, -1);
    return url.origin;
  } catch {
    return void 0;
  }
}
function markdown(rows, coverage, channelName, session) {
  const root = rows[0];
  if (!root) return "";
  const authors = [...new Set(rows.map((row) => row.authorId))];
  const findName = session.names?.scope(authors);
  const profiles = session.profiles.snapshot();
  const blocks = rows.map((row, index) => {
    const name = findName?.(row.authorId);
    const author = name?.name || profiles.get(row.authorId)?.name || `Unknown author (${row.authorId.slice(0, 10)})`;
    const label = inlineText(name?.qualifier ? `${author} (${name.qualifier})` : author);
    const date = new Date(row.createdAtMs ?? row.createdAt * 1e3);
    const time = Number.isNaN(date.getTime()) ? "Time unavailable" : date.toISOString();
    return [
      `### ${index === 0 ? "Thread starter \xB7 " : ""}${label} \xB7 ${time}`,
      `[Open message in Buzz](${sourceLink(row, root.id)})${row.edited ? " \xB7 Edited" : ""}`,
      messageBody(row)
    ].join("\n\n");
  });
  return [`# Thread handoff \xB7 ${inlineText(channelName)}`, coverage, ...blocks].join("\n\n") + "\n";
}
async function copyText(value, field) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    if (!field?.isConnected) return false;
    field.focus();
    field.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    }
  }
}
var apply = (ctx) => {
  const { react: React, agents, relay, conversation } = ctx;
  const h = React.createElement;
  function eligibleAgents(session, channelId) {
    const connection = relay.snapshot();
    const channel = session.channels.get?.(channelId);
    const origin = relayOrigin(connection.origin);
    if (!origin || connection.session !== session || connection.status !== "ready" || connection.cached || !channel || channel.readOnly || channel.archived || channel.cached || !channel.members) return [];
    return agents.snapshot().running.filter(
      (agent) => agent.place === "here" && WAKE_TYPES.includes(agent.type) && relayOrigin(agent.relay) === origin && channel.members?.includes(agent.pubkey)
    );
  }
  const fieldStyle = {
    display: "block",
    boxSizing: "border-box",
    width: "100%",
    marginTop: 6,
    padding: 10,
    border: "1px solid var(--border-standard, #888)",
    borderRadius: 7,
    background: "var(--surface-inset, Canvas)",
    color: "inherit",
    font: "inherit"
  };
  const buttonStyle = {
    padding: "6px 11px",
    border: "1px solid var(--border-standard, #888)",
    borderRadius: 7,
    background: "var(--surface-base, ButtonFace)",
    color: "inherit",
    font: "inherit"
  };
  const actionsStyle = { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 };
  function Handoff({ message, session, close }) {
    const channelId = message.channelId;
    const rootId = message.threadRootId ?? message.id;
    const title = React.useId();
    const dialog = React.useRef(null);
    const markdownField = React.useRef(null);
    const promptField = React.useRef(null);
    const view = React.useRef(void 0);
    const [snapshot, setSnapshot] = React.useState();
    const [openFailed, setOpenFailed] = React.useState(false);
    const [readAttempt, retryRead] = React.useState(0);
    const [selectedAgent, selectAgent] = React.useState("");
    const [prompt, setPrompt] = React.useState(() => [
      "Please write a concise handoff recap draft as your reply in this Buzz thread. Do not post it anywhere else. Cover decisions, current status, open questions and blockers, and next steps. Include owners or dates when the thread names them, and link to the messages that support the recap. Flag any missing context.",
      `Thread: ${sourceLink({ channelId, id: rootId }, rootId)}`
    ].join("\n\n"));
    const [copyNotice, setCopyNotice] = React.useState("");
    const [recapNotice, setRecapNotice] = React.useState("");
    const [queued, setQueued] = React.useState(false);
    React.useSyncExternalStore(agents.subscribe, agents.snapshot, agents.snapshot);
    React.useSyncExternalStore(relay.subscribe, relay.snapshot, relay.snapshot);
    React.useSyncExternalStore(session.channels.subscribeList, session.channels.list, session.channels.list);
    React.useSyncExternalStore(session.profiles.subscribe, session.profiles.snapshot, session.profiles.snapshot);
    React.useLayoutEffect(() => {
      const modal = dialog.current;
      modal?.showModal();
      return () => {
        if (modal?.open) modal.close();
      };
    }, []);
    React.useEffect(() => {
      setSnapshot(void 0);
      setOpenFailed(false);
      try {
        const reader = session.thread(channelId, rootId);
        view.current = reader;
        const update = () => setSnapshot(reader.snapshot());
        const unsubscribe = reader.subscribe(update);
        update();
        void reader.refresh();
        return () => {
          view.current = void 0;
          unsubscribe();
          reader.dispose();
        };
      } catch {
        setOpenFailed(true);
      }
    }, [session, channelId, rootId, readAttempt]);
    const live = relay.snapshot().session === session;
    const thread = live && snapshot && snapshot.status !== "loading" && snapshot.status !== "idle" ? selectThread(snapshot, rootId) : void 0;
    const authorIds = thread ? [...new Set(thread.rows.map((row) => row.authorId))].join(" ") : "";
    React.useEffect(() => {
      if (authorIds) void session.profiles.ensure(authorIds.split(" ")).catch(() => {
      });
    }, [session, authorIds]);
    const channelName = session.channels.get?.(channelId)?.name || channelId;
    const exportText = thread ? markdown(thread.rows, thread.coverage, channelName, session) : "";
    const options = eligibleAgents(session, channelId);
    const chosen = options.find((agent) => agent.key === selectedAgent);
    const queueRecap = () => {
      const current = view.current?.snapshot();
      if (queued || !prompt.trim() || current?.status !== "ready" || !selectThread(current, rootId)) return;
      const agent = eligibleAgents(session, channelId).find((candidate) => candidate.key === selectedAgent);
      if (!agent) {
        setRecapNotice("This agent is no longer available for this thread. You can copy the recap prompt.");
        return;
      }
      try {
        agents.wake(agent.key, { channel: channelId, root: rootId, text: prompt.trim() });
        setQueued(true);
        setRecapNotice(`Recap request queued for ${agent.name}.`);
      } catch (error) {
        setRecapNotice(error instanceof Error ? error.message : "Buzz could not queue the recap request.");
      }
    };
    return h(
      "dialog",
      {
        ref: dialog,
        "aria-labelledby": title,
        onCancel: (event) => {
          event.preventDefault();
          close();
        },
        style: {
          width: "min(620px, calc(100vw - 40px))",
          maxHeight: "calc(100vh - 40px)",
          boxSizing: "border-box",
          overflow: "auto",
          padding: 20,
          border: "1px solid var(--border-standard, #888)",
          borderRadius: 12,
          background: "var(--surface-panel, Canvas)",
          color: "var(--text-standard, CanvasText)"
        }
      },
      h(
        "header",
        { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 } },
        h("h2", { id: title, style: { margin: 0 } }, "Thread handoff"),
        h("button", { type: "button", autoFocus: true, onClick: close, style: buttonStyle }, "Close")
      ),
      thread ? h(
        "section",
        { "aria-label": "Thread Markdown" },
        h("p", { role: "status" }, thread.coverage),
        h("label", null, "Markdown", h("textarea", { ref: markdownField, readOnly: true, value: exportText, rows: 8, style: fieldStyle })),
        h("div", { style: actionsStyle }, h("button", {
          type: "button",
          style: buttonStyle,
          onClick: async () => {
            if (relay.snapshot().session !== session || !view.current || !selectThread(view.current.snapshot(), rootId)) return;
            const copied = await copyText(exportText, markdownField.current);
            setCopyNotice(copied ? "Markdown copied." : "Clipboard unavailable. Use your copy shortcut on the selected Markdown.");
          }
        }, "Copy Markdown")),
        h("p", { role: "status" }, copyNotice)
      ) : h(
        "section",
        null,
        h("p", { role: "status" }, !live ? "The Buzz community changed. Open Thread handoff again from the message." : openFailed || snapshot?.status === "error" || snapshot?.status === "ready" ? "Buzz could not read this thread." : "Reading the thread\u2026"),
        live && (openFailed || snapshot?.status === "error" || snapshot?.status === "ready") && h("button", { type: "button", style: buttonStyle, onClick: () => retryRead((attempt) => attempt + 1) }, "Retry")
      ),
      live && h(
        "section",
        { "aria-label": "Recap request", style: { marginTop: 18 } },
        h("label", null, "Recap prompt", h("textarea", {
          ref: promptField,
          value: prompt,
          rows: 4,
          maxLength: MAX_PROMPT_LENGTH,
          style: fieldStyle,
          onChange: (event) => setPrompt(event.currentTarget.value)
        })),
        options.length ? h("label", { style: { display: "block", marginTop: 12 } }, "Agent", h(
          "select",
          {
            value: chosen?.key ?? "",
            style: fieldStyle,
            onChange: (event) => selectAgent(event.currentTarget.value)
          },
          h("option", { value: "" }, "Choose an agent"),
          ...options.map((agent) => h("option", { key: agent.key, value: agent.key }, agent.name))
        )) : h("p", null, "Copy the prompt and use it in a reply to an agent in this thread."),
        h(
          "div",
          { style: actionsStyle },
          h("button", {
            type: "button",
            style: buttonStyle,
            disabled: !prompt.trim(),
            onClick: async () => {
              const copied = await copyText(prompt, promptField.current);
              setRecapNotice(copied ? "Recap prompt copied." : "Clipboard unavailable. Use your copy shortcut on the selected prompt.");
            }
          }, "Copy recap prompt"),
          options.length > 0 && h("button", {
            type: "button",
            style: buttonStyle,
            disabled: snapshot?.status !== "ready" || !thread || !chosen || queued || !prompt.trim(),
            onClick: queueRecap
          }, "Request recap")
        ),
        h("p", { role: "status" }, recapNotice)
      )
    );
  }
  conversation.registerMessageAction({
    id: "thread-handoff",
    title: "Thread handoff\u2026",
    matches(message, session) {
      const kind = session.channels.get?.(message.channelId)?.channelType;
      return !!session.scope && published(message) && !message.membership && !message.huddle && EVENT_ID.test(message.threadRootId ?? message.id) && (!!message.threadRootId || message.replyCount > 0 || kind !== "dm" && kind !== "solo" && kind !== "system");
    },
    component: Handoff
  });
};
export {
  apply,
  inject
};
