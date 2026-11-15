'use strict';

// Keep scanning the full provider feed off the remote-input thread. Pass a small
// XMLTV document to the page, where DOMParser handles the program fields.
self.onmessage = function (event) {
  var data = event.data;
  var channels = new RegExp(data.channelPattern, 'i');
  var selected = Object.create(null), parts = ['<tv>'];
  var xml = data.xml;
  if (!/<tv(?:\s|>)/.test(xml) || !/<\/tv>\s*$/.test(xml)) { self.postMessage(null); return; }

  var channelPattern = /<channel\b[^>]*\bid="([^"]+)"[^>]*>[\s\S]*?<\/channel>/g;
  var block;
  while ((block = channelPattern.exec(xml))) {
    var name = /<display-name\b[^>]*>([^<]+)<\/display-name>/.exec(block[0]);
    if (!name || !channels.test(name[1].replace(/&amp;/g, '&').trim())) continue;
    selected[block[1]] = true;
    parts.push(block[0]);
  }

  var programmes = /<programme\b([^>]*)>[\s\S]*?<\/programme>/g;
  while ((block = programmes.exec(xml))) {
    var id = /\bchannel="([^"]+)"/.exec(block[1]);
    if (id && selected[id[1]]) parts.push(block[0]);
  }
  parts.push('</tv>');
  self.postMessage(parts.join(''));
};
