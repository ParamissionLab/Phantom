# Plan

## Task Breakdown

- [x] Audit the npm package metadata, release workflow, Git tags, and release documentation.
- [x] Identify why the workflow validates the obsolete `@paramissionlab/phantom` scope.
- [x] Update the package to version `1.0.0` so the corrected scope can be released from a new immutable tag.
- [x] Make the publish workflow reject stale package names and tag/version mismatches before publishing.
- [x] Update release documentation and the changelog with the recovery procedure.
- [x] Run type checking, linting, tests, builds, and an npm package dry run.

## Risks

- The npm organization `paramission-lab` and publisher permissions are external state and can only be conclusively validated by npm during publishing.
- The existing `v0.1.0` tag must remain unchanged; moving a published release tag would make releases non-reproducible.
