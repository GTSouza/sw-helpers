import ErrorFactory from '../error-factory';
import BaseCacheManager from './base-cache-manager';
import RevisionDetailsModel from '../models/revision-details-model';
import {defaultRevisionedCacheName} from '../constants';
import StringPrecacheEntry from
  '../models/precache-entries/string-precache-entry';
import ObjectPrecacheEntry from
  '../models/precache-entries/object-precache-entry';

/**
 * This class extends a lot of the internal methods from BaseCacheManager
 * to manage caching of revisioned assets.
 *
 * @private
 * @memberof module:sw-precaching
 * @extends {module:sw-precaching.BaseCacheManager}
 */
class RevisionedCacheManager extends BaseCacheManager {
  /**
   * Constructor for RevisionedCacheManager
   */
  constructor() {
    super(defaultRevisionedCacheName);

    this._revisionDetailsModel = new RevisionDetailsModel();
  }

  /**
   * This method will add the entries to the install list.
   * This will manage duplicate entries and perform the caching during
   * the install step.
   *
   * @example
   *
   * revisionedManager.cache([
   *   '/styles/hello.1234.css',
   *   {
   *     url: '/images/logo.png',
   *     revision: '1234'
   *   }
   * ]);
   *
   * @param {Array<String|Object>} rawEntries A raw entry that can be
   * parsed into a BaseCacheEntry.
   */
  cache(rawEntries) {
    // This method is here to provide useful docs.
    super.cache(rawEntries);
  }

  /**
   * This method ensures that the file entry in the maniest is valid and
   * can be parsed as a BaseCacheEntry.
   *
   * @private
   * @abstract
   * @param {String | Object} input Either a URL string
   * or an object with a `url`, `revision` and optional `cacheBust` parameter.
   * @return {BaseCacheEntry} Returns a parsed version of the file entry.
   */
  _parseEntry(input) {
    if (typeof input === 'undefined' || input === null) {
      throw ErrorFactory.createError('invalid-revisioned-entry',
        new Error('Invalid file entry: ' + JSON.stringify(input))
      );
    }

    let precacheEntry;
    switch(typeof input) {
      case 'string':
        precacheEntry = new StringPrecacheEntry(input);
        break;
      case 'object':
        precacheEntry = new ObjectPrecacheEntry(input);
        break;
      default:
        throw ErrorFactory.createError('invalid-revisioned-entry',
          new Error('Invalid file entry: ' +
            JSON.stringify(precacheEntry))
          );
    }

    return precacheEntry;
  }

  /**
   * If a dupe entry exists, check the revision. If the revisions are the same
   * it's simply a duplicate entry. If they are different, we have two
   * identical requests with two different revisions which will put this
   * module into a bad state.
   *
   * @private
   * @param {BaseCacheEntry} newEntry The entry that is to be cached.
   * @param {BaseCacheEntry} previousEntry The entry that is currently cached.
   */
  _onDuplicateInstallEntryFound(newEntry, previousEntry) {
    if (previousEntry.revision !== newEntry.revision) {
      throw ErrorFactory.createError(
        'duplicate-entry-diff-revisions',
        new Error(`${JSON.stringify(previousEntry)} <=> ` +
          `${JSON.stringify(newEntry)}`));
    }
  }

  /**
   * This method confirms with a precacheEntry is already in the cache with the
   * appropriate revision.
   * If the revision is known, the requested `precacheEntry.revision` is saved
   * and the cache entry exists for the `precacheEntry.path` this method
   * will return true.
   *
   * @private
   * @param {BaseCacheEntry} precacheEntry A entry with `path` and `revision`
   * parameters.
   * @return {Promise<Boolean>} Returns true if the precacheEntry is already
   * cached, false otherwise.
   */
  async _isAlreadyCached(precacheEntry) {
    const revisionDetails = await
      this._revisionDetailsModel.get(precacheEntry.entryID);
    if (revisionDetails !== precacheEntry.revision) {
      return false;
    }

    const openCache = await this._getCache();
    const cachedResponse = await openCache.match(precacheEntry.request);
    return cachedResponse ? true : false;
  }

  /**
   * @private
   * @param {BaseCacheEntry} precacheEntry A file entry with `path` and
   * `revision` parameters.
   */
  async _onEntryCached(precacheEntry) {
    await this._revisionDetailsModel.put(
      precacheEntry.entryID, precacheEntry.revision);
  }

  /**
   * This method closes the indexdDB helper. This is used for unit testing
   * to ensure cleanup between tests.
   * @private
   */
  _close() {
    this._revisionDetailsModel._close();
  }
}

export default RevisionedCacheManager;
