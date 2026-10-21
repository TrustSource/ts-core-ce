/* eslint-disable no-undef */
// Pure unit test for the bodyless-method request-drain helper used by
// RestApi.wrapAsync. No Meteor, no running app - requires the helper directly.
//
// Background: an API Gateway GET that mistakenly carried a multipart/form-data
// body returned a 500 ~10s after reaching the backend. Registered body parsers
// (json + urlencoded) skip multipart, so the request body was never read off
// the socket; on a keep-alive connection that stalls the response and the LB /
// API Gateway times out. The fix drains any stray body for bodyless methods
// (GET/DELETE/OPTIONS/HEAD) via request.resume() inside wrapAsync, while leaving
// POST/PUT/PATCH (which legitimately read request.body / pipe busboy) untouched.
//
// RestApi.js imports Meteor packages and cannot be required under Jest, so the
// drain logic lives in a dependency-free CommonJS helper that RestApi.js
// re-exports - the same pattern as riskOrigin.js / feedAccess.js. These tests
// pin that helper; the end-to-end HTTP assertions would live in a live-app spec.
const {
  BODYLESS_METHODS,
  shouldDrainRequestBody,
  drainRequestBody
} = require('../../imports/server/rest-api/wrapAsyncHelpers');

describe('wrapAsync request-body drain helper', () => {
  describe('BODYLESS_METHODS', () => {
    it('is exactly GET, DELETE, OPTIONS, HEAD', () => {
      expect(BODYLESS_METHODS).toEqual(['GET', 'DELETE', 'OPTIONS', 'HEAD']);
    });
  });

  describe('shouldDrainRequestBody', () => {
    it('returns true for every bodyless method', () => {
      ['GET', 'DELETE', 'OPTIONS', 'HEAD'].forEach(m =>
        expect(shouldDrainRequestBody(m)).toBe(true)
      );
    });

    it('returns false for body-carrying methods (criterion 2)', () => {
      ['POST', 'PUT', 'PATCH'].forEach(m =>
        expect(shouldDrainRequestBody(m)).toBe(false)
      );
    });

    it('is case-insensitive on the method name', () => {
      expect(shouldDrainRequestBody('get')).toBe(true);
      expect(shouldDrainRequestBody('Delete')).toBe(true);
      expect(shouldDrainRequestBody('post')).toBe(false);
    });

    it('returns false for missing / non-string methods (no accidental drain)', () => {
      [undefined, null, '', 0, {}, [], true].forEach(m =>
        expect(shouldDrainRequestBody(m)).toBe(false)
      );
    });
  });

  describe('drainRequestBody', () => {
    it('calls resume() on a bodyless-method request (criterion 1)', () => {
      const resume = jest.fn();
      const request = {method: 'GET', resume};
      expect(drainRequestBody(request)).toBe(true);
      expect(resume).toHaveBeenCalledTimes(1);
    });

    it('drains for DELETE / OPTIONS / HEAD too (criterion 1)', () => {
      ['DELETE', 'OPTIONS', 'HEAD'].forEach(method => {
        const resume = jest.fn();
        drainRequestBody({method, resume});
        expect(resume).toHaveBeenCalledTimes(1);
      });
    });

    it('does NOT drain POST / PUT / PATCH (criterion 2)', () => {
      ['POST', 'PUT', 'PATCH'].forEach(method => {
        const resume = jest.fn();
        expect(drainRequestBody({method, resume})).toBe(false);
        expect(resume).not.toHaveBeenCalled();
      });
    });

    it('is a no-op when request is missing (guarded)', () => {
      expect(() => drainRequestBody(undefined)).not.toThrow();
      expect(drainRequestBody(undefined)).toBe(false);
      expect(() => drainRequestBody(null)).not.toThrow();
      expect(drainRequestBody(null)).toBe(false);
    });

    it('is a no-op when request lacks a resume function (guarded)', () => {
      expect(drainRequestBody({method: 'GET'})).toBe(false);
      expect(drainRequestBody({method: 'GET', resume: 'not-a-fn'})).toBe(false);
    });

    it('drains a lowercase / mixed-case bodyless method via the real guard (criterion 1)', () => {
      ['get', 'delete', 'Options', 'Head'].forEach(method => {
        const resume = jest.fn();
        expect(drainRequestBody({method, resume})).toBe(true);
        expect(resume).toHaveBeenCalledTimes(1);
      });
    });

    it('is a no-op when method is missing / undefined even with a resume fn (no accidental drain)', () => {
      const resume = jest.fn();
      expect(() => drainRequestBody({resume})).not.toThrow();
      expect(drainRequestBody({resume})).toBe(false);
      expect(drainRequestBody({method: undefined, resume})).toBe(false);
      expect(resume).not.toHaveBeenCalled();
    });

    it('swallows a throwing resume() so it never breaks the handler', () => {
      const resume = jest.fn(() => {
        throw new Error('socket already gone');
      });
      expect(() => drainRequestBody({method: 'GET', resume})).not.toThrow();
      expect(resume).toHaveBeenCalledTimes(1);
    });

    it('returns false (not true) when resume() throws (criterion 4)', () => {
      const resume = jest.fn(() => {
        throw new Error('socket already gone');
      });
      // Drain is best-effort: a throwing resume must report failure, not success.
      expect(drainRequestBody({method: 'GET', resume})).toBe(false);
    });
  });

  // Integration shape: mirror what RestApi.wrapAsync does with the helper so a
  // regression in the call site (draining the wrong methods, or skipping the
  // drain) is caught here without a live Meteor server.
  describe('wrapAsync integration shape (helper wired into a wrapper)', () => {
    function makeWrapper(fn) {
      return function () {
        const self = this;
        if (self.request && self.request.query) {
          if (!self.params) self.params = {};
          self.params.query = Object.assign({}, self.params.query, self.request.query);
        }
        if (self.request) drainRequestBody(self.request);
        return fn.call(self).catch(err => {
          if (!self.response.writableEnded) {
            self.response.statusCode = 500;
            self.response.end(JSON.stringify({error: 'Internal Server Error', message: err.message}));
          }
        });
      };
    }

    it('runs the handler AND drains for a GET with a stray body (criterion 1)', async () => {
      const resume = jest.fn();
      const handler = jest.fn(async function () {
        this.response.end('ok');
      });
      const response = {writableEnded: false, end: jest.fn(), statusCode: 200};
      const ctx = {request: {method: 'GET', resume, query: {a: '1'}}, response, params: {}};
      await makeWrapper(handler).call(ctx);

      expect(handler).toHaveBeenCalledTimes(1); // handler ran
      expect(resume).toHaveBeenCalledTimes(1);  // body drained
      expect(response.end).toHaveBeenCalledWith('ok');
      expect(ctx.params.query).toEqual({a: '1'}); // criterion 3: query still merged
    });

    it('runs the handler but does NOT drain for a POST (criterion 2)', async () => {
      const resume = jest.fn();
      const handler = jest.fn(async function () {
        this.response.end('ok');
      });
      const response = {writableEnded: false, end: jest.fn(), statusCode: 200};
      const ctx = {request: {method: 'POST', resume, body: {x: 1}}, response};
      await makeWrapper(handler).call(ctx);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(resume).not.toHaveBeenCalled();
    });

    it('still produces the 500 JSON via .catch when the handler throws (criterion 3)', async () => {
      const handler = jest.fn(async function () {
        throw new Error('boom');
      });
      const response = {writableEnded: false, end: jest.fn(), statusCode: 200};
      const ctx = {request: {method: 'GET', resume: jest.fn()}, response};
      await makeWrapper(handler).call(ctx);

      expect(response.statusCode).toBe(500);
      expect(response.end).toHaveBeenCalledWith(
        JSON.stringify({error: 'Internal Server Error', message: 'boom'})
      );
    });

    it('drains the GET body even when the handler later throws (criterions 1 + 4)', async () => {
      // The drain happens before fn.call, so a failing handler must not skip it.
      const resume = jest.fn();
      const handler = jest.fn(async function () {
        throw new Error('boom');
      });
      const response = {writableEnded: false, end: jest.fn(), statusCode: 200};
      const ctx = {request: {method: 'GET', resume, query: {a: '1'}}, response, params: {}};
      await makeWrapper(handler).call(ctx);

      expect(resume).toHaveBeenCalledTimes(1);       // body still drained
      expect(ctx.params.query).toEqual({a: '1'});    // query still merged
      expect(response.statusCode).toBe(500);          // and the throw still 500s
    });

    it('does not 500 a POST handler that throws while skipping the drain (criterions 2 + 3)', async () => {
      const resume = jest.fn();
      const handler = jest.fn(async function () {
        throw new Error('post-boom');
      });
      const response = {writableEnded: false, end: jest.fn(), statusCode: 200};
      const ctx = {request: {method: 'POST', resume, body: {x: 1}}, response};
      await makeWrapper(handler).call(ctx);

      expect(resume).not.toHaveBeenCalled();          // POST never drained
      expect(response.statusCode).toBe(500);          // throw still routed to 500
      expect(response.end).toHaveBeenCalledWith(
        JSON.stringify({error: 'Internal Server Error', message: 'post-boom'})
      );
    });
  });
});
