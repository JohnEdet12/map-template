/**
 * Overpass QL → a predicate that runs against a plain tag object.
 *
 * The dataset catalogue is written in Overpass QL because that is what the
 * live client speaks. Importing from a local extract means answering the same
 * questions without an Overpass server, so rather than maintaining a second
 * definition of "what counts as a hospital" — which would drift, and would
 * drift silently — this reads the queries the catalogue already has.
 *
 * The catalogue only uses a small corner of the language:
 *
 *   node|way|rel|nwr    element selector
 *   ["k"]               tag present
 *   ["k"="v"]           exact value
 *   ["k"~"re"]          value matches regex
 *
 * Anything outside that throws rather than being quietly ignored, because a
 * filter that silently matches everything would fill the database with the
 * wrong data and nothing downstream would notice.
 */

/** Which element types one statement selects. */
const SELECTORS = {
  node: ['node'],
  way: ['way'],
  rel: ['relation'],
  relation: ['relation'],
  nwr: ['node', 'way', 'relation'],
  nw: ['node', 'way'],
  wr: ['way', 'relation'],
};

/** Pull the `[...]` clauses out of a statement, respecting quoted strings. */
function clausesOf(statement) {
  const out = [];
  let depth = 0;
  let quoted = false;
  let start = 0;

  for (let i = 0; i < statement.length; i++) {
    const ch = statement[i];
    if (ch === '"' && statement[i - 1] !== '\\') quoted = !quoted;
    if (quoted) continue;
    if (ch === '[') { if (depth === 0) start = i + 1; depth += 1; }
    else if (ch === ']') { depth -= 1; if (depth === 0) out.push(statement.slice(start, i)); }
  }
  if (depth !== 0 || quoted) throw new Error(`Unbalanced brackets or quotes: ${statement}`);
  return out;
}

const unquote = (text) => {
  const t = text.trim();
  return t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1) : t;
};

/** One `[...]` clause → a function of the tag object. */
function parseClause(clause) {
  // Order matters: `~` must be tried before `=`, since neither appears in a
  // key and a regex value may well contain `=`.
  const re = clause.match(/^\s*("(?:[^"\\]|\\.)*"|[\w:]+)\s*~\s*("(?:[^"\\]|\\.)*"|\S+)\s*$/);
  if (re) {
    const key = unquote(re[1]);
    const pattern = new RegExp(unquote(re[2]));
    return (tags) => typeof tags[key] === 'string' && pattern.test(tags[key]);
  }

  const eq = clause.match(/^\s*("(?:[^"\\]|\\.)*"|[\w:]+)\s*=\s*("(?:[^"\\]|\\.)*"|\S+)\s*$/);
  if (eq) {
    const key = unquote(eq[1]);
    const value = unquote(eq[2]);
    return (tags) => tags[key] === value;
  }

  const has = clause.match(/^\s*("(?:[^"\\]|\\.)*"|[\w:]+)\s*$/);
  if (has) {
    const key = unquote(has[1]);
    return (tags) => tags[key] !== undefined;
  }

  throw new Error(`Unsupported Overpass filter: [${clause}]`);
}

/**
 * Compile one dataset's `body` into a matcher.
 *
 * A body is a union of statements. An element belongs to the dataset if it
 * satisfies *any* statement — matching Overpass's `(a; b; c;)` union — and a
 * statement is satisfied when the element type is selected and every one of
 * its clauses holds.
 *
 * @returns {{ types: Set<string>, match: (type: string, tags: object) => boolean }}
 */
export function compileQuery(body) {
  const statements = body
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    // `$bbox` is the live client's placeholder; here the bounding box is
    // applied afterwards, per state, so it carries no meaning.
    .map((s) => s.replace(/\(\s*\$bbox\s*\)/g, ''));

  const compiled = [];
  const types = new Set();

  for (const statement of statements) {
    const head = statement.match(/^(node|way|relation|rel|nwr|nw|wr)\b/);
    if (!head) throw new Error(`Cannot read element selector: ${statement}`);

    const selected = SELECTORS[head[1]];
    for (const t of selected) types.add(t);

    const tests = clausesOf(statement).map(parseClause);
    if (!tests.length) throw new Error(`Statement has no filters, would match everything: ${statement}`);

    compiled.push({ types: new Set(selected), tests });
  }

  if (!compiled.length) throw new Error(`Empty query body`);

  return {
    types,
    match(type, tags) {
      for (const stmt of compiled) {
        if (!stmt.types.has(type)) continue;
        let ok = true;
        for (const test of stmt.tests) {
          if (!test(tags)) { ok = false; break; }
        }
        if (ok) return true;
      }
      return false;
    },
  };
}
