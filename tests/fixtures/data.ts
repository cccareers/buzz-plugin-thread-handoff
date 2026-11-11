import type { MessageAction, Agents } from '@buzz/author';
export const ROOT_ID = 'a'.repeat(64);
export const CHANNEL_ID = 'handoff-channel';
export const AUTHOR_ID = 'b'.repeat(64);
export const AGENT_ID = 'c'.repeat(64);
export type Message = Parameters<MessageAction['matches']>[0];
export function message(overrides: Partial<Message> = {}): Message {
  return { id: ROOT_ID, channelId: CHANNEL_ID, authorId: AUTHOR_ID, createdAt: 1735689600,
    content: 'Ship the handoff plugin.', attachments: [], mentions: [], reactions: [], participants: [], replyCount: 0,
    ...overrides };
}
export type Agent = ReturnType<Agents['snapshot']>['running'][number];
export function agent(overrides: Partial<Agent> = {}): Agent {
  return { key: 'agent-1', pubkey: AGENT_ID, name: 'Local Codex', type: 'buzz.codex/codex',
    owner: AUTHOR_ID, relay: 'wss://relay.example.test', place: 'here', attention: {}, skipped: {},
    timers: {}, attentionEnabled: true, config: {}, ...overrides };
}
