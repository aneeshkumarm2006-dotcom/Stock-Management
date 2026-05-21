"use client";

import { NameCategoryList } from "@/components/pm/settings/NameCategoryList";

export default function ProjectTypesPage() {
  return (
    <NameCategoryList
      title="Project types"
      endpoint="/api/pm/project-types"
      placeholder="Capital improvement"
    />
  );
}
