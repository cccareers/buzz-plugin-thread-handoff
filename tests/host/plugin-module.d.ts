declare module '*/plugin.js' {
  import type { PluginModule } from '@buzz/author';
  export const apply: PluginModule['apply'];
  export const inject: readonly string[];
}
