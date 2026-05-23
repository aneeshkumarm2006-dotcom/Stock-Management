// EmailTemplate variable substitution ([G-S-22]). Naive `{{var}}` syntax;
// no expressions, no HTML escaping — Phase 6 renders bodies as plain text
// in the `<textarea>` so the body is safe.
//
// The WYSIWYG rollout in a later phase MUST add HTML escaping here before
// rendering substituted bodies as `dangerouslySetInnerHTML`. See risk note
// in `plans/complete-all-tasks-related-recursive-cloud.md`.

const VAR_PATTERN = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;

/** Substitute `{{var}}` placeholders. Unknown variables are left in place
 *  so the PM can spot missing data during preview. */
export function resolveTemplateVariables(
  template: string,
  values: Record<string, string | number | null | undefined>,
): string {
  return template.replace(VAR_PATTERN, (match, key) => {
    const v = values[key];
    if (v === null || v === undefined) return match;
    return String(v);
  });
}

/** Extract every `{{var}}` token in declaration order, de-duped. Useful
 *  for surfacing the variable list in the template editor (future phase). */
export function extractTemplateVariables(template: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  // Array.from keeps this compatible with the project's tsconfig target,
  // which doesn't enable downlevelIteration for direct `for-of` on
  // RegExpMatchIterator.
  for (const m of Array.from(template.matchAll(VAR_PATTERN))) {
    const key = m[1];
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}
