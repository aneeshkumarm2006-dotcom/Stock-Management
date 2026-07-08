"use client";

// Shared "Broker" dropdown used across every add/edit holding form — the
// brokerage/custodian a holding is held at. Mirrors HeldByField over the
// brokers query + the SelectField primitive.
import { useBrokers } from "@/lib/hooks/useBrokers";
import { SelectField } from "../fields";

export function BrokerField({
  id,
  error,
  registerProps,
  label = "Broker (optional)",
}: {
  id: string;
  error?: string;
  // The spread from react-hook-form's register(...) call.
  registerProps: React.ComponentProps<"select">;
  label?: string;
}) {
  const brokers = useBrokers().data?.brokers ?? [];
  return (
    <SelectField label={label} id={id} error={error} {...registerProps}>
      <option value="">None</option>
      {brokers.map((b) => (
        <option key={b.id} value={b.id}>
          {b.name}
        </option>
      ))}
    </SelectField>
  );
}
