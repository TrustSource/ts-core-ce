# TrustSource Community Edition

Open-source compliance management: component and license compliance, vulnerability
tracking, SBOMs and release approvals.

## Quickstart (Docker)

The reference setup in `docker-compose.yml` runs the app, MongoDB, the license check
service and a local mail catcher. You only need Docker with Compose v2.

1 Clone the repository and change into it.

2 Create your settings file from the template:
```
cp .env.example .env
```

3 Fill in the five required settings in `.env`:

| Setting | What to put there |
|---------|-------------------|
| `INITIAL_ADMIN_EMAIL` | Email of the first administrator. |
| `INITIAL_ADMIN_PASSWORD` | Their password, at least 8 characters. |
| `TS_ENCRYPTION_KEY` | Random secret that encrypts stored credentials and signs releases. Keep it: changing it later makes stored credentials unreadable unless you follow [Rotating the encryption key](#rotating-the-encryption-key). |
| `MONGO_ROOT_PASSWORD` | Password for the bundled MongoDB's root user. |
| `MONGO_APP_PASSWORD` | Password for the MongoDB user the app connects with (read/write on its own database only). |

Generate the secrets with:
```
openssl rand -hex 32
```
Use hex or other URL-safe values for the MongoDB passwords; they are placed in a
connection string unescaped. Both MongoDB users are created when the database volume is
first created, so changing these settings later has no effect on an existing volume.

`INITIAL_COMPANY_NAME` is optional (default `My company`).

4 Build and start:
```
docker compose up -d --build
```
The first build takes several minutes. Follow the start-up with
`docker compose logs -f ts_core`; on the first start the app is ready once it logs
`=> Initial admin created`.

5 On the same machine, open http://localhost:3000 and sign in with `INITIAL_ADMIN_EMAIL` and
`INITIAL_ADMIN_PASSWORD`. The administrator and the company are created on the first
start only, while the database has no users; changing these settings later has no effect.

Mails the app sends (invitations, password resets) are caught by Mailpit at
http://localhost:8025.

### Optional settings

| Setting | Default | Purpose |
|---------|---------|---------|
| `ROOT_URL` | `http://localhost:3000/` | Public URL of the app: the address users open. Links in mails use it, and live updates are refused from any other origin. |
| `TS_BIND_ADDRESS` | `127.0.0.1` | Address port 3000 is published on. Keep it local behind a reverse proxy; `0.0.0.0` publishes it on every interface. |
| `TS_ALLOWED_DDP_ORIGINS` | unset | Further origins (comma-separated) users may open the app from. |
| `HTTP_FORWARDED_COUNT` | `0` | Number of reverse proxies in front of the app; the client IP is then read from `X-Forwarded-For`. Never set it higher than the real number: a client could then forge its address. |
| `TS_ALLOWED_PRIVATE_HOSTS` | unset | Internal hosts that integration URLs (Jira, TFS, webhooks, logos) may reach, for every company on the installation; other private, loopback and link-local addresses are refused. Comma-separated host names (`jira.corp.local`), domain suffixes (`.corp.local`), IP addresses and CIDR ranges (`10.20.0.0/16`). A listed name is trusted for any internal address it resolves to, so list only hosts you control. Cloud metadata addresses stay blocked. |
| `TS_UPLOAD_MAX_MB` | `50` | Largest file one REST file upload (scan, SARIF, import) may send, in MB. A larger file is refused with HTTP 413. |
| `TS_ANALYSIS_CONCURRENCY` | `2` | How many module analyses run at the same time. |
| `TS_VULN_ALERT_SWEEP`, `TS_VULN_ALERT_INTERVAL_MIN`, `TS_VULN_ALERT_PROJECT_BATCH`, `TS_VULN_ALERT_RELEASE_BATCH` | `true`, `60`, `25`, `10` | Vulnerability alerts: a background sweep re-checks the approved releases of projects that have a webhook with a vulnerability trigger and notifies it of new findings. `TS_VULN_ALERT_SWEEP=false` turns it off. The interval is in minutes; the batch sizes bound how many projects, and releases per project, one pass checks. Releases are taken in turn, so all are covered over several passes. |
| `MONGO_ROOT_USERNAME`, `MONGO_APP_USERNAME` | `admin`, `trustsource` | MongoDB user names. |
| `REGISTRATION_ENABLED` | `false` | Allow self sign-up on the login page. |
| `TS_OSV_ENABLED` | `true` | Look up vulnerabilities in OSV during analysis. |
| `TS_EPSS_ENABLED` | `true` | Fetch EPSS exploit scores. |
| `MAIL_URL`, `MAIL_SENDER` | Mailpit | Send real mail through your SMTP server. |
| `TS_OPERATOR_NAME`, `TS_SUPPORT_EMAIL`, `TS_IMPRINT_URL` | unset | Who runs the installation, a support address and an imprint page, shown in the footer of outgoing mails. |
| `TS_CSAF_PROVIDER_URL`, `TS_CSAF_PROVIDER_PASSPHRASE`, `TS_CSAF_PROVIDER_PASSWORD` | unset | CSAF provider for publishing advisories. All three are needed. |
| `TS_UPDATE_CHECK`, `TS_UPDATE_CHECK_URL` | `true`, TrustSource update check | Look for a newer version on startup. Each check sends this installation's random id to the TrustSource update check at ce.trustsource.io (or to `TS_UPDATE_CHECK_URL`). Set `TS_UPDATE_CHECK=false` to turn it off. |
| `DEBUG_MODE_ENABLED` | `false` | Verbose debug logging of outbound integration calls, webhooks, workers and security guards. Only the literal `true` turns it on. Credentials are redacted, but the log then holds request and response data and user ids: keep it off in production. |
| `TS_RESET_2FA` | unset | Recovery when the only Account admin lost their authenticator: the admin's login e-mail. On every start while it is set, that user's two-factor authentication is turned off, so remove it once they have signed in with the password. Their existing sessions stay signed in. Other users' 2FA is reset by an Account admin in User management. |
| `TS_ENCRYPTION_KEY_LEGACY` | unset | Password of the old, pre-`v2:` encryption scheme, for credentials written by an older installation. See [Rotating the encryption key](#rotating-the-encryption-key). |

### Serving users over HTTPS

The app speaks plain HTTP on port 3000 and is published on 127.0.0.1 only. To serve
users, put a reverse proxy that terminates TLS in front of it (nginx, Caddy, Traefik,
a load balancer) and:

- set `ROOT_URL` to the HTTPS address users open, for example `https://ts.example.org/`;
- forward WebSocket upgrades (the app keeps a live connection on `/websocket` and `/sockjs`);
- send `X-Forwarded-Proto`. With an `https` `ROOT_URL`, a request the proxy received
  over plain HTTP is redirected to HTTPS;
- send `X-Forwarded-For` and set `HTTP_FORWARDED_COUNT` to the number of proxies in front
  of the app, typically `1`. Otherwise every user appears to come from the proxy's
  address and they share the per-IP sign-in rate limits and login history entries. Never
  set it higher than the real number of proxies: a client could then forge its address.

Without TLS, sign-in, session tokens and API keys travel unencrypted.

### Day-to-day

```
docker compose stop                    # stop, keep data
docker compose up -d --build           # update after a git pull
docker compose down -v                 # remove everything, including all data
```

Data lives in two named volumes: `mongo-data` (database) and `ts-files` (uploaded files).

Updating from 1.0.1 to 1.0.2 needs no manual step: LeanIX tokens saved in plaintext by
earlier versions are encrypted on the first start. The Updates page shows the release
notes of each version.

Back up the database and the uploaded files. The backup contains personal data,
password hashes and encrypted credentials: `tools/backup.sh` writes it readable by
you only and outside the checkout (default `~/ts-backups/<date-time>`), and refuses a
directory inside it.
```
tools/backup.sh [directory]
```

Restore from such a directory:
```
docker compose exec -T mongo sh -c 'mongorestore -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --archive' < <directory>/backup.archive
docker compose exec -T ts_core tar xzf - -C /app.storage/files < <directory>/ts-files.tar.gz
```

### Rotating the encryption key

1 In `.env`, move the current `TS_ENCRYPTION_KEY` value to `TS_ENCRYPTION_KEY_PREVIOUS` and
set a new `TS_ENCRYPTION_KEY`.

2 Start (`docker compose up -d`) once with `TS_REENCRYPT_SECRETS=dry` to log what would change, then once with
`TS_REENCRYPT_SECRETS=true` to rewrite the stored credentials (integration tokens, API
keys, release and CSAF feed keys, webhook URLs, headers and signing secrets) with the new key.

3 Remove `TS_REENCRYPT_SECRETS`. Keep `TS_ENCRYPTION_KEY_PREVIOUS` while release
signatures and published CSAF product ids made with the old key must still verify.

A database taken over from an older installation may hold integration credentials (Jira,
TFS, GitHub, SCANOSS) in the old, pre-`v2:` encryption scheme. Set that scheme's password
as `TS_ENCRYPTION_KEY_LEGACY` to keep them readable, and run steps 2 and 3 to rewrite them
with `TS_ENCRYPTION_KEY`. Once a `TS_REENCRYPT_SECRETS=dry` run logs nothing left to
migrate and no failures, remove `TS_ENCRYPTION_KEY_LEGACY`. An installation that always ran
with `TS_ENCRYPTION_KEY` set does not need it.

# Development instructions

## Install required components

1 Meteor 3.5 https://docs.meteor.com/about/install.html

2 Node.js (v24) https://nodejs.org/en/download/ (NVM recommended https://github.com/nvm-sh/nvm)

3 Install node dependencies
```
yarn install
```

4 Create `.env` in the root of the project from `.env.example` (see the Quickstart for the
required settings; `imports/server/config.js` lists every setting)

5 Run development server
```
meteor
```
Meteor starts its own MongoDB on port 3001.

## Backup Mongo (development)

1. Start app
2. Wait for: => Started MongoDB.
3. mongodump --host localhost --port 3001 --out dump

## Restore Mongo (development)

1. Start app
2. Wait for: => Started MongoDB.
3. mongorestore --host localhost --port 3001 dump/


# Build instructions

## build package


```
npm run meteor-build
```

which is a shortcut for

```
meteor build --server-only --architecture os.linux.x86_64 --directory ../build
```

# Contributing

Issues and pull requests are welcome at https://github.com/TrustSource/ts-core-ce.
Before opening a pull request, run `yarn lint`, the unit specs
(`npx jest --testPathPatterns 'test_api/specs/.*unit\.spec\.js$'`) and `yarn test:workers`.
By contributing you agree that your contribution is licensed under the AGPL-3.0.

# Security

Please do not report security issues in public issues. Use GitHub's private
vulnerability reporting on https://github.com/TrustSource/ts-core-ce
(Security > Report a vulnerability).

# License

TrustSource Community Edition is licensed under the
[GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0-only).
Third-party notices and trademark terms are in [NOTICE](NOTICE).
