"use client";

import { NameCategoryList } from "@/components/pm/settings/NameCategoryList";

export default function TaskCategoriesPage() {
  return (
    <NameCategoryList
      title="Task categories"
      endpoint="/api/pm/task-categories"
      placeholder="Routine maintenance"
    />
  );
}
