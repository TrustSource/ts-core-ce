/* eslint-disable no-undef */
// resolveActingUser, loaded from its real source with a stubbed Meteor.
//
// A client DDP call (context.connection set) acts as the authenticated session
// user and never as a user object taken from the arguments; a server / internal
// call (no connection) trusts the user it was handed.
const {loadMeteorModule} = require('../helpers/loadMeteorModule');

class FakeMeteorError extends Error {
  constructor(error, reason) {
    super(`[${error}] ${reason}`);
    this.error = error;
    this.reason = reason;
  }
}

const SESSION_USER = {_id: 'sessionUser', profile: {companyId: 'ownCompany'}};
const FORGED_USER = {_id: 'sessionUser', profile: {companyId: 'victimCompany'}};

function load(sessionUser = SESSION_USER) {
  const usersFindOne = jest.fn(async (id) => (id === SESSION_USER._id ? sessionUser : null));
  const userAsync = jest.fn(async () => sessionUser);
  const {resolveActingUser} = loadMeteorModule('imports/server/security/actingUser.js', {
    'meteor/meteor': {Meteor: {Error: FakeMeteorError, users: {findOneAsync: usersFindOne}, userAsync}}
  });
  return {resolveActingUser, usersFindOne, userAsync};
}

const clientCtx = (userId) => ({connection: {id: 'ddp-1'}, userId});

describe('resolveActingUser', () => {
  it('ignores a client-supplied user and returns the session user', async () => {
    const {resolveActingUser, usersFindOne} = load();
    const user = await resolveActingUser(clientCtx('sessionUser'), FORGED_USER);
    expect(user).toBe(SESSION_USER);
    expect(user.profile.companyId).toBe('ownCompany');
    expect(usersFindOne).toHaveBeenCalledWith('sessionUser');
  });

  it('reads the session user even when no user was supplied', async () => {
    const {resolveActingUser, usersFindOne, userAsync} = load();
    const user = await resolveActingUser(clientCtx('sessionUser'), undefined);
    expect(user).toBe(SESSION_USER);
    expect(usersFindOne).toHaveBeenCalled();
    expect(userAsync).not.toHaveBeenCalled();
  });

  it('throws 403 for a client call with no logged-in user', async () => {
    const {resolveActingUser} = load();
    await expect(resolveActingUser(clientCtx(null), FORGED_USER)).rejects.toMatchObject({error: 403});
  });

  it('trusts the supplied user on a server call (no connection)', async () => {
    const {resolveActingUser, usersFindOne} = load();
    const supplied = {_id: 'restUser', profile: {companyId: 'restCompany'}};
    expect(await resolveActingUser({connection: null, userId: null}, supplied)).toBe(supplied);
    expect(await resolveActingUser(undefined, supplied)).toBe(supplied);
    expect(usersFindOne).not.toHaveBeenCalled();
  });

  it('falls back to Meteor.userAsync on a server call with no supplied user', async () => {
    const {resolveActingUser, userAsync} = load();
    expect(await resolveActingUser(undefined, undefined)).toBe(SESSION_USER);
    expect(userAsync).toHaveBeenCalled();
  });
});
