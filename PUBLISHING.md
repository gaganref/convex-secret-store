# Publishing

`convex-secret-store` publishes to npm from GitHub Actions. Pushing a version
tag runs `.github/workflows/release.yml`, which builds, tests, and publishes
with npm provenance. Nobody publishes from a laptop.

## One-time setup

1. On npmjs.com, open the package settings and add a trusted publisher: GitHub
   Actions, repository `gaganref/convex-secret-store`, workflow `release.yml`,
   environment `npm`.
2. In the GitHub repository settings, create the `npm` environment. Add yourself
   as a required reviewer if every publish should wait for a click.

## Release a version

1. Open a release PR that sets `version` in `package.json` and
   `package-lock.json` and adds the `CHANGELOG.md` entry. Update the README in
   the same PR if the release changes anything it describes.
2. Merge the PR once CI is green.
3. Tag the merge commit on `main` and push the tag:

   ```sh
   git switch main && git pull
   git tag v0.2.1
   git push origin v0.2.1
   ```

The workflow refuses a tag that is not on `main` or that does not match
`package.json`. A tag with a prerelease suffix, such as `v0.3.0-rc.0`, publishes
under the npm `next` dist-tag, and any other tag publishes as `latest`.

## Check the release

```sh
npm view convex-secret-store version dist-tags
```

Then install the new version in a scratch Convex app and run
`npx convex dev --once` to confirm it pushes.
