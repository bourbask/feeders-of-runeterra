/**
 * Deterministic serialisation for golden corpora
 * (`01-architecture.md` section 7.3: sorted keys, normalised numbers, 2 spaces,
 * trailing newline).
 *
 * `JSON.stringify` is not enough, on two counts.
 *
 * 1. It preserves INSERTION order. Two objects carrying the same facts in a
 *    different order would produce two different files, and the corpus would
 *    report drift where there is none. Keys are sorted here, recursively, by
 *    code unit — no locale, so the order is the same on every machine.
 * 2. It turns what it cannot represent into `null`, SILENTLY: `NaN`, `Infinity`
 *    and `-Infinity` all become `null`. A corpus that records `null` where the
 *    rules produced `NaN` is a corpus that hides the bug it exists to catch.
 *    Here they throw.
 *
 * `-0` is normalised to `0`: the two are indistinguishable in JSON, so leaving
 * `-0` in would produce a file that never matches itself after a round trip.
 *
 * 3. It turns a `Map` and a `Set` into `{}`, SILENTLY, because neither exposes
 *    own enumerable keys. That is the same failure as `NaN` becoming `null`,
 *    only worse: two campaign states differing on EVERY gauge serialise to the
 *    same bytes, so the corpus is written on one and compared green against the
 *    other. It is not an exotic shape either — `03-donnees.md` declares the whole
 *    content registry in `ReadonlyMap`. So any object whose prototype is neither
 *    `Object.prototype` nor `null`, and which has no `toJSON`, is REFUSED by
 *    name here: convert it to a plain object or an array first, on purpose.
 */

/** Thrown when a value cannot be serialised without inventing something. */
export class GoldenSerialisationError extends Error {
  /** Where it happened, e.g. `$.events[3].delta`. */
  readonly path: string;

  constructor(path: string, reason: string) {
    super(`at ${path}: ${reason}`);
    this.name = 'GoldenSerialisationError';
    this.path = path;
  }
}

const INDENT = '  ';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hasToJson(value: object): value is { toJSON: () => unknown } {
  return 'toJSON' in value && typeof value.toJSON === 'function';
}

/** How to flatten the two shapes that would otherwise serialise as `{}` in silence. */
const CONVERSION: Readonly<Record<string, string>> = {
  Map:
    'a Map has no own enumerable keys, so JSON.stringify — and this file, before the check ' +
    'that raised this — writes `{}` for it. Two states differing on every entry would then ' +
    'produce the same bytes and the corpus would go green over a drift it never saw. ' +
    'Convert it on purpose: `Object.fromEntries([...map].sort(([a], [b]) => (a < b ? -1 : 1)))`, ' +
    'or `[...map.entries()].sort()` to keep non-string keys.',
  Set:
    'a Set has no own enumerable keys, so it would serialise as `{}` and hide every member. ' +
    'Convert it on purpose: `[...set].sort()`.',
};

/**
 * Refuse anything carrying state the key walk below cannot see.
 *
 * `Object.keys` only reads own enumerable string keys. A `Map`, a `Set`, a
 * `WeakMap`, a class instance holding private fields — all of them come out as
 * `{}`, which is the silent-drift mode this whole file exists to close. A plain
 * object, a null-prototype object and a plain array are the only shapes whose
 * entire content that walk can reach.
 *
 * Checked AFTER `toJSON`, so a `Date` (or any type that states its own JSON
 * form) still passes, exactly as with `JSON.stringify`.
 */
function refuseOpaqueObject(value: object, path: string): void {
  const proto: unknown = Object.getPrototypeOf(value);

  if (Array.isArray(value)) {
    if (proto === Array.prototype) return;
  } else if (proto === Object.prototype || proto === null) {
    return;
  }

  // Not `value.constructor.name`: a prototype chain can lack a constructor
  // entirely (`Object.create(Object.create(null))`), and reporting a shape must
  // never itself crash.
  const ctor: unknown = (value as { constructor?: unknown }).constructor;
  const name = typeof ctor === 'function' ? ctor.name : 'an object with an exotic prototype';
  throw new GoldenSerialisationError(
    path,
    CONVERSION[name] ??
      `an instance of \`${name}\` is not a plain object: only own enumerable keys are ` +
        `serialised, so anything it keeps elsewhere would vanish from the corpus without a ` +
        `word. Convert it to a plain object or an array, or give it a \`toJSON\`.`,
  );
}

