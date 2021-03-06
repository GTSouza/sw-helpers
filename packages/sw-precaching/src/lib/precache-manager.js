/*
 Copyright 2016 Google Inc. All Rights Reserved.
 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

     http://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
*/

import assert from '../../../../lib/assert';
import RevisionedCacheManager from './controllers/revisioned-cache-manager.js';
import UnrevisionedCacheManager from
  './controllers/unrevisioned-cache-manager.js';

/**
 * The PrecacheManager is the top level API you are likely to use with
 * the sw-precaching module.
 *
 * This class will set up the install listener and orchestrate the caching
 * of assets.
 *
 * @memberof module:sw-precaching
 */
class PrecacheManager {
  /**
   * Creating a PrecacheManager will add an install and activate event listener
   * to your service worker. This allows the manager to cache assets and
   * tidy up the no longer required assets.
   */
  constructor() {
    this._eventsRegistered = false;

    this._revisionedManager = new RevisionedCacheManager();
    this._unrevisionedManager = new UnrevisionedCacheManager();
    this._registerEvents();
  }

  /**
   * @private
   */
  _registerEvents() {
    if (this._eventsRegistered) {
      // Only need to register events once.
      return;
    }

    this._eventsRegistered = true;

    self.addEventListener('install', (event) => {
      const promiseChain = Promise.all([
        this._revisionedManager._performInstallStep(),
        this._unrevisionedManager._performInstallStep(),
      ])
      .then(() => {
        // Closed indexedDB now that we are done with the install step
        this._close();
      })
      .catch((err) => {
        this._close();

        throw err;
      });

      event.waitUntil(promiseChain);
    });

    self.addEventListener('activate', (event) => {
      const promiseChain = Promise.all([
        this._revisionedManager._cleanUpOldEntries(),
        this._unrevisionedManager._cleanUpOldEntries(),
      ])
      .then(() => {
        // Closed indexedDB now that we are done with the install step
        this._close();
      })
      .catch((err) => {
        this._close();

        throw err;
      });

      event.waitUntil(promiseChain);
    });
  }

  /**
   * To cache revisioned assets (i.e. urls / assets that you have a revision
   * for) can be efficiently cached and updated with this method.
   * @param {Object} input
   * @param {Array<String|Object>} input.revisionedFiles An array of URL strings
   * , which should have revisioning in the file name (i.e. hello.1234.css)) or
   * an object with a `url` and `revision` parameter.
   *
   * @example
   * precacheManager.cacheRevisioned({
   *   revisionedFiles: [
   *     // Revision is in the file name
   *     '/styles/main.1234.css',
   *
   *     // Object of url and revision can be used as well
   *     {
   *       url: '/',
   *       revision: '1234'
   *     },
   *   ]
   * });
   */
  cacheRevisioned({revisionedFiles} = {}) {
    assert.isInstance({revisionedFiles}, Array);
    this._revisionedManager.cache(revisionedFiles);
  }

  /**
   * To cache URLs or assets where you don't know the revisioning, should
   * be cached with this method. This method will always cache these files
   * on install, regardless of whether they are already cached or not.
   * This ensures they are up-to-date after a new service worker install.
   * @param {Object} input
   * @param {Array<String|Request>} input.unrevisionedFiles An array of URL
   * strings or a Request object, which allows you to define custom headers.
   *
   * @example
   * precacheManager.cacheUnrevisioned({
   *   unrevisionedFiles: [
   *     // Normal URL string
   *     '/example/',
   *
   *     // Request with headers
   *     new Request(
   *       '/user-info.json',
   *       {
   *         headers: {
   *           'CustomHeader': 'Hello World.'
   *         }
   *       }
   *     ),
   *   ]
   * });
   */
  cacheUnrevisioned({unrevisionedFiles} = {}) {
    assert.isInstance({unrevisionedFiles}, Array);
    this._unrevisionedManager.cache(unrevisionedFiles);
  }

  /**
   * Returns the revisioned cache manager.
   * @return {RevisionedCacheManager} The revisioned cache manager.
   *
   * @example
   * const revisionedMngr = precacheMAnager.getRevisionedCacheManager();
   */
  getRevisionedCacheManager() {
    return this._revisionedManager;
  }

  /**
   * Returns the unrevisioned cache manager.
   * @return {UnrevisionedCacheManager} The unrevisioned cache manager.
   *
   * @example
   * const unrevisionedMngr = precacheManager.getUnrevisionedCacheManager();
   */
  getUnrevisionedCacheManager() {
    return this._unrevisionedManager;
  }

  /**
   * @private
   */
  _close() {
    this._revisionedManager._close();
  }
}

export default PrecacheManager;
