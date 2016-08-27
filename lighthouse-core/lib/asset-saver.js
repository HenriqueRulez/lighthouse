/**
 * @license
 * Copyright 2016 Google Inc. All rights reserved.
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
 */
'use strict';

const fs = require('fs');
const log = require('../../lighthouse-core/lib/log.js');
const stringify = require('json-stringify-safe');

function getFilenamePrefix(options) {
  const date = options.date || new Date();
  const url = options.url;

  const hostname = url.match(/^.*?\/\/(.*?)(:?\/|$)/)[1];
  const filenamePrefix = hostname + '_' + date.toISOString();
  return (filenamePrefix).replace(/[\/\?<>\\:\*\|":]/g, '-');
}

// Some trace events are particularly large, and not only consume a LOT of disk
// space, but also cause problems for the JSON stringifier. For simplicity, we exclude them
function filterForSize(traceEvents) {
  return traceEvents.filter(e => e.name !== 'LayoutTree');
}

// inject 'em in there'
function addMetrics(traceEvents, auditResults) {

  var res = {};
  auditResults.forEach(audit => {
    res[audit.name] = audit;
  });

  const resFMP = res['first-meaningful-paint'];
  const resFMPext = resFMP.extendedInfo;
  const resSI = res['speed-index-metric'];
  const resSIext = resSI.extendedInfo;
  const resTTI = res['time-to-interactive'];
  const resTTIext = resTTI.extendedInfo;
  const navStart = resFMPext.value.timings.navStart;

  const timings = [{
    name: 'First Contentful Paint',
    traceEvtName: 'MarkFCP',
    value: resFMPext && (navStart + resFMPext.value.timings.fCP),
  }, {
    name: 'First Meaningful Paint',
    traceEvtName: 'MarkFMP',
    value: navStart + resFMP.rawValue,
  }, {
    name: 'Perceptual Speed Index',
    traceEvtName: 'MarkVC50',
    value: navStart + resSI.rawValue,
  }, {
    name: 'First Visual Change',
    traceEvtName: 'MarkVC1',
    value: resSIext && (navStart + resSIext.value.first),
  }, {
    name: 'Visually Complete 100%',
    traceEvtName: 'MarkVC100',
    value: resSIext && (navStart + resSIext.value.complete),
  }, {
    name: 'Time to Interactive',
    traceEvtName: 'MarkTTI',
    value: navStart + resTTI.rawValue,
  }, {
    name: 'Visually Complete 85%',
    traceEvtName: 'MarkVC85',
    value: resTTIext && (navStart + resTTIext.value.timings.visuallyReady),
  }, {
    name: 'Navigation Start',
    traceEvtName: 'MarkNavStart',
    value: navStart
  }];

  // We'll masquerade our fake events as a combination of TracingStartedInPage & MarkDOMContent
  var tracingStartedInPageEvt = traceEvents.filter(e => e.name === 'TracingStartedInPage').shift();
  var dCLEvent = traceEvents.filter(e => e.name === 'MarkDOMContent').pop();

  timings.forEach(timing => {
    if (!timing.value) {
      return;
    }
    const fakeEvent = Object.assign({}, dCLEvent, {
      name: timing.traceEvtName,
      ts: timing.value * 1000,
      pid: tracingStartedInPageEvt.pid,
      tid: tracingStartedInPageEvt.tid
    });
    traceEvents.push(fakeEvent);
  });
  return traceEvents;
}

function screenshotDump(options, screenshots) {
  return `
  <!doctype html>
  <title>screenshots ${getFilenamePrefix(options)}</title>
  <style>
html {
    overflow-x: scroll;
    overflow-y: hidden;
    height: 100%;
    background: linear-gradient(to left, #4CA1AF , #C4E0E5);
    background-attachment: fixed;
    padding: 10px;
}
body {
    white-space: nowrap;
    background: linear-gradient(to left, #4CA1AF , #C4E0E5);
    width: 100%;
    margin: 0;
}
img {
    margin: 4px;
}
</style>
  <body>
    <script>
      var shots = ${JSON.stringify(screenshots)};

  shots.forEach(s => {
    var i = document.createElement('img');
    i.src = s.datauri;
    i.title = s.timestamp;
    document.body.appendChild(i);
  });
  </script>
  `;
}

// Set to ignore because testing it would imply testing fs, which isn't strictly necessary.
/* istanbul ignore next */
function saveArtifacts(artifacts, filename) {
  const artifactsFilename = filename || 'artifacts.log';
  fs.writeFileSync(artifactsFilename, stringify(artifacts));
  log.log('artifacts file saved to disk', artifactsFilename);
}

function prepareAssets(options, artifacts, auditResults) {
  const traceData = Object.keys(artifacts.traces).map(traceName => {
    const filteredTrace = Object.assign({}, artifacts.traces[traceName]);
    filteredTrace.traceEvents = filterForSize(filteredTrace.traceEvents);
    filteredTrace.traceEvents = addMetrics(filteredTrace.traceEvents, auditResults);
    return filteredTrace;
  });
  const html = screenshotDump(options, artifacts.ScreenshotFilmstrip);
  return {traceData, html};
}

function saveAssets(options, artifacts, auditResults) {
  const assets = prepareAssets(options, artifacts, auditResults);

  assets.traceData.forEach((data, index) => {
    const traceFilename = getFilenamePrefix(options);
    fs.writeFileSync(`${traceFilename}${index}.trace.json`, stringify(data, null, 2));
    log.log('trace file saved to disk', traceFilename);
  });

  const screenshotsFilename = getFilenamePrefix(options);
  fs.writeFileSync(screenshotsFilename + '.screenshots.html', assets.html);
  log.log('screenshots saved to disk', screenshotsFilename);
}

module.exports = {
  saveArtifacts,
  saveAssets,
  getFilenamePrefix,
  prepareAssets
};
