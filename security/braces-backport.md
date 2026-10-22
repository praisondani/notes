# Local `braces` security backport

This repository uses a local backport of `braces@3.0.3` for development tooling. The source began with the npm tarball whose published SHA-512 integrity is `sha512-yQbXgO/OSZVD2IsiLlro+7Hf6Q18EJrKSEsdoMzKePKXct3gvD8oLcOQdIzGupr5Fj+EDe8gO/lxc1BzfMpxvA==`.

The backport caps nested brace and parenthesis parsing and guards recursive compile, expand, and stringify walks at 256 levels. This addresses [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) while upstream has no patched release. The patched package version `3.0.4+dan.1` is a local build identifier, not an upstream release.

`braces` is reachable only through development ESLint tooling. Production dependency audit is clean, and the package is not part of the deployed standalone runtime. `scripts/security/braces-depth.test.cjs` checks deeply nested input and normal brace behavior; `npm test` runs it before Vitest.

Review this backport by 2026-11-05 and when upstream publishes a fix or changes advisory status. Replace the local override with the fixed upstream package and remove this backport then.
