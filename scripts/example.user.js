// ==UserScript==
// @name        TMDev Example Script
// @namespace   https://tmdev.local
// @version     1.0.0
// @description A sample userscript to test TMDev functionality
// @match       https://example.com/*
// @match       https://news.ycombinator.com/*
// @grant       GM_addStyle
// @grant       GM_getValue
// @grant       GM_setValue
// @grant       GM_log
// @run-at      document-end
// ==/UserScript==

(function() {
  'use strict';

  GM_log('TMDev Example Script loaded on: ' + window.location.href);

  // Add a subtle indicator that the script is running
  GM_addStyle(`
    body::after {
      content: 'TMDev Active';
      position: fixed;
      bottom: 10px;
      right: 10px;
      background: #00d4aa;
      color: #1a1a2e;
      padding: 4px 12px;
      border-radius: 4px;
      font-size: 12px;
      font-family: monospace;
      z-index: 999999;
      opacity: 0.8;
      pointer-events: none;
    }
  `);

  // Demo GM_getValue / GM_setValue
  const visitCount = GM_getValue('visitCount', 0);
  GM_setValue('visitCount', visitCount + 1);
  GM_log('Visit count: ' + (visitCount + 1));
})();
