// className composition helper: clsx for conditionals + tailwind-merge to
// resolve conflicting Tailwind utilities (last one wins). Used by every UI
// primitive. Refs: Tech_Stack.md §Frontend (clsx + tailwind-merge).
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
