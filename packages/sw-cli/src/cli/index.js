/**
 * Copyright 2016 Google Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
**/

'use strict';

const fs = require('fs');
const path = require('path');
const inquirer = require('inquirer');
const minimist = require('minimist');
const glob = require('glob');
const crypto = require('crypto');
const mkdirp = require('mkdirp');
const template = require('lodash.template');
const updateNotifier = require('update-notifier');

const errors = require('../lib/errors');
const logHelper = require('../lib/log-helper');
const pkg = require('../../package.json');
const constants = require('../lib/constants.js');

const DEBUG = false;

/**
 * This class is a wrapper to make test easier. This is used by
 * ./bin/index.js to pass in the args when the CLI is used.
 */
class SWCli {
  /**
   * This is a helper method that allows the test framework to call argv with
   * arguments without worrying about running as an actual CLI.
   *
   * @private
   * @param {Object} argv The value passed in via process.argv.
   * @return {Promise} Promise is returned so testing framework knows when
   * handling the request has finished.
   */
  argv(argv) {
    updateNotifier({pkg}).notify();

    const cliArgs = minimist(argv);
    if (cliArgs._.length > 0) {
      // We have a command
      return this.handleCommand(cliArgs._[0], cliArgs._.splice(1), cliArgs)
      .then(() => {
        process.exit(0);
      })
      .catch(() => {
        process.exit(1);
      });
    } else {
      // we have a flag only request
      return this.handleFlag(cliArgs)
      .then(() => {
        process.exit(0);
      })
      .catch(() => {
        process.exit(1);
      });
    }
  }

  /**
   * Prints the help text to the terminal.
   */
  printHelpText() {
    const helpText = fs.readFileSync(
      path.join(__dirname, 'cli-help.txt'), 'utf8');
    logHelper.info(helpText);
  }

  /**
   * If there is no command given to the CLI then the flags will be passed
   * to this function in case a relevant action can be taken.
   * @param {object} flags The available flags from the command line.
   * @return {Promise} returns a promise once handled.
   */
  handleFlag(flags) {
    let handled = false;
    if (flags.h || flags.help) {
      this.printHelpText();
      handled = true;
    }

    if (flags.v || flags.version) {
      logHelper.info(pkg.version);
      handled = true;
    }

    if (handled) {
      return Promise.resolve();
    }

    // This is a fallback
    this.printHelpText();
    return Promise.reject();
  }

  /**
   * If a command is given in the command line args, this method will handle
   * the appropriate action.
   * @param {string} command The command name.
   * @param {object} args The arguments given to this command.
   * @param {object} flags The flags supplied with the command line.
   * @return {Promise} A promise for the provided task.
   */
  handleCommand(command, args, flags) {
    switch (command) {
      case 'generate-sw':
        return this.generateSW();
      case 'build-file-manifest':
        return this.buildFileManifest();
      default:
        logHelper.error(`Invlaid command given '${command}'`);
        return Promise.reject();
    }
  }

  /**
   * This method will generate a working Service Worker with a file manifest.
   * @return {Promise} The promise returned here will be used to exit the
   * node process cleanly or not.
   */
  generateSW() {
    let rootDirectory;
    let fileExtentionsToCache;
    let fileManifestName;
    let serviceWorkerName;
    let saveConfig;

    return this._getRootOfWebApp()
    .then((rDirectory) => {
      rootDirectory = rDirectory;
      return this._getFileExtensionsToCache(rootDirectory);
    })
    .then((extensionsToCache) => {
      fileExtentionsToCache = extensionsToCache;
      return this._getFileManifestName();
    })
    .then((manifestName) => {
      fileManifestName = manifestName;
      return this._getServiceWorkerName();
    })
    .then((swName) => {
      serviceWorkerName = swName;
      return this._saveConfigFile();
    })
    .then((sConfig) => {
      saveConfig = sConfig;

      logHelper.warn('Root Directory: ' + rootDirectory);
      logHelper.warn('File Extensions to Cache: ' + fileExtentionsToCache);
      logHelper.warn('File Manifest: ' + fileManifestName);
      logHelper.warn('Service Worker: ' + serviceWorkerName);
      logHelper.warn('Save to Config File: ' + saveConfig);
      logHelper.warn('');

      const relativePath = path.relative(process.cwd(), rootDirectory);

      const globs = [
        this._generateGlobPatten(relativePath, fileExtentionsToCache),
      ];

      const excludeFiles = [
        fileManifestName,
        serviceWorkerName,
        relativePath,
      ];
      let swlibPath;
      return this._copySWLibFile(rootDirectory)
      .then((libPath) => {
        swlibPath = libPath;
        excludeFiles.push(path.basename(swlibPath));
      })
      .then(() => {
        const manifestEntries = this._getFileManifestEntries(
          globs, rootDirectory, excludeFiles);

        return this._buildServiceWorker(
          path.join(rootDirectory, serviceWorkerName),
          manifestEntries,
          swlibPath,
          rootDirectory
        );

        // If SW inlines the manifest entires, the file manifest is not needed
        // return this._writeFilemanifest(
        //  path.join(rootDirectory, fileManifestName), manifestEntries);
      });
    });
  }

