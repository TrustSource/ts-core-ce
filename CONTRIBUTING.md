# Contributing

Pull requests are welcome.

## Before you start

- Small fixes: open a pull request directly.
- Larger changes and new features: open an issue first and wait for a go-ahead. This
  keeps you from building something that clashes with the [roadmap](ROADMAP.md).
- Do not send security fixes as public pull requests. See [SECURITY.md](SECURITY.md).

## Before you open a pull request

Run these checks:

- `yarn lint`
- the unit specs: `npx jest --testPathPatterns 'test_api/specs/.*unit\.spec\.js$'`
- `yarn test:workers`

Keep to one topic per pull request. Add tests when behaviour changes. If your pull request
is a fix, bump the patch version in `package.json` and add a release note in
`imports/server/updates/releaseNotes.js`.

## What happens next

The pull request is reviewed and merged in this repository, when time allows and at the
latest in the next sprint. Fixes ship in the next patch release and features in the next
sprint release. You are credited in the merged pull request and the GitHub release notes.

## License

Contributions are licensed under the AGPL-3.0, the same as the project. There is no CLA
and no sign-off is needed.
