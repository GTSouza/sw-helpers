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

import Handler from './handler';
import assert from '../../../../lib/assert';

/**
 * @memberof module:sw-runtime-caching
 * @extends Handler
 *
 * @example
 * // Set up a route to match any requests made for URLs that end in .txt.
 * // The requests are handled with a cache-first strategy.
 * const route = new goog.routing.RegExpRoute({
 *   regExp: /\.txt$/,
 *   handler: new goog.runtimeCaching.CacheFirst(),
 * });
 *
 * const router = new goog.routing.Router();
 * router.registerRoute({route});
 */
class CacheFirst extends Handler {
  /**
   * An implementation of a [cache-first](https://developers.google.com/web/fundamentals/instant-and-offline/offline-cookbook/#cache-falling-back-to-network)
   * request strategy.
   *
   * @alias CacheFirst.handle
   * @param {Object} input
   * @param {FetchEvent} input.event The event that triggered the service
   *        worker's fetch handler.
   * @return {Promise.<Response>} The response, either from the cache,
   *          or if that isn't available, from the network.
   */
  async handle({event} = {}) {
    assert.isInstance({event}, FetchEvent);

    const cachedResponse = await this.requestWrapper.match({
      request: event.request,
    });

    return cachedResponse || await this.requestWrapper.fetchAndCache({
      request: event.request,
    });
  }
}

export default CacheFirst;
