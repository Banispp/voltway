/**
 * VoltWay 2W - Google Maps Multi-Stop Navigation Engine
 * Generates universal deep-links for native turn-by-turn voice navigation on Android
 */

const NavigationEngine = (function () {

  /**
   * Builds the Universal Google Maps multi-stop navigation URL
   * Format:
   * https://www.google.com/maps/dir/?api=1&origin={Origin_Lat},{Origin_Lng}&destination={Dest_Lat},{Dest_Lng}&waypoints={Stop1_Lat},{Stop1_Lng}|{Stop2_Lat},{Stop2_Lng}&travelmode=driving
   *
   * @param {Object} origin { lat, lng }
   * @param {Object} destination { lat, lng }
   * @param {Array} waypoints Array of intermediate charger objects [{ lat, lng }]
   * @returns {string} Universal Google Maps URL
   */
  function buildMultiStopGoogleMapsUrl(origin, destination, waypoints = []) {
    if (!origin || !destination) {
      console.warn('Cannot build Google Maps URL without origin and destination');
      return '';
    }

    const originParam = `${origin.lat},${origin.lng}`;
    const destParam = `${destination.lat},${destination.lng}`;

    let url = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(originParam)}&destination=${encodeURIComponent(destParam)}&travelmode=driving`;

    if (waypoints && waypoints.length > 0) {
      // Pipe-separated list of coordinates: lat,lng|lat,lng
      const wpParam = waypoints
        .map(wp => `${wp.lat},${wp.lng}`)
        .join('|');
      url += `&waypoints=${encodeURIComponent(wpParam)}`;
    }

    return url;
  }

  /**
   * Builds a single-stop Google Maps navigation URL
   * @param {Object} destination { lat, lng, name }
   * @param {Object} origin Optional { lat, lng }
   * @returns {string} Universal Google Maps navigation URL
   */
  function buildSingleStopGoogleMapsUrl(destination, origin = null) {
    if (!destination) return '';
    const destParam = `${destination.lat},${destination.lng}`;
    let url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destParam)}&travelmode=driving`;
    if (origin) {
      url += `&origin=${encodeURIComponent(`${origin.lat},${origin.lng}`)}`;
    }
    return url;
  }

  /**
   * Launch native Google Maps app with full multi-stop route
   */
  function startFullTrip(origin, destination, waypoints = []) {
    const url = buildMultiStopGoogleMapsUrl(origin, destination, waypoints);
    if (!url) {
      alert('Please set both origin and destination before starting navigation.');
      return;
    }
    console.log('[VoltWay Nav] Launching Multi-stop Google Maps URL:', url);
    // On Android, window.open or window.location with this universal link opens native Google Maps app
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  /**
   * Launch native Google Maps to the immediate next charger
   */
  function navigateToNextCharger(nextCharger, currentPosition = null) {
    if (!nextCharger) {
      alert('No next charger waypoint available.');
      return;
    }
    const url = buildSingleStopGoogleMapsUrl(nextCharger, currentPosition);
    console.log('[VoltWay Nav] Navigating to next charger:', nextCharger.name, url);
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  /**
   * Copy turn-by-turn route coordinates to clipboard
   */
  function copyRouteLink(origin, destination, waypoints = []) {
    const url = buildMultiStopGoogleMapsUrl(origin, destination, waypoints);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(() => {
        alert('Route navigation link copied to clipboard!');
      }).catch(() => {
        prompt('Copy this Google Maps navigation link:', url);
      });
    } else {
      prompt('Copy this Google Maps navigation link:', url);
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