function serialiseNumber(value: number, path: string): string {
  if (!Number.isFinite(value)) {
    throw new GoldenSerialisationError(
      path,
      `${String(value)} has no JSON representation. JSON.stringify would write \`null\` here ` +
        `and the corpus would record a value the rules never produced.`,
    );
  }
  // `-0` and `0` are the same JSON token; normalising keeps the file idempotent.
  return Object.is(value, -0) ? '0' : JSON.stringify(value);
}

function serialise(value: unknown, depth: number, path: string, seen: Set<object>): string {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'string': {
      return JSON.stringify(value);
    }
    case 'number': {
      return serialiseNumber(value, path);
    }
    case 'boolean': {
      return value ? 'true' : 'false';
    }
    case 'undefined': {
      // Reachable from an array slot or a hole only: an object property that
      // holds `undefined` is dropped below, exactly as `JSON.stringify` does.
      throw new GoldenSerialisationError(
        path,
        '`undefined` is not a JSON value. JSON.stringify would write `null` in its place. ' +
          'Leave the entry out, or write `null` on purpose.',
      );
    }
    case 'bigint': {
      throw new GoldenSerialisationError(path, 'a bigint has no JSON representation.');
    }
    case 'function':
    case 'symbol': {
      throw new GoldenSerialisationError(
        path,
        `a ${typeof value} has no JSON representation. A golden corpus records facts, ` +
          `not behaviour.`,
      );
    }
    case 'object': {
      break;
    }
  }

  if (!isRecord(value)) {
    // Unreachable: every `typeof` above is handled. Kept as a named failure
    // rather than a cast, so an exotic value would say so instead of crashing.
    throw new GoldenSerialisationError(path, `unsupported value of type ${typeof value}.`);
  }

  if (hasToJson(value)) {
    // Same contract as `JSON.stringify`: a `Date` serialises through `toJSON`.
    return serialise(value.toJSON(), depth, path, seen);
  }

  refuseOpaqueObject(value, path);

  if (seen.has(value)) {
    throw new GoldenSerialisationError(path, 'circular reference.');
  }
  seen.add(value);

  const pad = INDENT.repeat(depth + 1);
  const closingPad = INDENT.repeat(depth);
  let text: string;

  if (Array.isArray(value)) {
    if (value.length === 0) {
      text = '[]';
    } else {
      const items: string[] = [];
      for (const [index, item] of value.entries()) {
        const itemPath = `${path}[${String(index)}]`;
        items.push(`${pad}${serialise(item, depth + 1, itemPath, seen)}`);
      }
      text = `[\n${items.join(',\n')}\n${closingPad}]`;
    }
  } else {
    // Sorted by code unit: no locale, therefore the same order everywhere.
    const keys = Object.keys(value).sort();
    const entries: string[] = [];
    for (const key of keys) {
      const item = value[key];
      // Same as `JSON.stringify`: an explicitly `undefined` property is absent.
      if (item === undefined) continue;
      entries.push(
        `${pad}${JSON.stringify(key)}: ${serialise(item, depth + 1, `${path}.${key}`, seen)}`,
      );
    }
    text = entries.length === 0 ? '{}' : `{\n${entries.join(',\n')}\n${closingPad}}`;
  }

  seen.delete(value);
  return text;
}

/**
 * The bytes a golden file holds. Always ends with `\n`: a file whose last line
 * has no terminator shows up as a spurious change in every diff that touches it.
 */
export function stableStringify(value: unknown): string {
  return `${serialise(value, 0, '$', new Set<object>())}\n`;
}
