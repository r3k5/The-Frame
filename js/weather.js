// Resolves the saved location and refreshes local weather.
(function (root) {
  'use strict';
  var key = 'r3k5.frame.weather.v1.' + (root.FramePlatform.native ? 'tv' : 'preview');
  var fallback = { label: 'Boulder, CO', zip: '80302', latitude: 40.02, longitude: -105.29 };
  var state = { location: fallback, data: null, error: '' };
  var refreshInterval = 15 * 60 * 1000, retryInterval = 60 * 1000, maxWeatherAge = 3 * 60 * 60 * 1000;
  var forecast, retryTimer;

  function validLocation(location) {
    return location && typeof location.label === 'string' && location.label.length <= 80 &&
      Number.isFinite(location.latitude) && Math.abs(location.latitude) <= 90 &&
      Number.isFinite(location.longitude) && Math.abs(location.longitude) <= 180;
  }
  function saveLocation() { try { localStorage.setItem(key, JSON.stringify({ location: state.location })); } catch (e) {} }
  try {
    var saved = JSON.parse(localStorage.getItem(key));
    if (saved && typeof saved === 'object') {
      if (validLocation(saved.location)) state.location = saved.location;
      // Remove readings stored by earlier versions while keeping the selected location.
      if ('data' in saved) saveLocation();
    }
  } catch (e) {}
  function emit() { root.dispatchEvent(new CustomEvent('frameweatherchange')); }
  function request(url, controller) {
    var timer = setTimeout(function () { controller.abort(); }, 10000);
    return fetch(url, { signal: controller.signal, cache: 'no-store' }).then(function (response) {
      if (!response.ok) throw new Error('Weather service returned ' + response.status);
      return response.json();
    }).finally(function () { clearTimeout(timer); });
  }

  function readForecast(result) {
    var current = result && result.current;
    if (!current || !Number.isFinite(current.temperature_2m) || !Number.isFinite(current.time)) {
      throw new Error('Weather data is incomplete.');
    }
    var time = current.time * 1000;
    if (Date.now() - time > maxWeatherAge) throw new Error('The weather service returned an old reading.');
    var daily = result.daily || {};
    return {
      temperature: current.temperature_2m,
      code: current.weather_code,
      windSpeed: current.wind_speed_10m,
      windGust: current.wind_gusts_10m,
      time: time,
      high: daily.temperature_2m_max && daily.temperature_2m_max[0],
      low: daily.temperature_2m_min && daily.temperature_2m_min[0],
    };
  }

  // Share an active refresh. Only the active request may update the weather display.
  function refresh() {
    if (forecast) return forecast.promise;
    clearTimeout(retryTimer);
    var url = 'https://api.open-meteo.com/v1/forecast?' + new URLSearchParams({
      latitude: state.location.latitude, longitude: state.location.longitude,
      current: 'temperature_2m,weather_code,wind_speed_10m,wind_gusts_10m',
      daily: 'temperature_2m_max,temperature_2m_min',
      temperature_unit: 'fahrenheit', wind_speed_unit: 'mph', timezone: 'auto', timeformat: 'unixtime', forecast_days: '1'
    }).toString();
    var active = { controller: new AbortController() };
    active.promise = request(url, active.controller).then(function (result) {
      if (forecast === active) state.data = readForecast(result);
    }).catch(function (error) {
      if (forecast !== active) return;
      state.error = error.name === 'AbortError' ? 'Weather request timed out.' : error.message;
      retryTimer = setTimeout(refreshWhenVisible, retryInterval);
    }).finally(function () {
      if (forecast !== active) return;
      forecast = null;
      emit();
    });
    forecast = active;
    state.data = null;
    state.error = '';
    emit();
    return active.promise;
  }
  function refreshWhenVisible() { if (!document.hidden) return refresh(); }

  function setLocation(location) {
    if (!validLocation(location)) throw new Error('Invalid location.');
    if (forecast) forecast.controller.abort();
    forecast = null;
    state.location = location;
    saveLocation();
    return refresh();
  }
  // Resolve a US ZIP code through the configured geocoding service.
  function setZip(zip) {
    if (!/^\d{5}$/.test(zip)) return Promise.reject(new Error('Enter a five-digit US ZIP code.'));
    return request('https://api.zippopotam.us/us/' + zip, new AbortController()).then(function (result) {
      var place = result.places && result.places[0];
      if (!place) throw new Error('ZIP code was not found.');
      return setLocation({
        label: place['place name'] + ', ' + place['state abbreviation'],
        zip: zip,
        latitude: Number(place.latitude),
        longitude: Number(place.longitude),
      });
    });
  }
  // Check device support before requesting location permission.
  function detect() {
    if (root.FramePlatform.locationCapability() === false) return Promise.reject(new Error('This TV reports no location provider, including Wi-Fi positioning. Use a ZIP code.'));
    if (!navigator.geolocation) return Promise.reject(new Error('Location detection is unavailable. Use a ZIP code.'));
    return new Promise(function (resolve, reject) {
      navigator.geolocation.getCurrentPosition(resolve, function () {
        reject(new Error('Location was unavailable or permission was denied. Your saved location is unchanged.'));
      }, { timeout: 10000, maximumAge: 3600000, enableHighAccuracy: false });
    }).then(function (position) {
      return setLocation({ label: 'Detected location', zip: '', latitude: position.coords.latitude, longitude: position.coords.longitude });
    });
  }
  var weatherGroups = [
    { codes: [0], label: 'Clear', icon: 'clear' },
    { codes: [1, 2], label: 'Partly cloudy', icon: 'partly' },
    { codes: [3], label: 'Overcast', icon: 'cloud' },
    { codes: [45, 48], label: 'Fog', icon: 'fog' },
    { codes: [51, 53, 55, 56, 57], label: 'Drizzle', icon: 'rain' },
    { codes: [61, 63, 65, 66, 67], label: 'Rain', icon: 'rain' },
    { codes: [71, 73, 75, 77], label: 'Snow', icon: 'snow' },
    { codes: [80, 81, 82], label: 'Showers', icon: 'rain' },
    { codes: [85, 86], label: 'Snow showers', icon: 'snow' },
    { codes: [95, 96, 97, 99], label: 'Thunderstorms', icon: 'storm' }
  ];
  function conditions(code) {
    return weatherGroups.find(function (group) { return group.codes.indexOf(code) >= 0; }) || { label: 'Conditions unavailable', icon: '' };
  }
  root.FrameWeather = { state: state, refresh: refresh, refreshWhenVisible: refreshWhenVisible, setZip: setZip, detect: detect, conditions: conditions };
  setInterval(refreshWhenVisible, refreshInterval);
  root.document.addEventListener('visibilitychange', refreshWhenVisible);
}(window));
