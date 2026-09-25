/**
 * No test of `@for/ai` opens a socket.
 *
 * It is a rule, not a preference (02-mj-ia.md section 4.2): a blocking
 * pull-request test never calls a provider, and the exact token count stays in
 * the nightly workflow that has a key. A rule that is only written down is a
 * rule that gets broken by the next adapter, so this file MAKES egress fail —
 * `fetch`, and the socket layer underneath it, which is what `node:http`,
 * `node:https` and every SDK end up using.
 *
 * The adapters take their transport as a parameter for this reason. One that
 * reached for the ambient `fetch` would be untestable here, which is the point.
 */

import { Socket } from 'node:net';

import { beforeAll } from 'vitest';

const refuse = (what: string): never => {
  throw new Error(
    `sortie réseau interdite dans les tests de @for/ai (${what}) — le transport s'injecte`,
  );
};

beforeAll(() => {
  globalThis.fetch = (): never => refuse('fetch');
  Socket.prototype.connect = (): never => refuse('net.Socket#connect');
});
