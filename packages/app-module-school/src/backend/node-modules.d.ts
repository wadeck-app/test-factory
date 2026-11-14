// Minimal typings for the Node built-ins used by the backend (@types/node is not a dependency).
declare module 'node:crypto' {
  export function randomUUID(): string;
}

declare module 'node:fs' {
  export function existsSync(path: string): boolean;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
  export function mkdtempSync(prefix: string): string;
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void;
  export function writeFileSync(path: string, data: string, encoding: 'utf8'): void;
}

declare module 'node:os' {
  export function tmpdir(): string;
}

declare module 'node:path' {
  export function join(...paths: string[]): string;
}
