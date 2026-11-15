// Loads and filters the TV Plus program schedule for the Home shelves.
(function (root) {
  'use strict';
  var url = 'https://i.mjh.nz/SamsungTVPlus/us.xml';
  var mirror = 'https://raw.githubusercontent.com/matthuisman/i.mjh.nz/master/SamsungTVPlus/us.xml';
  var movieChannels = /^(Movie Hub(?!.*West)|MovieSphere|Miramax Movie Channel|Paramount Movie Channel|Universal Movies|Lifetime Movies|Gravitas Movies|Classic Movie Westerns|NEW KMOVIES|Maverick Black Cinema)/i;
  var tvChannels = /^(ION(?: Plus| Mystery)?|BBC Drama Classics|Law & Order|Midsomer Murders|Baywatch|TV Land (?:Drama|Sitcoms)|Unsolved Mysteries|Forensic Files|Kitchen Nightmares|Top Gear|BBC Comedy|GET Comedy|K-Drama\+|Supernatural Drama|Samsung Television Network)$/i;
  var state = { loading: true }, programmes = [], pending;

  // Convert XMLTV timestamps and their explicit UTC offsets to epoch milliseconds.
  function timestamp(text) {
    var parts = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-])(\d{2})(\d{2})$/.exec(text || '');
    if (!parts) return NaN;
    var offset = Number(parts[8]) * 60 + Number(parts[9]);
    return Date.UTC(+parts[1], parts[2] - 1, +parts[3], +parts[4], +parts[5], +parts[6]) - (parts[7] === '+' ? offset : -offset) * 60000;
  }

  function value(node, selector) {
    var child = node.querySelector(selector);
    return child ? child.textContent.trim() : '';
  }

  // Keep only supported channel groups and accept artwork from the configured provider host.
  function parse(xml) {
    var guide = new DOMParser().parseFromString(xml, 'application/xml');
    if (guide.documentElement.localName !== 'tv') throw new Error('Invalid program guide');
    var channels = Object.create(null), rows = [];
    Array.prototype.forEach.call(guide.querySelectorAll('channel'), function (channel) {
      var name = value(channel, 'display-name');
      if (movieChannels.test(name) || tvChannels.test(name)) channels[channel.id || channel.getAttribute('id')] = name;
    });
    Array.prototype.forEach.call(guide.querySelectorAll('programme'), function (programme) {
      var channelId = programme.getAttribute('channel'), channel = channels[channelId];
      if (!channel) return;
      var start = timestamp(programme.getAttribute('start')), end = timestamp(programme.getAttribute('stop'));
      if (!(end > start)) return;
      var title = value(programme, 'title');
      if (!title || /^(programming unavailable|to be announced|paid programming)$/i.test(title)) return;
      var icon = programme.querySelector('icon'), image = icon ? icon.getAttribute('src') : '';
      rows.push({ id: channelId + ':' + start, channelId: channelId, channel: channel, title: title, episode: value(programme, 'sub-title'), description: value(programme, 'desc'), image: /^https:\/\/tvpnlogopus\.samsungcloud\.tv\//.test(image) ? image : '', start: start, end: end, movie: movieChannels.test(channel) });
    });
    return rows;
  }

  // Return current listings with one entry per title.
  function onNow(movie, now) {
    var seen = Object.create(null);
    return programmes.filter(function (entry) {
      if (entry.movie !== movie || entry.start > now || entry.end <= now || seen[entry.title]) return false;
      seen[entry.title] = true;
      return true;
    });
  }

  function request(source) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 9000);
    return fetch(source, { signal: controller.signal, credentials: 'omit' }).then(function (response) {
      if (!response.ok) throw new Error('Guide request failed');
      return response.text();
    }).then(compact).then(parse).finally(function () { clearTimeout(timer); });
  }

  // Use the worker for large feeds and fall back to the original XML if it cannot finish.
  function compact(xml) {
    if (xml.length < 80000 || !root.Worker) return xml;
    return new Promise(function (resolve) {
      var worker;
      try { worker = new Worker('js/guide-worker.js'); } catch (e) { resolve(xml); return; }
      var timeout = setTimeout(function () { finish(xml); }, 3000);
      function finish(result) { clearTimeout(timeout); worker.terminate(); resolve(result); }
      worker.onmessage = function (event) { finish(event.data || xml); };
      worker.onerror = function () { finish(xml); };
      worker.postMessage({ xml: xml, channelPattern: movieChannels.source + '|' + tvChannels.source });
    });
  }

  // Try the primary feed before the mirror and notify Home when loading ends.
  function refresh() {
    if (pending || document.hidden) return pending;
    pending = request(url).catch(function () { return request(mirror); }).then(function (rows) {
      programmes = rows;
    }).catch(function () {
      // Keep the last schedule if both feeds are unavailable.
    }).finally(function () {
      pending = null;
      state.loading = false;
      root.dispatchEvent(new Event('frameliveguidechange'));
    });
    return pending;
  }

  root.FrameLiveGuide = { state: state, onNow: onNow, refresh: refresh };
}(window));
