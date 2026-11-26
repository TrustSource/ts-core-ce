# CE sprint checklist

For the maintainer. One sprint per quarter.

1. Make sure no back-sync PR is open in the private repository. Merge it first.
2. Triage open public issues and PRs that were not handled between sprints.
3. Merge this sprint's roadmap feature branch into private `main`.
4. Update the release notes, the CE docs and ROADMAP.md (mark shipped, adjust dates).
5. Bump `package.json` to the sprint version.
6. Let the sync run (the Sync and Raise PR workflow) or dispatch it. Merge the public PR
   promptly, without "Update branch" on it, then check the tag and the generated release.
7. Close the milestone. Open or check the next one.

## Between sprints

- Fix bugs and security issues in the public repository.
- Merge outside PRs and Dependabot PRs in the public repository.
- Merge the back-sync PRs that appear in the private repository (the Back-sync workflow,
  `back-sync` branch).

## Rules

- Roadmap feature work stays on feature branches in the private repository until its
  sprint, so private `main` is always releasable.
- Do not merge the back-sync PR while a Back-sync run is in progress.
- Back-sync never applies a public commit that changes `.github/`; it reports it as failed.
  Port such a commit by hand as described below.
- If a back-sync patch fails, resolve it on private `main` (apply the change by hand), not on
  the back-sync branch: the next Back-sync run rebuilds that branch from private `main`. Then
  run the Back-sync workflow by hand with `skip` set to the sha of the commit you ported, so it
  is not reported as failed again. Merge the resulting back-sync PR before the next daily run
  (03:00 UTC), because `skip` only applies to that dispatched run.
