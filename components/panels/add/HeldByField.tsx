"use client";

// Shared "Held by" company dropdown used across every add/edit holding form.
// Reuses the existing companies query + the SelectField primitive.
import { useCompanies } from "@/lib/hooks/useCompanies";
import { SelectField } from "../fields";

export function HeldByField({
  id,
  error,
  registerProps,
  label = "Held by (optional)",
}: {
  id: string;
  error?: string;
  // The spread from react-hook-form's register(...) call.
  registerProps: React.ComponentProps<"select">;
  label?: string;
}) {
  const companies = useCompanies().data?.companies ?? [];
  return (
    <SelectField label={label} id={id} error={error} {...registerProps}>
      <option value="">None</option>
      {companies.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </SelectField>
  );
}
