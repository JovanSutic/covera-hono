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

  // Guardrails (docs/errorHandlePlan.md §7.1, §7.2).
  //
  // Both rules MUST live in one config object. Flat config replaces a rule's
  // value wholesale rather than merging, so two `src/**/*.ts` objects each
  // setting `no-restricted-syntax` means the later one silently drops the
  // earlier one's selectors.
  {
    files: ["src/**/*.ts"],
    ignores: [
      // The one place allowed to build the envelope.
      "src/core/errors/error.handler.ts",
      // Builds the OpenAPI response `example`, which legitimately contains
      // `success: false as const`.
      "src/core/errors/error.define.ts",
      "src/**/*.test.ts",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Property[key.name='success'][value.value=false]",
          message:
            "Do not hand-build an error envelope. Throw a typed exception; the renderer builds the body. See docs/errorHandle.md §3.",
        },
        {
          // Same literal written as `success: false as const` — `as const` wraps
          // the value in a TSAsExpression, which the selector above cannot see.
          selector:
            "Property[key.name='success'][value.type='TSAsExpression'][value.expression.value=false]",
          message:
            "Do not hand-build an error envelope. Throw a typed exception; the renderer builds the body. See docs/errorHandle.md §3.",
        },
        {
          selector: "NewExpression[callee.name='Error']",
          message:
            "Use a typed exception (BadRequestException/NotFoundException/…) with a registry code. See docs/errorHandle.md §4.5.",
        },
      ],
    },
  },
];
