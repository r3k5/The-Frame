// Maps supported TV Plus channel IDs to their HLS playlists.
(function (root) {
  'use strict';
  // Each entry stores the Akamai host prefix and playlist name.
  var channels = {
    USBA300024TN: ['pb-k5p02dtnr2162', 'LiveNOW_from_FOX'],
    US1600002OK: ['pb-774r1zuspmpzs', 'Lifetime_Love_and_Drama'],
    US18000163F: ['pb-w5d3w3kisxahy', 'playlist'],
    USBD700011RE: ['pb-7elpwjtl4omet', 'Gravitas_Movies'],
    USBC24000134A: ['pb-10d2295rjh7ki', 'playlist'],
    US3700005GP: ['pb-0ix3l1oxmg1fj', 'playlist'],
    USBA2000001BR: ['pb-mubj6htj155c6', 'Baywatch_SONO5'],
    US4500009VV: ['pb-nm5x5fh62donr', 'playlist']
  };
  function source(id) {
    if (!Object.prototype.hasOwnProperty.call(channels, id)) return null;
    var channel = channels[id];
    var query = new URLSearchParams({ 'ads.ads_cdn': 'ak', 'ads.cdn': 'ak', 'ads.content_cdn': 'ak', 'ads.device_dnt': '1', 'ads.service_id': id, 'ads.ssai_vendor': 'SSSLIVE', pb_type: channel[0] + '_akamai' });
    return 'https://' + channel[0] + '.akamaized.net/v1/master/3722c60a815c199d9c0ef36c5b73da68a62b09d1/' + channel[0] + '/' + channel[1] + '.m3u8?' + query;
  }
  if (typeof module === 'object') module.exports = source;
  else root.FrameLiveSource = source;
}(typeof window === 'object' ? window : null));
