# Releasing

1. Move the entries under "Unreleased" in `CHANGELOG.md` to a new `## [X.Y.Z] - YYYY-MM-DD` section and update the compare links at the bottom.
2. Set `"version"` in every `package.json` and in `packages/sdk-dart/pubspec.yaml`; update the image tag in the README and guides (`ghcr.io/usertrv/ripen:X.Y.Z`) and the action version comments in `docs/guide/ci.md`.
3. Run `pnpm check`, `pnpm test:browser` and `pnpm test:dart`, merge to `main`.
4. Tag the merge commit and push the tag:
   ```bash
   git tag -a vX.Y.Z -m vX.Y.Z && git push origin vX.Y.Z
   ```
   Or start the [release workflow](.github/workflows/release.yml) by hand on `main` (Actions → Release → Run workflow) with the version and, optionally, the commit; it then creates the tag itself.

   The [release workflow](.github/workflows/release.yml) builds the image for amd64 and arm64, smoke-tests it, pushes `ghcr.io/usertrv/ripen:X.Y.Z` (and `latest` for versions without a `-suffix`) and creates the GitHub release with the changelog section as notes.

The npm and pub packages are not published yet. When they are, publishing should use npm trusted publishing (OIDC from the workflow, no long-lived token) and provenance.
