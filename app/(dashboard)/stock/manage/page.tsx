"use client";

// Manage page (sidebar tab below Analytics). One place to create / edit /
// delete the companies that hold your stocks and to log each company's cash
// balance. Companies drive the holdings table's "Held By" column and their
// cash rolls into the dashboard's headline portfolio value (PDR §6, §9).
import { CompaniesCard } from "@/components/manage/CompaniesCard";
import { PageHead } from "@/components/layout/PageHead";

export default function ManagePage() {
  return (
    <div className="space-y-[18px]">
      <PageHead
        title="Manage"
        subtitle="Companies that hold your stocks, and their uninvested cash"
      />

      <CompaniesCard />
    </div>
  );
}
