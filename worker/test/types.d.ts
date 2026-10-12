import type { Env } from '../src/env';
declare module 'vitest' {
  interface ProvidedContext { previewIntegrated: boolean; css: string; }
}
declare global {
  namespace Cloudflare { interface Env extends importEnv {} }
}
interface importEnv extends Env {}
