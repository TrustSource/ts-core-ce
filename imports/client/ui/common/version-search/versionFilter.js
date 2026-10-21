import {Session} from 'meteor/session';

// The page slice the four paginated detail pages used to each implement
// themselves, verbatim.

const DEFAULT_PAGE_SIZE = 10;

/**
 * `pageListNumber` is clamped here rather than left to paginationList's
 * `currentPage` helper to correct a render later: filtering 400 versions down
 * to 3 while sitting on page 12 would otherwise show an empty table for a tick
 * before the pager caught up.
 */
export function pageSlice(versions) {
  if (!(versions instanceof Array)) {
    return versions;
  }
  Session.set('listStatus');
  const size = +Session.get('pageListSize') || DEFAULT_PAGE_SIZE;
  const pages = Math.ceil(versions.length / size) || 1;
  const page = Math.min(Math.max(+Session.get('pageListNumber') || 1, 1), pages);
  const current = versions.slice(size * (page - 1), size * page);
  Session.set('listStatus', current.length);
  return current;
}
