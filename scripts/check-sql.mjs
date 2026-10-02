import fs from "node:fs";

// Guards the SQL files against the two mistakes that have actually shipped:
// unbalanced parentheses, and a reserved word used as a bare identifier.
const RESERVED = new Set([
  "all", "analyse", "analyze", "and", "any", "array", "as", "asc", "asymmetric", "authorization",
  "between", "binary", "both", "case", "cast", "check", "collate", "collation", "column",
  "concurrently", "constraint", "create", "cross", "current_catalog", "current_date",
  "current_role", "current_schema", "current_time", "current_timestamp", "current_user",
  "default", "deferrable", "desc", "distinct", "do", "else", "end", "except", "false", "fetch",
  "for", "foreign", "freeze", "from", "full", "grant", "group", "having", "ilike", "in",
  "initially", "inner", "intersect", "into", "is", "isnull", "join", "lateral", "leading",
  "left", "like", "limit", "localtime", "localtimestamp", "natural", "not", "notnull", "null",
  "offset", "on", "only", "or", "order", "outer", "overlaps", "placing", "primary",
  "references", "returning", "right", "select", "session_user", "similar", "some", "symmetric",
  "table", "tablesample", "then", "to", "trailing", "true", "union", "unique", "user",
  "using", "variadic", "verbose", "when", "where", "window", "with"
]);

const files = process.argv.slice(2);
let problems = 0;

for (const file of files) {
  const raw = fs.readFileSync(file, "utf8");
  // Strip comments and single-quoted literals so only real SQL is inspected.
  const sql = raw
    .replace(/--[^\n]*/g, "")
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/\/\*[\s\S]*?\*\//g, "");

  const opens = (sql.match(/\(/g) || []).length;
  const closes = (sql.match(/\)/g) || []).length;

  // Only "as <word>" is treated as an alias. Anything looser misreads
  // "case ... end as result", where `end` belongs to the CASE, not the column.
  const reserved = [];
  for (const m of sql.matchAll(/\bas\s+([a-z_][a-z0-9_]*)/gi)) {
    const word = m[1].toLowerCase();
    if (!RESERVED.has(word)) continue;
    // ") as select" is the required body form of create view, and ") as $$" the
    // form of a function, so a preceding parenthesis means this is not an alias.
    const before = sql.slice(0, m.index).replace(/\s+$/, "");
    if (before.endsWith(")")) continue;
    const line = sql.slice(0, m.index).split("\n").length;
    reserved.push(`${word} (line ${line})`);
  }

  const failed = opens !== closes || reserved.length > 0;

  console.log(file);
  console.log("  parens:", opens === closes ? "balanced" : `UNBALANCED ${opens}/${closes}`);
  console.log("  reserved word as alias:", reserved.length ? reserved.join(", ") : "none");

  if (failed) problems += 1;
}

console.log(problems === 0 ? "\nAll files passed." : `\n${problems} file(s) need fixing.`);
