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
      // Google Maps Universal URL API supports up to 9 intermediate waypoints
      let exportWaypoints = waypoints;
      if (exportWaypoints.length > 9) {
        const step = (exportWaypoints.length - 1) / 8;
        const sampled = [];
        for (let i = 0; i < 9; i++) {
          sampled.push(exportWaypoints[Math.min(exportWaypoints.length - 1, Math.round(i * step))]);
        }
        exportWaypoints = sampled;
      }
      // Pipe-separated list of coordinates: lat,lng|lat,lng
      const wpParam = exportWaypoints
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
   * Opens an external navigation URL reliably on Android WebView, Capacitor, and mobile browsers
   */
  function openExternalUrl(url) {
    if (!url) return;
    console.log('[VoltWay Nav] Opening URL:', url);

    // 1. Try Capacitor App launcher
    try {
      if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App && typeof window.Capacitor.Plugins.App.openUrl === 'function') {
        window.Capacitor.Plugins.App.openUrl({ url });
        return;
      }
    } catch (e) {}

    // 2. Try window.open with _system (Capacitor/Cordova native external app trigger)
    try {
      const sysWin = window.open(url, '_system');
      if (sysWin) return;
    } catch (e) {}

    // 3. Dispatch click via anchor tag (triggers Android Intent for Google Maps)
    try {
      const a = document.createElement('a');
      a.href = url;
      a.target = '_system';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return;
    } catch (e) {}

    // 4. Standard browser fallback
    const win = window.open(url, '_blank', 'noopener,noreferrer');
    if (!win || win.closed || typeof win.closed === 'undefined') {
      window.location.href = url;
    }
  }

  /**
   * Launch native Google Maps app with full multi-stop route
   */
  function startFullTrip(origin, destination, waypoints = []) {
    const url = buildMultiStopGoogleMapsUrl(origin, destination, waypoints);
    if (!url) {
      if (window.SyncEngine && window.SyncEngine.showAutoUpdateToast) {
        window.SyncEngine.showAutoUpdateToast('⚠️ Please set origin and destination first.');
      } else {
        alert('Please set both origin and destination before starting navigation.');
      }
      return;
    }
    console.log('[VoltWay Nav] Launching Multi-stop Google Maps URL:', url);
    openExternalUrl(url);
  }

  /**
   * Launch native Google Maps to the immediate next charger
   */
  function navigateToNextCharger(nextCharger, currentPosition = null) {
    if (!nextCharger) {
      if (window.SyncEngine && window.SyncEngine.showAutoUpdateToast) {
        window.SyncEngine.showAutoUpdateToast('⚠️ No next charger waypoint available.');
      } else {
        alert('No next charger waypoint available.');
      }
      return;
    }
    const url = buildSingleStopGoogleMapsUrl(nextCharger, currentPosition);
    console.log('[VoltWay Nav] Navigating to next charger:', nextCharger.name, url);
    openExternalUrl(url);
  }

  /**
   * Copy turn-by-turn route coordinates to clipboard
   */
  function copyRouteLink(origin, destination, waypoints = []) {
    const url = buildMultiStopGoogleMapsUrl(origin, destination, waypoints);
    if (window.Utilities && window.Utilities.copyToClipboard) {
      window.Utilities.copyToClipboard(url, '📋 Google Maps navigation link copied!');
    } else if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(() => {
        alert('Route navigation link copied to clipboard!');
      }).catch(() => {
        prompt('Copy this Google Maps navigation link:', url);
      });
    } else {
      prompt('Copy this Google Maps navigation link:', url);
    }
  }

  /**
   * Resolves short Google Maps URL (maps.app.goo.gl or goo.gl/maps) via backend API
   */
  async function resolveShortUrl(shortUrl) {
    try {
      const resp = await fetch(`/api/resolve-maps-url?url=${encodeURIComponent(shortUrl)}`);
      if (resp.ok) {
        const data = await resp.json();
        if (data.success && data.resolved_url) {
          return data.resolved_url;
        }
      }
    } catch (e) {
      console.warn('Local resolve endpoint failed, using target as-is:', e);
    }
    return shortUrl;
  }

  /**
   * Universal Google Maps Share & Route Link Parser
   * Extracts origin, intermediate waypoints, and destination from ANY Google Maps URL or shared text
   */
  async function parseGoogleMapsInput(rawInput) {
    if (!rawInput || typeof rawInput !== 'string') {
      return { success: false, error: 'Empty input provided' };
    }

    let text = rawInput.trim();

    // 1. Extract URL if embedded in text (e.g. "Check out this route https://maps.app.goo.gl/...")
    const urlMatch = text.match(/https?:\/\/[^\s]+/i);
    let targetUrl = urlMatch ? urlMatch[0] : (text.startsWith('http') ? text : '');

    // 2. Resolve short Google Maps URL if present
    if (targetUrl && (targetUrl.includes('maps.app.goo.gl') || targetUrl.includes('goo.gl/maps'))) {
      targetUrl = await resolveShortUrl(targetUrl);
      text = targetUrl;
    }

    const result = {
      success: true,
      origin: null,
      destination: null,
      intermediateStops: [],
      rawText: rawInput
    };

    // 3. Try parsing query parameters (?api=1&origin=...&destination=...&waypoints=...)
    try {
      const urlObj = new URL(targetUrl || (text.startsWith('http') ? text : 'https://dummy.com/' + text));
      const params = urlObj.searchParams;

      const originParam = params.get('origin') || params.get('saddr');
      const destParam = params.get('destination') || params.get('daddr') || params.get('q');
      const waypointsParam = params.get('waypoints');

      if (destParam) {
        if (originParam) {
          const oCoords = originParam.match(/^(-?\d+\.\d+),(-?\d+\.\d+)$/);
          result.origin = oCoords ? { lat: parseFloat(oCoords[1]), lng: parseFloat(oCoords[2]), name: 'Start Location' } : { name: decodeURIComponent(originParam).replace(/\+/g, ' ') };
        }

        const dCoords = destParam.match(/^(-?\d+\.\d+),(-?\d+\.\d+)$/);
        result.destination = dCoords ? { lat: parseFloat(dCoords[1]), lng: parseFloat(dCoords[2]), name: 'Destination' } : { name: decodeURIComponent(destParam).replace(/\+/g, ' ') };

        if (waypointsParam) {
          const wpList = waypointsParam.split('|');
          for (const wp of wpList) {
            const wCoords = wp.match(/^(-?\d+\.\d+),(-?\d+\.\d+)$/);
            if (wCoords) {
              result.intermediateStops.push({ lat: parseFloat(wCoords[1]), lng: parseFloat(wCoords[2]), name: 'Intermediate Stop' });
            } else if (wp.trim()) {
              result.intermediateStops.push({ name: decodeURIComponent(wp).replace(/\+/g, ' ') });
            }
          }
        }

        if (result.destination) {
          return result;
        }
      }
    } catch (e) {
      // Not a standard URL object, proceed to regex
    }

    // 4. Try extracting high-precision coordinates from Google Maps data blob (!1d{lng}!2d{lat})
    const dataCoordMatches = [...text.matchAll(/!1d(-?\d+\.\d+)!2d(-?\d+\.\d+)/g)];
    if (dataCoordMatches && dataCoordMatches.length >= 2) {
      const allPoints = dataCoordMatches.map((m, idx) => ({
        lat: parseFloat(m[2]),
        lng: parseFloat(m[1]),
        name: idx === 0 ? 'Start (Google Maps)' : (idx === dataCoordMatches.length - 1 ? 'Destination (Google Maps)' : `Stop ${idx}`)
      }));

      result.origin = allPoints[0];
      result.destination = allPoints[allPoints.length - 1];
      result.intermediateStops = allPoints.slice(1, -1);
      return result;
    }

    // 5. Try parsing Google Maps path format: /maps/dir/StopA/StopB/StopC/...
    if (text.includes('/maps/dir/')) {
      const pathPart = text.split('/maps/dir/')[1].split('?')[0].split('/data=')[0];
      const segments = pathPart.split('/').map(s => decodeURIComponent(s).replace(/\+/g, ' ').trim()).filter(s => s && !s.startsWith('@'));
      if (segments.length >= 2) {
        result.origin = { name: segments[0] };
        result.destination = { name: segments[segments.length - 1] };
        result.intermediateStops = segments.slice(1, -1).map(s => ({ name: s }));
        return result;
      } else if (segments.length === 1) {
        result.destination = { name: segments[0] };
        return result;
      }
    }

    // 6. Check for @lat,lng or /place/lat,lng
    const atMatch = text.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || text.match(/\/place\/(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (atMatch) {
      result.destination = { lat: parseFloat(atMatch[1]), lng: parseFloat(atMatch[2]), name: 'Shared Pin / Location' };
      return result;
    }

    // 7. Plain text coordinate matching (e.g. "10.8505, 76.2711" or "Dropped pin near 10.8505, 76.2711")
    const genericCoordMatches = [...text.matchAll(/(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/g)];
    if (genericCoordMatches.length >= 2) {
      result.origin = { lat: parseFloat(genericCoordMatches[0][1]), lng: parseFloat(genericCoordMatches[0][2]), name: 'Start Location' };
      result.destination = { lat: parseFloat(genericCoordMatches[genericCoordMatches.length - 1][1]), lng: parseFloat(genericCoordMatches[genericCoordMatches.length - 1][2]), name: 'Destination' };
      if (genericCoordMatches.length > 2) {
        result.intermediateStops = genericCoordMatches.slice(1, -1).map((m, i) => ({
          lat: parseFloat(m[1]),
          lng: parseFloat(m[2]),
          name: `Stop ${i + 1}`
        }));
      }
      return result;
    } else if (genericCoordMatches.length === 1) {
      result.destination = { lat: parseFloat(genericCoordMatches[0][1]), lng: parseFloat(genericCoordMatches[0][2]), name: 'Shared Destination' };
      return result;
    }

    return { success: false, error: 'Could not extract valid route points from the Google Maps text. Please verify the URL or coordinates.' };
  }

  return {
    buildMultiStopGoogleMapsUrl,
    buildSingleStopGoogleMapsUrl,
    startFullTrip,
    navigateToNextCharger,
    copyRouteLink,
    resolveShortUrl,
    parseGoogleMapsInput
  };
})();

window.NavigationEngine = NavigationEngine;
