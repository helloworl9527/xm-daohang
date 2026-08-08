import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

const config = [
  { ignores: [".next/**", "node_modules/**", ".workflow/ui-prototype/**"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
];

export default config;
