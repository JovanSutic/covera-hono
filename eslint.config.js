import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
    },
    rules: {
      "@typescript-eslint/no-unused-vars": "warn",
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },

  {
    files: ["src/**/*.ts"],
    ignores: ["src/core/errors/error.handler.ts", "src/**/*.test.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "Property[key.name='success'][value.value=false]",
          message:
            "Do not hand-build an error envelope. Throw a typed exception; the renderer builds the body. See docs/errorHandle.md §3.",
        },
      ],
    },
  },

  {
    files: ["src/**/*.ts"],
    ignores: ["src/core/errors/**", "src/**/*.test.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "NewExpression[callee.name='Error']",
          message:
            "Use a typed exception (BadRequestException/NotFoundException/…) with a registry code. See docs/errorHandle.md §4.5.",
        },
      ],
    },
  },
];
