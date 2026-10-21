# TrustSource API tests

## Related tools

https://jestjs.io/ - testing framework

https://github.com/ladjs/supertest - lib to extends test scenarios

https://github.com/prettymuchbryce/http-status-codes - lib to map status codes

## Testing CLI

`.env.jest` - Environment file that may be used for local development

`yarn run test`

Execute tests inside selected folder

`yarn run test:watch`

Watch changes in file system and run tests

`yarn run test:one`

Execute a selected test file

## Environment variables

`ROOT_URL`=http://localhost:3000

`BASE`=/api/v2

`API_KEY`=<your-api-key>

`RELEASE_API_KEY`=<a-release-api-key>

`PROJECT_ID`=<your-project-id>

`CVE_ID`=CVE-2023-35800


## Test files/scenarios

`test_api/response` - contains related documents to simplify re-usage fore sample for scan document

`test_api/response` - contains test that will be executed during test action

## Test file structure and description

`describe` - creates a block that groups together several related tests

`it` - test, that have name and functions inside

`supertest` - API request lib to process request and response params

`expect` - case to be tested, for sample response status or content

