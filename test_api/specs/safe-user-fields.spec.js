/* eslint-disable no-undef */
// Unit tests for the user-record sanitizer that prevents enrollment / reset /
// login tokens and password hashes from being returned by the getUsers* methods.
const {
  SAFE_USER_FIELD_NAMES,
  SAFE_USER_FIELDS,
  sanitizeUser,
  sanitizeUsers
} = require('../../imports/server/security/safeUserFields');

// A full user record as Mongo stores it - mirrors the leak in the report.
const fullUser = () => ({
  _id: 'eq7EcrRXnE2F4SjBY',
  createdAt: new Date('2026-06-01T00:00:00Z'),
  emails: [{ address: 'invited-user@company.com', verified: false }],
  profile: { name: 'NewEmployee', companyId: 'PcXS3yenAp6MNX7sM', invitedBy: 'x' },
  realms: ['TrustSource'],
  username: 'newemployee',
  services: {
    password: {
      bcrypt: '$2b$10$U014IXhOgqW/vWT8xDPEluSKIrT56If3IStXylvPa0iy98eDV5FKa',
      enroll: { token: 'oQ1H4D8rQ0YDsEmbkky5HYNkAdy73BVGHoRLWW64nBA', reason: 'enroll' }
    },
    email: { verificationTokens: [{ token: 'x-Tr5rAnD6yYoQtcbjKw5avzLa088t0ku7rWwNQdATM' }] },
    resume: { loginTokens: [{ hashedToken: 'f2cD7uRTvSoUqWyeHvL6N5mkRhbt+RhrUFqQ5Vl2' }] }
  }
});

describe('safeUserFields', () => {
  describe('sanitizeUser', () => {
    it('removes the entire services field (tokens + password hash)', () => {
      const safe = sanitizeUser(fullUser());
      expect(safe.services).toBeUndefined();
      // No sensitive value survives anywhere in the serialized output.
      const serialized = JSON.stringify(safe);
      expect(serialized).not.toContain('oQ1H4D8rQ0YDsEmbkky5HYNkAdy73BVGHoRLWW64nBA'); // enroll token
      expect(serialized).not.toContain('$2b$10$'); // bcrypt hash prefix
      expect(serialized).not.toContain('verificationTokens');
      expect(serialized).not.toContain('loginTokens');
    });

    it('keeps the non-sensitive fields the UI needs', () => {
      const safe = sanitizeUser(fullUser());
      expect(safe._id).toBe('eq7EcrRXnE2F4SjBY');
      expect(safe.profile.name).toBe('NewEmployee');
      expect(safe.emails[0].address).toBe('invited-user@company.com');
      expect(safe.createdAt).toBeInstanceOf(Date);
    });

    it('returns only allow-listed top-level keys (drops e.g. username and realms)', () => {
      const safe = sanitizeUser(fullUser());
      expect(Object.keys(safe).sort()).toEqual(
        ['_id', 'createdAt', 'emails', 'profile'].sort()
      );
      expect(safe.username).toBeUndefined();
      expect(safe.realms).toBeUndefined();
    });

    it('only emits keys that exist on the source document', () => {
      const safe = sanitizeUser({ _id: 'a', profile: { name: 'n' } });
      expect(Object.keys(safe).sort()).toEqual(['_id', 'profile']);
    });

    it('passes through non-objects untouched', () => {
      expect(sanitizeUser(null)).toBeNull();
      expect(sanitizeUser(undefined)).toBeUndefined();
    });
  });

  describe('sanitizeUsers', () => {
    it('sanitizes every element of an array', () => {
      const result = sanitizeUsers([fullUser(), fullUser()]);
      expect(result).toHaveLength(2);
      result.forEach((u) => expect(u.services).toBeUndefined());
    });

    it('returns non-arrays unchanged', () => {
      expect(sanitizeUsers(null)).toBeNull();
    });
  });

  describe('SAFE_USER_FIELDS projection', () => {
    it('is an inclusion projection that never lists services', () => {
      expect(SAFE_USER_FIELDS).not.toHaveProperty('services');
      Object.values(SAFE_USER_FIELDS).forEach((v) => expect(v).toBe(1));
    });

    it('matches the allow-listed field names (minus the always-present _id)', () => {
      const projectionKeys = Object.keys(SAFE_USER_FIELDS).sort();
      const expected = SAFE_USER_FIELD_NAMES.filter((k) => k !== '_id').sort();
      expect(projectionKeys).toEqual(expected);
    });
  });
});