  _generateGlobPatten(relativePath, fileExtentionsToCache) {
    // Glob patterns only work with forward slash
    // https://github.com/isaacs/node-glob#windows
    const globPath = path.join(relativePath, '**', '*').replace(path.sep, '/');
    if (fileExtentionsToCache.length > 1) {
      // Return pattern '**/*.{txt,md}'
      return globPath + `.{${fileExtentionsToCache.join(',')}}`;
    } else {
      // Return pattern '**/*.txt'
      return globPath + `.${fileExtentionsToCache[0]}`;
    }
  }

  /**
   * This method requests the root directory of the web app.
   * The user can opt to type in the directory OR select from a list of
   * directories in the current path.
   * @return {Promise<string>} Promise the resolves with the name of the root
   * directory if given.
   */
  _getRootOfWebApp() {
    const manualEntryChoice = 'Manually Enter Path';
    const currentDirectory = process.cwd();

    return new Promise((resolve, reject) => {
      fs.readdir(currentDirectory, (err, directoryContents) => {
        if (err) {
          return reject(err);
        }

        resolve(directoryContents);
      });
    })
    .then((directoryContents) => {
      return directoryContents.filter((directoryContent) => {
        return fs.statSync(directoryContent).isDirectory();
      });
    })
    .then((subdirectories) => {
      return subdirectories.filter((subdirectory) => {
        return !constants.blacklistDirectoryNames.includes(subdirectory);
      });
    })
    .then((subdirectories) => {
      const choices = subdirectories.concat([
        new inquirer.Separator(),
        manualEntryChoice,
      ]);
      return inquirer.prompt([
        {
          name: 'rootDir',
          message: 'What is the root of your web app?',
          type: 'list',
          choices: choices,
        },
        {
          name: 'rootDir',
          message: 'Please manually enter the root of your web app?',
          when: (answers) => {
            return answers.rootDir === manualEntryChoice;
          },
        },
      ]);
    })
    .then((answers) => {
      return path.join(currentDirectory, answers.rootDir);
    })
    .catch((err) => {
      logHelper.error(
        errors['unable-to-get-rootdir'],
        err
      );
      throw err;
    });
  }

  _getFileExtensionsToCache(rootDirectory) {
    return this._getFileContents(rootDirectory)
    .then((files) => {
      return this._getFileExtensions(files);
    })
    .then((fileExtensions) => {
      if (fileExtensions.length === 0) {
        throw new Error(errors['no-file-extensions-found']);
      }

      return inquirer.prompt([
        {
          name: 'cacheExtensions',
          message: 'Which file types would you like to cache?',
          type: 'checkbox',
          choices: fileExtensions,
          default: fileExtensions,
        },
      ]);
    })
    .then((results) => {
      if (results.cacheExtensions.length === 0) {
        throw new Error(errors['no-file-extensions-selected']);
      }

      return results.cacheExtensions;
    })
    .catch((err) => {
      logHelper.error(
        errors['unable-to-get-file-extensions'],
        err
      );
      throw err;
    });
  }

