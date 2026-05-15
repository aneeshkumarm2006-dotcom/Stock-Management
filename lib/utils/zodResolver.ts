// Minimal react-hook-form Resolver backed by a Zod schema.
//
// The TODO calls for "RHF + Zod" on the auth forms. The standard bridge is the
// `@hookform/resolvers` package, but that is not part of the Tech_Stack.md
// dependency set — and the integration is small enough to own here rather than
// add an unlisted dependency. This maps Zod issues onto RHF's FieldErrors
// shape (one error per field path, first issue wins) so `formState.errors`
// works exactly as it would with the official resolver.
// Refs: Tech_Stack.md §Key Dependencies (react-hook-form, zod).
import type {
  FieldErrors,
  FieldValues,
  Resolver,
} from "react-hook-form";
import type { ZodType } from "zod";

export function zodResolver<T extends FieldValues>(
  schema: ZodType<T>,
): Resolver<T> {
  return async (values) => {
    const result = schema.safeParse(values);

    if (result.success) {
      return { values: result.data, errors: {} };
    }

    const errors: Record<string, { type: string; message: string }> = {};
    for (const issue of result.error.issues) {
      const path = issue.path.join(".");
      // First issue per field wins (matches @hookform/resolvers default).
      if (path && !(path in errors)) {
        errors[path] = { type: issue.code, message: issue.message };
      }
    }

    return { values: {}, errors: errors as FieldErrors<T> };
  };
}

export default zodResolver;
