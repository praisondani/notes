const eslintConfig = [
  { ignores: ["node_modules/**", ".next/**", "out/**", "coverage/**"] },
  {
    files: ["**/*.{js,mjs,cjs}"],
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["warn", { "argsIgnorePattern": "^_" }],
    },
  },
];

export default eslintConfig;
