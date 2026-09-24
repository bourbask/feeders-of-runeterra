/**
 * JSON parsing that remembers WHERE each value was written.
 *
 * `JSON.parse` answers "what does this file say". It never answers "which line
 * is wrong", and that second answer is the whole point of the loader: an error
 * report that names a file but not a line sends the author reading a 300-line
 * champion sheet with a magnifying glass.
 *
 * So this module parses once and keeps an offset for every path it walked.
 * `pass 1` (syntax) reports the exact offset of the bad character; passes 2 and
 * 3 look up the path a `ZodIssue` carries and turn it into a line number.
 *
 * WHY NOT A LIBRARY. `@for/content` depends on `@for/contracts` and nothing
 * else (01-architecture.md section 1.2). A JSON parser is 150 lines; a new
 * runtime dependency on the content path is a permanent cost.
 *
 * The parser is checked against `JSON.parse` on every file it reads
 * (`tests/content-validity.test.ts`): if the two ever disagree on a value, the
 * test reddens rather than the loader silently believing itself.
 */

/** A path inside a JSON document: object keys and array indices, in order. */
export type JsonPath = readonly (string | number)[];

export class JsonSyntaxError extends Error {
  public constructor(
    message: string,
    public readonly offset: number,
    public readonly line: number,
    public readonly column: number,
  ) {
    super(message);
    this.name = 'JsonSyntaxError';
  }
}

export interface JsonSource {
  /** The parsed document. Identical to `JSON.parse(raw)`. */
  readonly value: unknown;
  /** Offset of the first character of the value at each path. */
  readonly offsets: ReadonlyMap<string, number>;
  /** 1-based line of a character offset. */
  lineAt(offset: number): number;
}

/** `a.b[0].c` — the stable spelling of a path, used as a map key and in reports. */
export function formatPath(path: JsonPath): string {
  let out = '';
  for (const segment of path) {
    out +=
      typeof segment === 'number' ? `[${String(segment)}]` : out === '' ? segment : `.${segment}`;
  }
  return out;
}

const WHITESPACE = new Set([' ', '\t', '\n', '\r']);

const ESCAPES: Readonly<Record<string, string>> = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
};

/**
 * Parse `raw`, recording the offset of every value.
 *
 * Throws `JsonSyntaxError` with a line and a column on malformed input.
 */
export function parseJsonSource(raw: string): JsonSource {
  const offsets = new Map<string, number>();
  let index = 0;

  const lineAt = (offset: number): number => {
    let line = 1;
    for (let scan = 0; scan < offset && scan < raw.length; scan += 1) {
      if (raw[scan] === '\n') line += 1;
    }
    return line;
  };

  const columnAt = (offset: number): number => {
    const before = raw.lastIndexOf('\n', Math.max(0, offset - 1));
    return offset - before;
  };

  const fail = (message: string, at = index): never => {
    throw new JsonSyntaxError(message, at, lineAt(at), columnAt(at));
  };

  const skipBlanks = (): void => {
    while (index < raw.length) {
      const char = raw[index];
      if (char === undefined || !WHITESPACE.has(char)) return;
      index += 1;
    }
  };

  const expect = (char: string): void => {
    if (raw[index] !== char) fail(`« ${char} » attendu`);
    index += 1;
  };

  const readString = (): string => {
    expect('"');
    let out = '';
    for (;;) {
      const char = raw[index] ?? fail('chaîne non terminée');
      if (char === '"') {
        index += 1;
        return out;
      }
      if (char === '\\') {
        const escape = raw[index + 1] ?? fail('échappement non terminé', index);
        if (escape === 'u') {
          const hex = raw.slice(index + 2, index + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('échappement \\u malformé', index);
          out += String.fromCodePoint(Number.parseInt(hex, 16));
          index += 6;
          continue;
        } else {
          out += ESCAPES[escape] ?? fail(`échappement « \\${escape} » inconnu`, index);
          index += 2;
          continue;
        }
      }
      if (char < ' ') fail('caractère de contrôle non échappé dans une chaîne');
      out += char;
      index += 1;
    }
  };

  const readNumber = (): number => {
    const start = index;
    if (raw[index] === '-') index += 1;
    while (index < raw.length && raw[index] !== undefined && /[0-9]/.test(raw[index] ?? '')) {
      index += 1;
    }
    if (raw[index] === '.') {
      index += 1;
      while (index < raw.length && /[0-9]/.test(raw[index] ?? '')) index += 1;
    }
    if (raw[index] === 'e' || raw[index] === 'E') {
      index += 1;
      if (raw[index] === '+' || raw[index] === '-') index += 1;
      while (index < raw.length && /[0-9]/.test(raw[index] ?? '')) index += 1;
    }
    const text = raw.slice(start, index);
    const parsed = Number(text);
    if (text === '' || Number.isNaN(parsed)) fail('nombre malformé', start);
    return parsed;
  };

  const readLiteral = (word: string, literal: null | boolean): null | boolean => {
    if (raw.startsWith(word, index)) {
      index += word.length;
      return literal;
    }
    return fail('valeur inattendue');
  };

  const readValue = (path: JsonPath): unknown => {
    skipBlanks();
    offsets.set(formatPath(path), index);
    const char = raw[index];
    switch (char) {
      case '{': {
        index += 1;
        const out: Record<string, unknown> = {};
        skipBlanks();
        if (raw[index] === '}') {
          index += 1;
          return out;
        }
        for (;;) {
          skipBlanks();
          const keyOffset = index;
          const key = readString();
          offsets.set(`${formatPath([...path, key])}#key`, keyOffset);
          skipBlanks();
          expect(':');
          out[key] = readValue([...path, key]);
          skipBlanks();
          if (raw[index] === ',') {
            index += 1;
            continue;
          }
          expect('}');
          return out;
        }
      }
      case '[': {
        index += 1;
        const out: unknown[] = [];
        skipBlanks();
        if (raw[index] === ']') {
          index += 1;
          return out;
        }
        for (;;) {
          out.push(readValue([...path, out.length]));
          skipBlanks();
          if (raw[index] === ',') {
            index += 1;
            continue;
          }
          expect(']');
          return out;
        }
      }
      case '"':
        return readString();
      case 't':
        return readLiteral('true', true);
      case 'f':
        return readLiteral('false', false);
      case 'n':
        return readLiteral('null', null);
      case undefined:
        return fail('document vide');
      default:
        return readNumber();
    }
  };

  const value = readValue([]);
  skipBlanks();
  if (index !== raw.length) fail('contenu après la fin du document');

  return { value, offsets, lineAt };
}

/**
 * The line a `ZodIssue` path points at, or the line of the nearest ancestor
 * that the parser did see.
 *
 * Falling back to the ancestor is deliberate: a missing key has no offset of
 * its own, and pointing at the object that should have carried it is still the
 * right place to look.
 */
export function lineOf(source: JsonSource, path: JsonPath): number | undefined {
  for (let depth = path.length; depth >= 0; depth -= 1) {
    const key = formatPath(path.slice(0, depth));
    const offset = source.offsets.get(`${key}#key`) ?? source.offsets.get(key);
    if (offset !== undefined) return source.lineAt(offset);
  }
  return undefined;
}
