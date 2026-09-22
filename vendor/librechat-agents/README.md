# P4 SDK dependency

This npm archive contains `@librechat/agents` 3.7.17 built from the published
source at https://github.com/Arkos77/agents/commit/a4f35b0747a3dc28e20d1b6dfeb289dbf1fa0417.

- Source tree: `ce121e55a94dc299249427884e03c127b607af7b`.
- Archive SHA-256: `d641858fe95e14b39e629831d042961f0eb0e10ae456c35c6796781d3417bd97`.
- The npm lockfile additionally pins the archive's SHA-512 integrity.
- The archive was built from the clean local commit `c034a773e03a1d6be7ebb118d62641c551a59370`,
  whose complete Git tree is identical to the published commit above.

The upstream package does not commit `dist`, and its `prepare` script only sets
up Husky. A Git dependency alone therefore does not produce the executable
files required by its exports. A local npm tarball supplies those files without
a host postinstall script, a second runtime, or a manual `node_modules` overlay.
The existing `@librechat/api` peer range remains compatible with version 3.7.17.

To regenerate, check out the exact published commit in an isolated SDK checkout,
install its locked build dependencies, run the two P4 regression tests, run
`npm run build`, then run `npm pack --ignore-scripts`. Rename the generated
archive to include the full source commit and refresh the host lockfile with
`npm install --package-lock-only --ignore-scripts`. Review both integrity and
dependency diffs before adopting a regenerated archive.

The two Dockerfiles copy this directory before dependency installation, and
`.dockerignore` explicitly includes it despite the existing `librechat*` rule.
Keep the archive, this provenance record, the manifest and lockfile together.

P4 guarantees that this tested reconstruction does not replay completed
predecessors. It does not guarantee universal exactly-once execution: an
interrupted node may replay code before its interrupt. External side effects
still require appropriate idempotency keys, durable claims or fencing.
