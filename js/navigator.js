/**
 * VoltWay 2W - External Google Maps Navigation Deep-Link Engine
 * Generates universal deep-links for external turn-by-turn export on Android
 */

const NavigationEngine = (function () {

  function buildMultiStopGoogleMapsUrl(origin, destination, waypoints = []) {
    if (!origin || !destination) {
      return '';
    }

    const originParam = `${origin.lat},${origin.lng}`;
    const destParam = `${destination.lat},${destination.lng}`;
    let url = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(originParam)}&destination=${encodeURIComponent(destParam)}&travelmode=driving`;

    if (waypoints && waypoints.length > 0) {
      let exportWaypoints = waypoints;
      if (exportWaypoints.length > 9) {
        const step = (exportWaypoints.length - 1) / 8;
        const sampled = [];
        for (let i = 0; i < 9; i++) {
          sampled.push(exportWaypoints[Math.min(exportWaypoints.length - 1, Math.round(i * step))]);
        }
        exportWaypoints = sampled;
      }
      const wpParam = exportWaypoints.map(wp => `${wp.lat},${wp.lng}`).join('|');
      url += `&waypoints=${encodeURIComponent(wpParam)}`;
    }

    return url;
  }

  function buildSingleStopGoogleMapsUrl(destination, origin = null) {
    if (!destination) return '';
    const destParam = `${destination.lat},${destination.lng}`;
    let url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destParam)}&travelmode=driving`;
    if (origin) {
      url += `&origin=${encodeURIComponent(`${origin.lat},${origin.lng}`)}`;
    }
    return url;
  }

  function openExternalUrl(url) {
    if (!url) return;

    try {
      if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App && typeof window.Capacitor.Plugins.App.openUrl === 'function') {
        window.Capacitor.Plugins.App.openUrl({ url });
        return;
      }
    } catch (e) {}

    try {
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return;
    } catch (e) {}

    window.location.href = url;
  }

  function startFullTrip(origin, destination, waypoints = []) {
    const url = buildMultiStopGoogleMapsUrl(origin, destination, waypoints);
    if (!url) {
      if (window.SyncEngine && window.SyncEngine.showAutoUpdateToast) {
        window.SyncEngine.showAutoUpdateToast('⚠️ Please set origin and destination first.');
      }
      return;
    }
    if (window.RouteEngine && typeof window.RouteEngine.markSentToGoogleMaps === 'function') {
      window.RouteEngine.markSentToGoogleMaps();
    }
    openExternalUrl(url);
  }

  function navigateToNextCharger(nextCharger, currentPosition = null) {
    if (!nextCharger) return;
    const url = buildSingleStopGoogleMapsUrl(nextCharger, currentPosition);
    openExternalUrl(url);
  }

  function copyRouteLink(origin, destination, waypoints = []) {
    const url = buildMultiStopGoogleMapsUrl(origin, destination, waypoints);
    if (window.Utilities && window.Utilities.copyToClipboard) {
      window.Utilities.copyToClipboard(url, '📋 Google Maps navigation link copied!');
    }
  }

  return {
    buildMultiStopGoogleMapsUrl,
    buildSingleStopGoogleMapsUrl,
    startFullTrip,
    navigateToNextCharger,
    copyRouteLink
  };
})();

window.NavigationEngine = NavigationEngine;
