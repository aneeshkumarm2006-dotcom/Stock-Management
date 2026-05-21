// Polymorphic parent enums shared by Note, ActivityLogEntry, and PmFile.
// Note + ActivityLogEntry parents are the Phase 0 PARENT_TYPES set; PmFile
// adds `Account` for account-level uploads (PDR_MASTER §3.29 — Buildium parity:
// `Upload account file` permits a File without a Location).
// Phase 1+ adds the missing types (Bill, Email, JournalEntry, Deposit) to
// FILE_LOCATION_TYPES as those entities ship — keep this file the single
// source of truth.

import { z } from "zod";

/**
 * Polymorphic parent for Note + ActivityLogEntry.
 * Order matches PROPERTY_TODO.md Phase 0 §"Polymorphic cross-cutting tables".
 */
export const PARENT_TYPES = [
  "Property",
  "Unit",
  "Lease",
  "Tenant",
  "RentalOwner",
  "Vendor",
  "WorkOrder",
  "Applicant",
  "Listing",
  "Task",
] as const;

/**
 * File locations — superset of PARENT_TYPES with `Account` for account-level
 * uploads (no parent). Phase 1+ will extend with Bill, Email, JournalEntry,
 * Deposit as those entities ship.
 */
export const FILE_LOCATION_TYPES = [
  ...PARENT_TYPES,
  "Account",
] as const;

export const parentTypeSchema = z.enum(PARENT_TYPES);
export const fileLocationTypeSchema = z.enum(FILE_LOCATION_TYPES);

/**
 * Phase 1+ entities that are FK-validated when an upload lands. Membership
 * means "POST /api/pm/files looks up `locationId` in the matching Mongo
 * collection and rejects when it doesn't exist". Anything not in this set is
 * allowed through (placeholder-writes pattern from Phase 0).
 *
 * Phase 1 adds: Property, Unit, Tenant, RentalOwner.
 * Phases 3/4 will add: Vendor, WorkOrder, Lease, Applicant, Listing, Task.
 */
export const FK_VALIDATED_LOCATION_TYPES = new Set<string>([
  'Property',
  'Unit',
  'Tenant',
  'RentalOwner',
]);

/**
 * Collection name lookup used by the polymorphic file route to perform the
 * existence check. Keep this in sync with FK_VALIDATED_LOCATION_TYPES.
 */
export const COLLECTION_BY_LOCATION_TYPE: Record<string, string> = {
  Property: 'pm_properties',
  Unit: 'pm_units',
  Tenant: 'pm_tenants',
  RentalOwner: 'pm_rental_owners',
};

/** Type guard for runtime checks. */
export function isParentType(v: unknown): v is (typeof PARENT_TYPES)[number] {
  return typeof v === "string" && (PARENT_TYPES as readonly string[]).includes(v);
}

export function isFileLocationType(
  v: unknown,
): v is (typeof FILE_LOCATION_TYPES)[number] {
  return (
    typeof v === "string" && (FILE_LOCATION_TYPES as readonly string[]).includes(v)
  );
}