  _getFileContents(directory) {
    return new Promise((resolve, reject) => {
      fs.readdir(directory, (err, directoryContents) => {
        if (err) {
          return reject(err);
        }

        resolve(directoryContents);
      });
    })
    .then((directoryContents) => {
      const promises = directoryContents.map((directoryContent) => {
        const fullPath = path.join(directory, directoryContent);
        if (fs.statSync(fullPath).isDirectory()) {
          if (!constants.blacklistDirectoryNames.includes(directoryContent)) {
            return this._getFileContents(fullPath);
          } else {
            return [];
          }
        } else {
          return fullPath;
        }
      });

      return Promise.all(promises);
    })
    .then((fileResults) => {
      return fileResults.reduce((collapsedFiles, fileResult) => {
        return collapsedFiles.concat(fileResult);
      }, []);
    });
  }

  _getFileExtensions(files) {
    const fileExtensions = new Set();
    files.forEach((file) => {
      const extension = path.extname(file);
      if (extension && extension.length > 0) {
        fileExtensions.add(extension);
      } else if (DEBUG) {
        logHelper.warn(
          errors['no-extension'],
          file
        );
      }
    });

    // Strip the '.' character if it's the first character.
    return [...fileExtensions].map(
      (fileExtension) => fileExtension.replace(/^\./, ''));
  }

  _getFileManifestName() {
    return inquirer.prompt([
      {
        name: 'fileManifestName',
        message: 'What should we name the file manifest?',
        type: 'input',
        default: 'precache-manifest.js',
      },
    ])
    .then((results) => {
      const manifestName = results.fileManifestName.trim();
      if (manifestName.length === 0) {
        logHelper.error(
          errors['invalid-file-manifest-name']
        );
        throw new Error(errors['invalid-file-manifest-name']);
      }

      return manifestName;
    })
    .catch((err) => {
      logHelper.error(
        errors['unable-to-get-file-manifest-name'],
        err
      );
      throw err;
    });
  }

  _getServiceWorkerName() {
    return inquirer.prompt([
      {
        name: 'serviceWorkerName',
        message: 'What should we name your service worker file?',
        type: 'input',
        default: 'sw.js',
      },
    ])
    .then((results) => {
      const serviceWorkerName = results.serviceWorkerName.trim();
      if (serviceWorkerName.length === 0) {
        logHelper.error(
          errors['invalid-sw-name']
        );
        throw new Error(errors['invalid-sw-name']);
      }

      return serviceWorkerName;
    })
    .catch((err) => {
      logHelper.error(
        errors['unable-to-get-sw-name'],
        err
      );
      throw err;
    });
  }

  _saveConfigFile() {
    return inquirer.prompt([
      {
        name: 'saveConfig',
        message: 'Last Question - Would you like to save these settings to ' +
          'a config file?',
        type: 'confirm',
        default: true,
      },
    ])
    .then((results) => results.saveConfig)
    .catch((err) => {
      logHelper.error(
        errors['unable-to-get-save-config'],
        err
      );
      throw err;
    });
  }

  _getFileManifestEntries(globs, rootDirectory, excludeFiles) {
    const globbedFiles = globs.reduce((accumulated, globPattern) => {
      const fileDetails = this._getFileManifestDetails(
        rootDirectory, globPattern);
      return accumulated.concat(fileDetails);
    }, []);

    return this._filterFiles(globbedFiles, excludeFiles);
  }

  _writeFilemanifest(manifestFilePath, manifestEntries) {
    try {
      mkdirp.sync(path.dirname(manifestFilePath));
    } catch (err) {
      logHelper.error(errors['unable-to-make-manifest-directory'], err);
      return Promise.reject(err);
    }

    const templatePath = path.join(
      __dirname, '..', 'lib', 'templates', 'file-manifest.js.tmpl');
    return new Promise((resolve, reject) => {
      fs.readFile(templatePath, 'utf8', (err, data) => {
        if (err) {
          logHelper.error(errors['read-manifest-template-failure'], err);
          return reject(err);
        }
        resolve(data);
      });
    })
    .then((templateString) => {
      try {
        return template(templateString)({
          manifestEntries: manifestEntries,
        });
      } catch (err) {
        logHelper.error(errors['populating-manifest-tmpl-failed'], err);
        throw err;
      }
    })
    .then((populatedTemplate) => {
      return new Promise((resolve, reject) => {
        fs.writeFile(manifestFilePath, populatedTemplate, (err) => {
          if (err) {
            logHelper.error(errors['manifest-file-write-failure'], err);
            return reject(err);
          }

          resolve();
        });
      });
    });
  }

