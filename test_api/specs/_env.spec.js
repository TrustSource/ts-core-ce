/* eslint-disable no-undef*/

// The settings every API spec needs. Fixture ids (PROJECT_ID, RELEASE_API_KEY, CVE_ID,
// the CSAF keys) are optional: the specs that read them create their own data or skip.
describe(`Environment variable is accessible`, () => {
  it(`BASE`, async () => {
    await expect(process.env.BASE).toBeDefined();
  });
  it(`ROOT_URL`, async () => {
    await expect(process.env.ROOT_URL).toBeDefined();
  });
  it(`API_KEY`, async () => {
    await expect(process.env.API_KEY).toBeDefined();
  });
});
