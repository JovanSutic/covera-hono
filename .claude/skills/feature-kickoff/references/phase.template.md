# Phase <N> — <outcome in four words>

**Prerequisite:** phase <M> (<why, in one clause>)
**Gate:** `npm run gate`

---

### Step <N>.1 — <imperative title; this IS the goal, do not restate it>

**Touch.** `path/to/file.ts` (create | edit | delete)

**Do.**

```ts
// exact content or exact final state — verbatim, no paraphrase
```

**Accept.** <a command, with the output it must produce — e.g. `npm run gate` → exit 0;
`grep -n "x" src/f.ts` → nothing>

**Verify.** `npm run gate`

---

### Step <N>.2 — <title>

**Touch.**

**Do.**

**Accept.**

**Verify.**

---

### Step <N>.K — Test <module>

Tests are never deferred to review. This step is required for any phase that adds behaviour.

**Touch.** `path/to/file.test.ts`

**Do.**

```ts
// the actual test code
```

**Accept.** `npm run gate` → <new count> tests passing, 0 failing

**Verify.** `npm run gate`

---

## Phase <N> invariants

- [ ] Every route touched declares every status its guards and handler can produce
- [ ] Every new `code` exists in `ERROR_REGISTRY`
- [ ] No message contains an id, driver text, or table/column name
- [ ] <feature-specific invariant, or delete>