  _filterFiles(files, excludeFiles) {
    files = files.filter((fileDetails) => {
      // Filter oversize files.
      if (fileDetails.size > constants.maximumFileSize) {
        logHelper.warn(`Skipping file '${fileDetails.file}' due to size. ` +
          `[Max size supported is ${constants.maximumFileSize}]`);
        return false;
      }

      // Filter out excluded files (i.e. manifest and service worker)
      if (excludeFiles.indexOf(fileDetails.file) !== -1) {
        return false;
      }

      return true;
    });

    // TODO: Strip prefix

    // Convert to manifest format
    return files.map((fileDetails) => {
      return {
        url: '/' + fileDetails.file.replace(path.sep, '/'),
        revision: fileDetails.hash,
      };
    });
  }

  _getFileManifestDetails(rootDirectory, globPattern) {
    let globbedFiles;
    try {
      globbedFiles = glob.sync(globPattern);
    } catch (err) {
      logHelper.error(errors['unable-to-glob-files'], err);
      throw err;
    }

    const fileDetails = globbedFiles.map((file) => {
      const fileSize = this._getFileSize(file);
      if (fileSize === null) {
        return null;
      }

      const fileHash = this._getFileHash(file);
      return {
        file: `${path.relative(rootDirectory, file)}`,
        hash: fileHash,
        size: fileSize,
      };
    });

    // If !== null, means it's a valid file.
    return fileDetails.filter((details) => details !== null);
  }

  _getFileSize(file) {
    try {
      const stat = fs.statSync(file);
      if (!stat.isFile()) {
        return null;
      }
      return stat.size;
    } catch (err) {
      logHelper.error(errors['unable-to-get-file-size'], err);
      throw err;
    }
  }

  _getFileHash(file) {
    try {
      const buffer = fs.readFileSync(file);
      const md5 = crypto.createHash('md5');
      md5.update(buffer);
      return md5.digest('hex');
    } catch (err) {
      logHelper.error(errors['unable-to-get-file-hash'], err);
      throw err;
    }
  }

  _buildServiceWorker(swPath, manifestEntries, swlibPath, rootDirectory) {
    try {
      mkdirp.sync(path.dirname(swPath));
    } catch (err) {
      logHelper.error(errors['unable-to-make-sw-directory'], err);
      return Promise.reject(err);
    }

    const templatePath = path.join(
      __dirname, '..', 'lib', 'templates', 'sw.js.tmpl');
    return new Promise((resolve, reject) => {
      fs.readFile(templatePath, 'utf8', (err, data) => {
        if (err) {
          logHelper.error(errors['read-sw-template-failure'], err);
          return reject(err);
        }
        resolve(data);
      });
    })
    .then((templateString) => {
      const relSwlibPath = path.relative(rootDirectory, swlibPath);

      try {
        return template(templateString)({
          manifestEntries: manifestEntries,
          swlibPath: relSwlibPath,
        });
      } catch (err) {
        logHelper.error(errors['populating-sw-tmpl-failed'], err);
        throw err;
      }
    })
    .then((populatedTemplate) => {
      return new Promise((resolve, reject) => {
        fs.writeFile(swPath, populatedTemplate, (err) => {
          if (err) {
            logHelper.error(errors['sw-write-failure'], err);
            return reject(err);
          }

          resolve();
        });
      });
    });
  }

  _copySWLibFile(rootDirectory) {
    const swlibModulePath = path.join(__dirname, '..', '..', 'node_modules',
      'sw-lib');
    const swlibPkg = require(path.join(swlibModulePath, 'package.json'));

    const swlibOutputPath = path.join(rootDirectory,
      `sw-lib.v${swlibPkg.version}.min.js`);
    return new Promise((resolve, reject) => {
      const swlibBuiltPath = path.join(swlibModulePath, 'build',
        'sw-lib.min.js');

      const stream = fs.createReadStream(swlibBuiltPath)
        .pipe(fs.createWriteStream(swlibOutputPath));
      stream.on('error', function(err) {
        logHelper.error(errors['unable-to-copy-sw-lib'], err);
        reject(err);
      });
      stream.on('finish', function() {
        resolve(swlibOutputPath);
      });
    });
  }
}

module.exports = SWCli;
