import type { PluginModule, MessageAction, Agents, RelaySnapshot, Conversation, RelayData } from '@buzz/author';
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { apply, inject } from '/plugin.js';
import { message, agent, CHANNEL_ID, AUTHOR_ID, AGENT_ID } from '../fixtures/data';

// Only the injected Buzz boundary is simulated. React, dialog, DOM events and the shipped
// standalone module are real. Snapshots remain referentially stable until explicit emissions.
function store<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return { snapshot: () => value, subscribe: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); },
    set(next: T, notify = true) { value = next; if (notify) flushSync(() => listeners.forEach(fn => fn())); },
    count: () => listeners.size };
}
function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
}
const root = createRoot(document.getElementById('root')!);
(window as any).boot = (options: any = {}) => {
  const pendingRefreshes: Array<ReturnType<typeof deferred> | undefined> = [];
  const pendingClipboards: Array<ReturnType<typeof deferred>> = [];
  const selectedMessage = message(options.message);
  let faults = { clipboard: 'success', execCopy: true, ...options };
  let channel = { id: CHANNEL_ID, name: 'Engineering', channelType: 'stream', members: [AGENT_ID], ...options.channel };
  const channels = store({ status: 'ready', channels: [channel] });
  const profiles = store(new Map(Object.entries(options.profiles ?? { [AUTHOR_ID]: { name: 'Alice' } })));
  let names = options.names ?? {};
  const namesRevision = store(0);
  const thread = store({ status: 'ready', root: message(), replies: [], error: undefined,
    canLoadMore: false, limited: false, direction: 'older', ...options.thread });
  const agents = store<ReturnType<Agents['snapshot']>>({ status: 'ready', classifier: 'unavailable', agents: options.agents ?? [agent()], running: options.agents ?? [agent()], interrupted: [], teams: [] });
  const records: any = { wakeCalls: [], clipboardWrites: [], copyAttempts: [], readers: [], closeCalls: 0,
    ensureCalls: [], registrations: [], inject, threadCalls: [], unhandledRejections: [] };
  window.addEventListener('unhandledrejection', event => { records.unhandledRejections.push(String(event.reason?.message ?? event.reason)); });
  const session: any = {
    scope: options.scope === undefined ? 'community' : options.scope,
    channels: { get: (id: string) => id === channel.id ? channel : undefined, list: channels.snapshot, subscribeList: channels.subscribe },
    profiles: { snapshot: profiles.snapshot, subscribe: profiles.subscribe,
      ensure: async (ids: string[]) => { records.ensureCalls.push(ids); if (faults.ensureError) throw new Error(faults.ensureError); } },
    names: options.names === null ? undefined : { scope: () => (id: string) => names[id], snapshot: namesRevision.snapshot, subscribe: namesRevision.subscribe },
    thread(channelId: string, rootId: string) {
      records.threadCalls.push({ channelId, rootId });
      if (faults.threadOpenError) throw new Error(String(faults.threadOpenError));
      const record = { refreshes: 0, disposed: false, listeners: 0 };
      const readerIndex = records.readers.length;
      records.readers.push(record);
      return {
        snapshot() { if (faults.snapshotError) throw new Error(faults.snapshotError); return thread.snapshot(); },
        subscribe(fn: () => void) { if (faults.subscribeError) throw new Error(faults.subscribeError); record.listeners++; const unsub = thread.subscribe(fn); return () => { record.listeners--; unsub(); }; },
        refresh() {
          record.refreshes++;
          if (faults.refreshThrow) throw new Error(faults.refreshThrow);
          if (faults.refreshDeferred) {
            const pending = deferred();
            pendingRefreshes[readerIndex] = pending;
            return pending.promise;
          }
          return faults.refreshError ? Promise.reject(new Error(faults.refreshError)) : Promise.resolve();
        },
        loadMore: async () => {}, retarget: async () => 'unavailable', dispose() { record.disposed = true; },
      };
    },
  };
  const relay = store<RelaySnapshot>({ generation: 1, origin: 'wss://relay.example.test', status: 'ready', session, ...options.relay });
  let action: any;
  const injected = { react: React, conversation: { registerMessageAction(value: any) { action = value; records.registrations.push({ id: value.id, title: value.title }); } },
    relay: { snapshot: relay.snapshot, subscribe: relay.subscribe },
    agents: { snapshot: agents.snapshot, subscribe: agents.subscribe, wake(key: string, wake: any) {
      if (faults.wakeError) throw new Error(faults.wakeError);
      records.wakeCalls.push({ key, ...wake });
    } },
  } satisfies { react: typeof React; conversation: Pick<Conversation, 'registerMessageAction'>; relay: Pick<RelayData, 'snapshot' | 'subscribe'>; agents: Pick<Agents, 'snapshot' | 'subscribe' | 'wake'> };
  // The host provides only declared injection methods used by this plugin.
  apply(injected as unknown as Parameters<PluginModule['apply']>[0]);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    async writeText(text: string) {
      records.copyAttempts.push(text);
      if (faults.clipboardDeferred) {
        const pending = deferred();
        pendingClipboards.push(pending);
        await pending.promise;
      } else if (faults.clipboard === 'reject') {
        throw new Error('Clipboard denied');
      }
      records.clipboardWrites.push(text);
    },
  } });
  document.execCommand = (command: string) => {
    if (command !== 'copy') throw new Error('Unexpected command');
    if (faults.execCopy === 'throw') throw new Error('Copy failed');
    if (faults.execCopy) records.clipboardWrites.push((document.activeElement as HTMLTextAreaElement)?.value);
    return !!faults.execCopy;
  };
  function close() { records.closeCalls++; render(false); }
  function Host({ opened }: { opened: boolean }) {
    return <><button onClick={() => render(true)}>Open handoff</button>{opened && <action.component message={selectedMessage} session={session} close={close} />}</>;
  }
  function render(opened: boolean) {
    const content = <Host opened={opened} />;
    flushSync(() => root.render(options.strictMode ? <React.StrictMode>{content}</React.StrictMode> : content));
  }
  const harness = {
    resolveRefresh(index: number) {
      if (!pendingRefreshes[index]) throw new Error(`No pending refresh for reader ${index}`);
      pendingRefreshes[index]!.resolve();
    },
    rejectRefresh(index: number, error = 'Deferred refresh failed') {
      if (!pendingRefreshes[index]) throw new Error(`No pending refresh for reader ${index}`);
      pendingRefreshes[index]!.reject(new Error(error));
    },
    resolveClipboard(index = 0) {
      if (!pendingClipboards[index]) throw new Error(`No pending clipboard write ${index}`);
      pendingClipboards[index].resolve();
    },
    rejectClipboard(index = 0, error = 'Clipboard denied') {
      if (!pendingClipboards[index]) throw new Error(`No pending clipboard write ${index}`);
      pendingClipboards[index].reject(new Error(error));
    },
    setThread(patch: any, notify = true) { thread.set({ ...thread.snapshot(), ...patch }, notify); },
    setRelay(patch: any, notify = true) { relay.set({ ...relay.snapshot(), ...patch }, notify); },
    switchSession() { relay.set({ ...relay.snapshot(), session: { ...session } }); },
    setChannel(patch: any, notify = true) { channel = { ...channel, ...patch }; channels.set({ status: 'ready', channels: [channel] }, notify); },
    setAgents(list: any[], notify = true) { agents.set({ ...agents.snapshot(), agents: list, running: list }, notify); },
    setProfiles(values: any) { profiles.set(new Map(Object.entries(values))); },
    setNames(values: any) { names = values; namesRevision.set(namesRevision.snapshot() + 1); },
    setFaults(patch: any) { faults = { ...faults, ...patch }; },
    open() { render(true); }, close,
    matches(value: any, channelPatch?: any) {
      const candidateSession = channelPatch ? { ...session, channels: { ...session.channels, get: () => ({ ...channel, ...channelPatch }) } } : session;
      return action.matches(message(value), candidateSession);
    },
    stats() { return { ...records, subscriptions: { agents: agents.count(), relay: relay.count(), channels: channels.count(), profiles: profiles.count(), names: namesRevision.count() } }; },
  };
  (window as any).harness = harness;
  render(options.open !== false && action.matches(selectedMessage, session));
};
