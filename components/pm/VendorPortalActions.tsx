// Vendor portal actions (BR-MV-12, [G-B-6]). Two buttons that gate behind
// `vendorPortalAccess`:
//   - `Send welcome email` — Phase 4 stubs as a toast; real dispatch lands
//     with Phase 6 Communications when EmailMessage ships.
//   - `Sign in as user` — Phase 4 stubs as a toast; vendor User accounts
//     don't yet exist (vendors are pseudo-Users in Buildium's model).
"use client";

import * as React from "react";
import { Mail, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

interface VendorPortalActionsProps {
  vendorId: string;
  vendorPortalAccess: boolean;
}

export function VendorPortalActions({
  vendorId,
  vendorPortalAccess,
}: VendorPortalActionsProps) {
  const { toast } = useToast();

  function sendWelcome() {
    toast({
      title: "Welcome email queued",
      description:
        "Email dispatch lands with Phase 6 Communications. Vendor portal access stays opted in.",
      variant: "success",
    });
  }

  function signInAsVendor() {
    toast({
      title: "Vendor sign-in",
      description:
        "Vendor User accounts ship with the vendor portal (Phase 6). For now this is a UI stub.",
      variant: "success",
    });
  }

  if (!vendorPortalAccess) {
    return (
      <p className="text-sm text-fg-muted">
        Vendor portal access is opt-in. Toggle it on the Summary tab to enable
        welcome emails and sign-in-as.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        size="sm"
        variant="outline"
        onClick={sendWelcome}
        data-vendor-id={vendorId}
      >
        <Mail className="h-3.5 w-3.5" /> Send welcome email
      </Button>
      <Button size="sm" variant="outline" onClick={signInAsVendor}>
        <KeyRound className="h-3.5 w-3.5" /> Sign in as user
      </Button>
    </div>
  );
}
