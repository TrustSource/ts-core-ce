# Support

TrustSource Community Edition is maintained by one person. New features come in
quarterly sprints and fixes come as they are ready. Support is best effort, with no SLA.

Ask in GitHub issues at https://github.com/TrustSource/ts-core-ce/issues. There is no
chat, forum or support email. Search the existing issues first.

## What to expect

| Type | Where | First response | Fix |
|------|-------|----------------|-----|
| Security vulnerability | GitHub private vulnerability reporting | Within 5 working days | Fixed in this repository as soon as practical, in a patch release. |
| Critical bug | Issue with the Bug report form (the maintainer adds `critical`) | Within 5 working days | Fixed in this repository, in a patch release. |
| Other bug | Issue | At the latest in the next sprint | Fixed when time allows, or in a sprint release, by priority. |
| Feature request, question | Issue | At the latest in the next sprint | Considered for the [roadmap](ROADMAP.md). |

"Critical" means one of these:

- installation or start-up fails on a supported setup;
- data is lost or corrupted;
- a core flow (login, import, analysis, reports) is broken for all users.

The maintainer decides and sets the `critical` label.

Only the latest release gets fixes. If you run an older version, please upgrade first.

## Before you open an issue

- Read the CE documentation at https://help.trustsource.io/ce/.
- If someone else runs your installation, ask them first. Mail, HTTPS and integration
  problems can often only be fixed on the server.
- Use the Bug report form and fill in every field.
- Issues are public. Remove secrets and personal data from logs and screenshots: passwords,
  API keys, `TS_ENCRYPTION_KEY`, the contents of `.env`, email addresses, and names of
  projects and components that are confidential.

Do not report security problems in public issues. See [SECURITY.md](SECURITY.md).

## Commercial support

Commercial support is available through the TrustSource SaaS: https://www.trustsource.io
