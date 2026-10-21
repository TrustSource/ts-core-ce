/* eslint-disable no-undef*/
const supertest = require('supertest');
const StatusCodes = require('http-status-codes');
const ROOT_URL =  process.env.ROOT_URL;
const BASE =  process.env.BASE;
const API_KEY =  process.env.API_KEY;

// This suite is the one place that must NOT accept the idempotent 200. It
// captures the id the create returned and then RENAMES that project, rewrites its settings
// and description, and finally deletes it - so adopting a project the company already owned
// would rename and delete a real one. It was posting the literal name `TEST`, which is
// exactly the kind of name a company already has.
//
// A run-unique name keeps 201 the correct and only answer, which is also what the delete at
// the end of the suite depends on: that delete does not pass `?force=true`, so it is refused
// with 400 the moment the project it addresses owns a module - and a project this suite
// created itself never does.
const PROJECT_NAME = `TEST_PROJECTS_API_${Date.now()}`;

describe(`${BASE}/core/projects`, () => {
  let projectId; // variable to use real project in /{projectId}  methods
  let url = `${BASE}/core/projects`
  it(`401 GET ${url}`, async () => {
    await supertest(ROOT_URL).get(url)
      .expect(StatusCodes.UNAUTHORIZED);
  });
  it(`403 GET ${url}`, async () => {
    await supertest(ROOT_URL).get(url)
      .set('x-api-key', 'SOMEKEY')
      .expect(StatusCodes.FORBIDDEN);
  });
  it(`200 GET ${url}`, async () => {
    await supertest(ROOT_URL).get(url)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.OK)
      .then((response) => {
        expect(Array.isArray(response.body)).toBeTruthy()
        expect(response.body.length).toBeGreaterThan(1)

        expect(response.body[0]).toHaveProperty('_id')
        expect(response.body[0]).toHaveProperty('name')
        expect(response.body[0]).not.toHaveProperty('relatedUsers')
        expect(response.body[0]).not.toHaveProperty('requirements')
      })
  });

  it(`401 POST ${url}`, async () => {
    await supertest(ROOT_URL).post(url)
      .expect(StatusCodes.UNAUTHORIZED);
  });
  it(`403 POST ${url}`, async () => {
    await supertest(ROOT_URL).post(url)
      .set('x-api-key', 'SOMEKEY')
      .expect(StatusCodes.FORBIDDEN);
  });
  it(`200 POST ${url}`, async () => {
    const data = {
      name: PROJECT_NAME
    }
    await supertest(ROOT_URL).post(url).send(data)
      .set('x-api-key', API_KEY)
      // 201 and nothing else: the name is unique to this run, so an existing-name 200 here
      // would mean the idempotency lookup matched something it should not have.
      .expect(StatusCodes.CREATED)
      .then((response) => {
        expect(response.body).toHaveProperty('projectId')
        projectId = response.body.projectId
      })
  });

  it(`401 GET ${url}/{projectId}`, async () => {
    let urlTmp = `${url}/${projectId}`
    await supertest(ROOT_URL).get(urlTmp)
      .expect(StatusCodes.UNAUTHORIZED);
  });
  it(`403 GET ${url}/{projectId}`, async () => {
    let urlTmp = `${url}/${projectId}`
    await supertest(ROOT_URL).get(urlTmp)
      .set('x-api-key', 'SOMEKEY')
      .expect(StatusCodes.FORBIDDEN);
  });
  it(`404 GET ${url}/{projectId}`, async () => {
    let urlTmp = `${url}/WRONG_ID`
    await supertest(ROOT_URL).get(urlTmp)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.NOT_FOUND);
  });
  it(`200 GET ${url}/{projectId}`, async () => {
    let urlTmp = `${url}/${projectId}`
    await supertest(ROOT_URL).get(urlTmp)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.OK)
      .then((response) => {
        expect(response.body).toHaveProperty('_id')
        expect(response.body).toHaveProperty('name')
        expect(response.body).not.toHaveProperty('relatedUsers')
      })
  });

  it(`401 POST ${url}/{projectId}`, async () => {
    let urlTmp = `${url}/${projectId}`
    await supertest(ROOT_URL).post(urlTmp)
      .expect(StatusCodes.UNAUTHORIZED);
  });
  it(`403 POST ${url}/{projectId}`, async () => {
    let urlTmp = `${url}/${projectId}`
    await supertest(ROOT_URL).post(urlTmp)
      .set('x-api-key', 'SOMEKEY')
      .expect(StatusCodes.FORBIDDEN);
  });
  it(`404 POST ${url}/{projectId}`, async () => {
    let urlTmp = `${url}/WRONG_ID`
    await supertest(ROOT_URL).post(urlTmp)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.NOT_FOUND);
  });
  it(`200 POST ${url}/{projectId}`, async () => {
    let urlTmp = `${url}/${projectId}`
    const data = {
      // Renamed within this run's own namespace: a rename onto a name the company already
      // uses would leave behind exactly the duplicate that the ingest
      // endpoints then have to arbitrate.
      name: `${PROJECT_NAME}_RENAMED`
    }
    await supertest(ROOT_URL).post(urlTmp).send(data)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.OK)
      .then((response) => {
        expect(response.body).toHaveProperty('name')
        expect(response.body.name).toBe(data.name);
      })
  });
  // The update arm used to answer with the WHOLE stored document - an unprojected
  // findOneAsync, JSON.stringify'd - behind PROJECT_POST_ROLES, which includes `developer`.
  // Reading the same project through GET requires a manager-tier scope, so the echo handed a
  // developer-scoped key the jira/tfs/github credentials and relatedUsers that the read
  // endpoint deliberately withholds. Both arms now share one whitelist (PROJECT_API_FIELDS).
  it(`200 POST ${url}/{projectId} echoes settings, never credentials or ownership`, async () => {
    let urlTmp = `${url}/${projectId}`
    // Store a credential-shaped integration config FIRST, so the "not echoed" assertion
    // below cannot pass simply because the field was never set on this project.
    await supertest(ROOT_URL).post(urlTmp)
      .send({github: {token: 'NOT_A_REAL_TOKEN', repository: 'eacg-gmbh/ts-app', active: false}})
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.OK)
      .then((response) => {
        expect(response.body).not.toHaveProperty('github')
      })
    await supertest(ROOT_URL).post(urlTmp)
      .send({requireWhitelist: true})
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.OK)
      .then((response) => {
        // What the echo must keep - API clients read-modify-write settings through it.
        expect(response.body).toHaveProperty('name')
        expect(response.body).toHaveProperty('requireWhitelist')
        expect(response.body.requireWhitelist).toBe(true)
        // ...and what it must not carry. `github` is provably set on this project by the
        // call above and `companyId` is on every stored project, so neither of those two
        // can pass vacuously; `jira`, `tfs` and `relatedUsers` are the same class of field
        // and are asserted as the contract rather than as an observation.
        expect(response.body).not.toHaveProperty('github')
        expect(response.body).not.toHaveProperty('jira')
        expect(response.body).not.toHaveProperty('tfs')
        expect(response.body).not.toHaveProperty('relatedUsers')
        expect(response.body).not.toHaveProperty('companyId')
      })
  });
  // Settings round-trip: POST settings, then GET must return them so API
  // clients can read-modify-write configs (POST replaces configs as a whole).
  // Integration settings (jira/tfs/github) must stay write-only: they hold
  // credentials and must never be exposed via GET.
  it(`200 POST+GET ${url}/{projectId} settings round-trip`, async () => {
    let urlTmp = `${url}/${projectId}`
    const settings = {
      licenseConfig: {
        whitelist: [{key: 'MIT', comment: 'approved by legal'}],
        blacklist: [{key: 'AGPL-3.0-only', comment: 'not allowed'}]
      },
      componentConfig: {
        whitelist: [],
        blacklist: [{key: 'npm:left-pad', version: '*', comment: 'banned'}],
        unchanged: [],
        looseCoupled: []
      },
      requirements: {CA: 'CA_none', OM: 'OM_SaaS', IP_protect: 'IP_protect_n', IP_enforce: 'IP_enforce_1'},
      requireWhitelist: true,
      github: {token: 'TEST_TOKEN', repository: 'org/repo', active: false}
    }
    await supertest(ROOT_URL).post(urlTmp).send(settings)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.OK)
      .then((response) => {
        expect(response.body.licenseConfig).toEqual(settings.licenseConfig)
        expect(response.body.requirements).toEqual(settings.requirements)
        expect(response.body.requireWhitelist).toBe(true)
      })
    await supertest(ROOT_URL).get(urlTmp)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.OK)
      .then((response) => {
        expect(response.body.licenseConfig).toEqual(settings.licenseConfig)
        expect(response.body.componentConfig).toEqual(settings.componentConfig)
        expect(response.body.requirements).toEqual(settings.requirements)
        expect(response.body.requireWhitelist).toBe(true)
        // credentials must never be readable via the API
        expect(response.body).not.toHaveProperty('github')
        expect(response.body).not.toHaveProperty('jira')
        expect(response.body).not.toHaveProperty('tfs')
        expect(response.body).not.toHaveProperty('relatedUsers')
      })
  });

  // autoCreateCweRisks decides whether a SARIF import writes into
  // this project's risk register, so it must round-trip through POST → GET (AC3).
  // It has NO schema default: "off" is spelled "absent", so a
  // project that has never been told otherwise must not come back carrying it.
  it(`200 POST+GET ${url}/{projectId} autoCreateCweRisks round-trip`, async () => {
    let urlTmp = `${url}/${projectId}`
    await supertest(ROOT_URL).post(urlTmp).send({autoCreateCweRisks: true})
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.OK)
      .then((response) => {
        expect(response.body.autoCreateCweRisks).toBe(true)
      })
    await supertest(ROOT_URL).get(urlTmp)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.OK)
      .then((response) => {
        expect(response.body).toHaveProperty('autoCreateCweRisks')
        expect(response.body.autoCreateCweRisks).toBe(true)
      })
    // ...and switching it back off is just as readable.
    await supertest(ROOT_URL).post(urlTmp).send({autoCreateCweRisks: false})
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.OK)
    await supertest(ROOT_URL).get(urlTmp)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.OK)
      .then((response) => {
        expect(response.body.autoCreateCweRisks).toBe(false)
      })
  });
  it(`400 POST ${url}/{projectId} rejects a non-boolean autoCreateCweRisks`, async () => {
    let urlTmp = `${url}/${projectId}`
    await supertest(ROOT_URL).post(urlTmp).send({autoCreateCweRisks: 'yes'})
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.BAD_REQUEST)
  });

  // Architecture upload/read: POST stores content into the
  // project's `description` ("Application goals") field; GET reads it back.
  // Mirrors the settings-round-trip style above.
  describe(`${url}/{projectId}/architecture`, () => {
    const archUrl = () => `${url}/${projectId}/architecture`;
    const benignContent = '# Application goals\n\nThis project implements an order-processing ' +
      'microservice using Node.js and MongoDB, deployed behind an API gateway to reduce latency.';
    // ~28KB of realistic markdown (well over the old 2000-char schema cap,
    // well under the 100KB PROJECT_DESCRIPTION_MAX) - a real architecture.md
    // upload is this shape/size, not the short benignContent above. Locks in
    // the schema-cap-raise regression end-to-end through the
    // dedicated architecture endpoint.
    const realisticArchitectureDoc = [
      '# Application goals',
      '',
      'This project implements an order-processing microservice using Node.js and',
      'MongoDB, deployed behind an API gateway to reduce end-to-end latency and',
      'improve resilience across regions.',
      '',
      '## Components',
      '',
      '- checkout-api: accepts orders, validates inventory, emits OrderPlaced events',
      '- fulfillment-worker: consumes OrderPlaced, reserves stock, schedules shipping',
      '- notification-service: sends order-status emails and SMS updates',
      '',
      '## Data flow',
      '',
      'Requests enter through the API gateway, which authenticates the caller and',
      'forwards to checkout-api. checkout-api persists the order to MongoDB and',
      'publishes an event to the queue. Downstream workers process events',
      'asynchronously so the customer-facing request path stays fast.'
    ].join('\n').repeat(40); // repeated to reach ~28KB of realistic prose

    it(`401 GET ${url}/{projectId}/architecture`, async () => {
      await supertest(ROOT_URL).get(archUrl())
        .expect(StatusCodes.UNAUTHORIZED);
    });
    it(`403 GET ${url}/{projectId}/architecture`, async () => {
      await supertest(ROOT_URL).get(archUrl())
        .set('x-api-key', 'SOMEKEY')
        .expect(StatusCodes.FORBIDDEN);
    });
    it(`404 GET ${url}/WRONG_ID/architecture`, async () => {
      await supertest(ROOT_URL).get(`${url}/WRONG_ID/architecture`)
        .set('x-api-key', API_KEY)
        .expect(StatusCodes.NOT_FOUND);
    });
    it(`200 GET ${url}/{projectId}/architecture returns an empty content before anything is uploaded`, async () => {
      await supertest(ROOT_URL).get(archUrl())
        .set('x-api-key', API_KEY)
        .expect(StatusCodes.OK)
        .then((response) => {
          expect(response.body).toHaveProperty('content');
          expect(response.body.content).toBe('');
        });
    });

    it(`401 POST ${url}/{projectId}/architecture`, async () => {
      await supertest(ROOT_URL).post(archUrl())
        .expect(StatusCodes.UNAUTHORIZED);
    });
    it(`403 POST ${url}/{projectId}/architecture`, async () => {
      await supertest(ROOT_URL).post(archUrl())
        .set('x-api-key', 'SOMEKEY')
        .send({content: benignContent})
        .expect(StatusCodes.FORBIDDEN);
    });
    it(`404 POST ${url}/WRONG_ID/architecture`, async () => {
      await supertest(ROOT_URL).post(`${url}/WRONG_ID/architecture`)
        .set('x-api-key', API_KEY)
        .send({content: benignContent})
        .expect(StatusCodes.NOT_FOUND);
    });
    it(`400 POST ${url}/{projectId}/architecture rejects non-string content, leaving description unchanged`, async () => {
      await supertest(ROOT_URL).post(archUrl())
        .set('x-api-key', API_KEY)
        .send({content: {not: 'a string'}})
        .expect(StatusCodes.BAD_REQUEST)
        .then((response) => {
          expect(response.body).toHaveProperty('error');
        });
      // Same "rejected POST must not mutate description" guarantee asserted
      // for the size-cap 400 below - proven here too so both 400 branches of
      // the POST handler are covered.
      await supertest(ROOT_URL).get(archUrl())
        .set('x-api-key', API_KEY)
        .expect(StatusCodes.OK)
        .then((response) => {
          expect(response.body.content).toBe('');
        });
    });
    it(`400 POST ${url}/{projectId}/architecture rejects content over the size cap, leaving description unchanged`, async () => {
      await supertest(ROOT_URL).post(archUrl())
        .set('x-api-key', API_KEY)
        .send({content: 'x'.repeat(101 * 1024)})
        .expect(StatusCodes.BAD_REQUEST)
        .then((response) => {
          expect(response.body.error).toMatch(/too large/i);
        });
      await supertest(ROOT_URL).get(archUrl())
        .set('x-api-key', API_KEY)
        .expect(StatusCodes.OK)
        .then((response) => {
          expect(response.body.content).toBe('');
        });
    });
    it(`200 POST+GET ${url}/{projectId}/architecture round-trip with a realistic ~28KB architecture.md`, async () => {
      await supertest(ROOT_URL).post(archUrl())
        .set('x-api-key', API_KEY)
        .send({content: realisticArchitectureDoc})
        .expect(StatusCodes.OK)
        .then((response) => {
          expect(response.body).toHaveProperty('projectId');
          expect(response.body.projectId).toBe(projectId);
          expect(response.body.content).toBe(realisticArchitectureDoc);
        });
      await supertest(ROOT_URL).get(archUrl())
        .set('x-api-key', API_KEY)
        .expect(StatusCodes.OK)
        .then((response) => {
          expect(response.body.content).toBe(realisticArchitectureDoc);
        });
      // The upload must have landed in the project's `description` field,
      // readable via the existing project GET endpoint too.
      await supertest(ROOT_URL).get(`${url}/${projectId}`)
        .set('x-api-key', API_KEY)
        .expect(StatusCodes.OK)
        .then((response) => {
          expect(response.body.description).toBe(realisticArchitectureDoc);
        });
    });
    // The ~28KB round-trip above is plain ASCII prose with only '#'/'-'
    // markdown syntax, so it never proves byte-for-byte fidelity for non-ASCII
    // content, richer markdown syntax (bold/italic/links/blockquotes/tables),
    // or mixed line endings - all of which a genuine architecture.md upload
    // can plausibly contain. This test closes that gap.
    it(`200 POST+GET ${url}/{projectId}/architecture round-trip preserves unicode, rich markdown syntax, ` +
      'and mixed line endings byte-for-byte', async () => {
      const richContent = [
        '# Application goals (Ziele der Anwendung)',
        '',
        'This project supports naive users in a cafe in Munich, with accents like ' +
          'café, naïve, and Zürich rendered correctly.',
        '',
        '## Components (组件 / Компоненты)',
        '',
        '- checkout-api: handles orders 🚀',
        '- fulfillment-worker: reserves stock ✅',
        '',
        '> Note: all data stays within the EU region.',
        '',
        '| Component | Owner |',
        '| --- | --- |',
        '| checkout-api | Team A |',
        '| fulfillment-worker | Team B |',
        '',
        'See [the runbook](https://example.com/runbook) for on-call details.',
        '',
        'Status update: 进度良好, всё идёт по плану.'
      ].join('\n') + '\r\n\r\nWindows-authored trailing section.\r\nSecond CRLF line.\r\n';

      await supertest(ROOT_URL).post(archUrl())
        .set('x-api-key', API_KEY)
        .send({content: richContent})
        .expect(StatusCodes.OK)
        .then((response) => {
          expect(response.body.content).toBe(richContent);
        });
      await supertest(ROOT_URL).get(archUrl())
        .set('x-api-key', API_KEY)
        .expect(StatusCodes.OK)
        .then((response) => {
          // Exact string equality - not just "contains" - so any mangling
          // (unicode re-encoding, CRLF -> LF normalization, whitespace
          // trimming anywhere in the stack) would fail this.
          expect(response.body.content).toBe(richContent);
          expect(response.body.content.length).toBe(richContent.length);
        });
    });
    it(`200 OPTIONS ${url}/{projectId}/architecture`, async () => {
      await supertest(ROOT_URL).options(archUrl())
        .expect(StatusCodes.OK);
    });
  });

  // Regression: the "Application goals" / `description` field's
  // schema cap was raised from a literal 2000 to PROJECT_DESCRIPTION_MAX
  // (100KB) so an uploaded architecture.md can populate it. This generic
  // project POST endpoint runs the FULL ProjectSchema validation (via
  // helpers.cleanAndValidateProject -> ProjectSchema.newContext().validate),
  // unlike the dedicated /architecture endpoint above which does its own
  // explicit size check - so this is the concrete path that would have kept
  // failing with "Application goals cannot exceed 2000 characters" if the
  // schema's `max:` were left at the literal 2000 while only the
  // PROJECT_DESCRIPTION_MAX constant itself was introduced unused. Placed
  // AFTER the architecture describe block (not before) so it does not
  // clobber the "starts empty" assertions above - clean() strips an empty-
  // string `description` before the $set, so there is no cheap way to reset
  // it via this same endpoint once set.
  it(`200 POST ${url}/{projectId} accepts a description well over the old 2000-char cap`, async () => {
    let urlTmp = `${url}/${projectId}`
    const longDescription = 'A'.repeat(10 * 1024); // 10KB - well above 2000, well under the 100KB cap
    await supertest(ROOT_URL).post(urlTmp).send({description: longDescription})
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.OK)
      .then((response) => {
        expect(response.body.description).toBe(longDescription);
      });
  });

  it(`401 DELETE ${url}/{projectId}`, async () => {
    let urlTmp = `${url}/${projectId}`
    await supertest(ROOT_URL).delete(urlTmp)
      .expect(StatusCodes.UNAUTHORIZED);
  });
  it(`403 DELETE ${url}/{projectId}`, async () => {
    let urlTmp = `${url}/${projectId}`
    await supertest(ROOT_URL).delete(urlTmp)
      .set('x-api-key', 'SOMEKEY')
      .expect(StatusCodes.FORBIDDEN);
  });
  it(`404 DELETE ${url}/{projectId}`, async () => {
    let urlTmp = `${url}/WRONG_ID`
    await supertest(ROOT_URL).delete(urlTmp)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.NOT_FOUND)
  });
  it(`200 DELETE ${url}/{projectId}`, async () => {
    let urlTmp = `${url}/${projectId}`
    await supertest(ROOT_URL).delete(urlTmp)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.NO_CONTENT)
  });
});
