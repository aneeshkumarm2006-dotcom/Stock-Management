// Pre-commit: lint + format staged files, then a full type-check.
// `tsc --noEmit` is returned verbatim (no file args) so it respects tsconfig.
export default {
  "*.{ts,tsx}": (files) => [
    `eslint --fix ${files.join(" ")}`,
    `prettier --write ${files.join(" ")}`,
    "tsc --noEmit",
  ],
  "*.{js,jsx,mjs,cjs,json,css,md}": (files) =>
    `prettier --write ${files.join(" ")}`,
};
