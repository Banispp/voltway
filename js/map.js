/**
 * VoltWay 2W - Interactive Leaflet Map Engine
 * High-performance spatial viewport culling, connector-aware popups,
 * tilt-compensated 3D handlebar compass & lifecycle-aware GPS tracking.
 */

const MapEngine = (function () {
  let map = null;
  let tileLayer = null;
  let currentTileTheme = 'dark';

  // Layers
  let markersLayer = null;
  let routeLayer = null;
  let waypointsLayer = null;
  let userLocationMarker = null;
  let userAccuracyCircle = null;
  let batteryRangeCircle = null;
  let activeMainLine = null;
  let activeGlowLine = null;
  let traversedMainLine = null;
  let recenterTimer = null;
  let searchPinMarker = null;
  let droppedPinMarker = null;

  // Live GPS & Orientation state
  let watchId = null;
  let userHeading = 0;
  let isAutoFollow = false;
  let isUserInteracting = false;
  let isUserRotating = false;
  let isProgrammaticMove = false;
  let isNavCompassMode = false; // false = Route-Locked, true = Free Compass
  let lastGpsFixTime = 0;

  let activeStateFilter = localStorage.getItem('voltway_selected_state') || localStorage.getItem('voltway_state_filter') || 'all';

  const filters = {
    atherFast: true,
    vidaFast: true,
    boltFast: true,
    boltSlow: false
  };

  try {
    const savedFilters = localStorage.getItem('voltway_network_filters');
    if (savedFilters) {
      const parsed = JSON.parse(savedFilters);
      if (parsed && typeof parsed === 'object') {
        Object.keys(filters).forEach(k => {
          if (parsed[k] !== undefined) filters[k] = Boolean(parsed[k]);
        });
      }
    }
  } catch (e) {}

  let userCoords = null; // { lat, lng, accuracy, heading, speed }
  const markerMap = new Map();
  const waypointMarkersMap = new Map();
  let activePopupChargerId = null;
  let lastDatasetKey = '';
  let isCorridorClusterMode = false;

  let renderRafId = null;
  let moveDebounceTimer = null;
  let mapContainerId = 'map';

  // Rotation Animation & Compass State
  let compassEventType = null;
  let compassHandlerRef = null;
  let targetBearing = 0;
  let currentRenderedBearing = 0;
  let bearingRafId = null;
  let lastPuckRotDeg = null;
  let markerAnimRaf = null;
  let markerCurrentLat = null;
  let markerCurrentLng = null;
  let markerStartLat = null;
  let markerStartLng = null;
  let markerTargetLat = null;
  let markerTargetLng = null;
  let cameraCurrentLat = null;
  let cameraCurrentLng = null;
  let cameraStartLat = null;
  let cameraStartLng = null;
  let cameraTargetLat = null;
  let cameraTargetLng = null;
  let cameraGlideActive = false;
  let isContinuousMotion = false;
  let glideStartTime = 0;
  let glideDurationMs = 950;
  let prevGpsFixAt = 0;
  let smoothedGpsCadenceMs = 1000;
  let motionLastTickTime = 0;
  let lastMoveEndSyncTime = 0;
  let panSinceMoveEndPx = 0;
  let capWatchId = null;
  let lastBoltLiveScanTime = 0;

  function esc(str) {
    return window.Utilities && window.Utilities.escapeHtml
      ? window.Utilities.escapeHtml(str)
      : String(str || '').replace(/[&<>"']/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]));
  }

  function initMap(containerId = 'map') {
    if (map) return map;
    mapContainerId = containerId || 'map';

    let defaultCenter = [11.5, 77.0];
    let defaultZoom = 8;
    if (activeStateFilter === 'kerala') {
      defaultCenter = [10.0246, 76.3079];
      defaultZoom = 10;
    } else if (activeStateFilter === 'karnataka') {
      defaultCenter = [12.9716, 77.5946];
      defaultZoom = 11;
    } else if (activeStateFilter === 'tamil_nadu') {
      defaultCenter = [11.0168, 76.9558];
      defaultZoom = 10;
    }

    if (!L.Map.TouchGestures || !L.Map.TouchGestures.prototype._voltwayPinchFixed) {
      if (L.Map.TouchGestures && L.Map.TouchGestures.prototype) {
        const origTouchEnd = L.Map.TouchGestures.prototype._onTouchEnd;
        L.Map.TouchGestures.prototype._onTouchMove = function (t) {
          if (!t.touches || t.touches.length !== 2 || !this._gesture) return;
          const e = this._map;
          const container = e.getContainer();
          const rect = container.getBoundingClientRect();
          const pt = (ev) => new L.Point(ev.clientX - rect.left - container.clientLeft, ev.clientY - rect.top - container.clientTop);
          const o = pt(t.touches[0]);
          const n = pt(t.touches[1]);
          const s = o.subtract(n);
          const a = o.distanceTo(n) / this._startDist;

          if (this._gesture === 'pending') {
            const h = o.subtract(this._startP1);
            const _ = n.subtract(this._startP2);
            if (Math.max(h.x * h.x + h.y * h.y, _.x * _.x + _.y * _.y) < 25) {
              L.DomEvent.preventDefault(t);
              return;
            }
            const isVert = (m) => Math.abs(m.y) > Math.abs(m.x);
            if (isVert(h) && isVert(_) && Math.sign(h.y) === Math.sign(_.y)) {
              this._gesture = 'pitch';
              this._lastPitchY = (this._startP1.y + this._startP2.y) / 2;
              this._zooming = this._rotating = false;
            } else {
              this._gesture = 'pinch';
            }
          }

          if (this._gesture === 'pitch') {
            const midY = (o.y + n.y) / 2;
            e._setPitchAndBearing(e.getPitch() - (midY - this._lastPitchY) * 0.5, e.getBearing());
            this._lastPitchY = midY;
            L.DomEvent.preventDefault(t);
            return;
          }

          if (!(this._zooming || this._rotating)) return;

          if (this._rotating) {
            let thetaDiff = (Math.atan(s.x / s.y) - this._startTheta) * (180 / Math.PI);
            if (s.y < 0) thetaDiff += 180;
            if (thetaDiff) e.setBearing(this._startBearing - thetaDiff);
          }

          if (this._zooming) {
            this._zoom = e.getScaleZoom(a, this._startZoom);
            if (!e.options.bounceAtZoomLimits && ((this._zoom < e.getMinZoom() && a < 1) || (this._zoom > e.getMaxZoom() && a > 1))) {
              this._zoom = e._limitZoom(this._zoom);
            }
            if (e.options.touchZoom === 'center') {
              this._center = this._startLatLng;
              if (a === 1) return;
            } else {
              const r = o._add(n)._divideBy(2)._subtract(this._centerPoint);
              if (a === 1 && r.x === 0 && r.y === 0) return;
              const h = e._pitch
                ? e.containerPointToLayerPoint(this._centerPoint.add(r)).subtract(e.containerPointToLayerPoint(this._centerPoint))
                : r.rotate(-e.getBearing() * (Math.PI / 180));
              this._center = e.unproject(e.project(this._pinchStartLatLng, this._zoom).subtract(h), this._zoom);
            }
          }

          if (!this._moved) {
            e._moveStart(true, false);
            this._moved = true;
          }

          L.Util.cancelAnimFrame(this._animRequest);
          this._animRequest = L.Util.requestAnimFrame(() => {
            if (!e || !e._mapPane) return;
            if (e._pitch && e.options.zoomAnimation) {
              e._animateZoomNoDelay(this._center, e._limitZoom(this._zoom));
            } else {
              e._move(this._center, this._zoom, { pinch: true, round: false });
            }
          }, this, true);
          L.DomEvent.preventDefault(t);
        };
        L.Map.TouchGestures.prototype._onTouchEnd = function () {
          L.Util.cancelAnimFrame(this._animRequest);
          return origTouchEnd.apply(this, arguments);
        };
        L.Map.TouchGestures.prototype._voltwayPinchFixed = true;
      }
    }

    map = L.map(containerId, {
      center: defaultCenter,
      zoom: defaultZoom,
      zoomControl: false,
      attributionControl: false,
      preferCanvas: true,
      zoomAnimation: true,
      zoomAnimationThreshold: 8,
      markerZoomAnimation: true,
      wheelDebounceTime: 40,
      wheelPxPerZoomLevel: 75,
      inertia: true,
      inertiaDeceleration: 2400,
      rotate: true,
      touchRotate: true,
      rotateControl: false,
      bearing: 0
    });

    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.control.attribution({ position: 'bottomleft', prefix: false })
      .addAttribution('&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OSM</a> | VoltWay 2W')
      .addTo(map);

    let initialTheme = 'dark';
    try {
      initialTheme = localStorage.getItem('voltway_map_theme') || 'dark';
    } catch (e) {}
    setTileTheme(initialTheme);

    markersLayer = (typeof L.markerClusterGroup === 'function')
      ? L.markerClusterGroup({
          chunkedLoading: false,
          animate: true,
          animateAddingMarkers: false,
          showCoverageOnHover: false,
          zoomToBoundsOnClick: true,
          spiderfyOnMaxZoom: true,
          spiderfyDistanceMultiplier: 1.45,
          removeOutsideVisibleBounds: true,
          disableClusteringAtZoom: 13,
          maxClusterRadius: function (z) {
            if (isCorridorClusterMode) return 28;
            if (z <= 5) return 96;
            if (z <= 7) return 78;
            if (z <= 9) return 60;
            if (z <= 11) return 44;
            return 32;
          },
          iconCreateFunction: createClusterBadgeIcon
        }).addTo(map)
      : L.layerGroup().addTo(map);
    routeLayer = L.layerGroup().addTo(map);
    waypointsLayer = L.layerGroup().addTo(map);

    let hadZoomAnimForMove = false;
    map.on('zoomanim', () => { hadZoomAnimForMove = true; });
    map.on('moveend', onMapMoveEnd);
    map.on('zoomend', () => {
      const wasAnim = hadZoomAnimForMove;
      hadZoomAnimForMove = false;
      if (!wasAnim && markersLayer && typeof markersLayer._processQueue === 'function') {
        try { markersLayer._processQueue(); } catch (e) {}
        if (markersLayer._queueTimeout) {
          clearTimeout(markersLayer._queueTimeout);
          markersLayer._queueTimeout = null;
        }
        markersLayer._inZoomAnimation = 0;
        if (map && map._mapPane) {
          map._mapPane.className = map._mapPane.className.replace(/\bleaflet-cluster-anim\b/g, '').trim();
        }
      }
      onMapMoveEnd();
    });

    function handleUserManualInteraction() {
      isAutoFollow = false;
      isUserInteracting = true;
      cameraGlideActive = false;
      cameraTargetLat = null;
      cameraTargetLng = null;
      updateGpsButtonUi();

      if (bearingRafId) {
        cancelAnimationFrame(bearingRafId);
        bearingRafId = null;
      }

      if (recenterTimer) clearTimeout(recenterTimer);
      if (window.DriveEngine && window.DriveEngine.isActive()) {
        recenterTimer = setTimeout(() => {
          isUserInteracting = false;
          recenterCamera();
        }, 10000);
      }
    }

    map.on('dragstart', handleUserManualInteraction);
    map.on('zoomstart', () => {
      if (!isProgrammaticMove) handleUserManualInteraction();
    });
    map.on('movestart', (e) => {
      if (!e.hard && !isAutoFollow && !isProgrammaticMove) {
        handleUserManualInteraction();
      }
    });

    map.on('rotatestart', () => {
      isUserRotating = true;
      handleUserManualInteraction();
    });

    map.on('rotate', () => {
      if (map && typeof map.getBearing === 'function') {
        currentRenderedBearing = map.getBearing();
        targetBearing = currentRenderedBearing;
        updatePuckHeading(userHeading);
        const needle = document.getElementById('nav-compass-needle');
        if (needle) needle.style.transform = `rotate(${-currentRenderedBearing}deg)`;
      }
    });

    map.on('rotateend', () => {
      setTimeout(() => { isUserRotating = false; }, 350);
    });

    map.on('click', (e) => {
      const sheet = document.getElementById('bottom-sheet');
      const wasSheetExpanded = Boolean(window.innerWidth <= 768 && sheet && !sheet.classList.contains('collapsed'));
      if (window.innerWidth <= 768 && typeof window.collapseBottomSheet === 'function') {
        window.collapseBottomSheet();
      }
      // Close open charger popup (first tap dismisses it)
      if (activePopupChargerId) {
        activePopupChargerId = null;
        if (map) map.closePopup();
        return;
      }
      // Tap-to-navigate ONLY works BEFORE Plan 2W Route (when no active route / drive mode)
      const hasActiveRoute = Boolean(window.RouteEngine && typeof window.RouteEngine.getActiveRoute === 'function' && window.RouteEngine.getActiveRoute());
      const isDriving = Boolean(window.DriveEngine && typeof window.DriveEngine.isActive === 'function' && window.DriveEngine.isActive());
      if (hasActiveRoute || isDriving) return;
      // Skip if map is rotating
      if (isUserRotating) return;
      // Block UI elements from triggering pin drop
      const target = e.originalEvent ? e.originalEvent.target : null;
      if (target && (target.closest('.leaflet-marker-icon') || target.closest('.leaflet-popup') || target.closest('.btn-header-action') || target.closest('.map-control-btn') || target.closest('.brand-header') || target.closest('.map-top-bar') || target.closest('.btn-float-gps') || target.closest('.btn-toggle-fullscreen') || target.closest('.btn-toggle-map-theme'))) {
        return;
      }
      if (e && e.latlng && typeof e.latlng.lat === 'number' && typeof e.latlng.lng === 'number') {
        const tapLat = e.latlng.lat;
        const tapLng = e.latlng.lng;
        if (wasSheetExpanded) {
          // Wait for sheet collapse + invalidateSize before dropping pin on mobile
          setTimeout(() => {
            isUserInteracting = false;
            showDroppedPinAtCoords(tapLat, tapLng);
          }, 320);
        } else {
          isUserInteracting = false;
          showDroppedPinAtCoords(tapLat, tapLng);
        }
      }
    });

    // Restore last known puck immediately for zero-delay visual launch
    try {
      const cached = localStorage.getItem('voltway_last_known_pos');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && parsed.lat && parsed.lng) {
          userCoords = { lat: parsed.lat, lng: parsed.lng, accuracy: 25, heading: 0, speed: 0 };
          updateUserPuck(parsed.lat, parsed.lng, 25, 0);
        }
      }
    } catch (e) {}

    initCompass();
    locateUser(false);

    // Pause GPS & compass completely in background; acquire fresh foreground GPS snapshot upon reopening
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        if (!window.DriveEngine || !window.DriveEngine.isActive()) {
          stopLiveTracking();
          stopCompass();
        }
      } else if (document.visibilityState === 'visible') {
        initCompass();
        locateUser(false, true);
        if (map) {
          setTimeout(() => map.invalidateSize(), 120);
        }
      }
    });

    return map;
  }

  function setTileTheme(theme = 'dark') {
    currentTileTheme = theme === 'daylight' || theme === 'light' ? 'daylight' : 'dark';
    try { localStorage.setItem('voltway_map_theme', currentTileTheme); } catch (e) {}

    const isLight = currentTileTheme !== 'dark';
    const mapEl = document.getElementById(mapContainerId) || document.getElementById('map');
    const themeBtnIcon = document.getElementById('theme-btn-icon');
    const themeBtn = document.getElementById('btn-toggle-map-theme');
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');

    if (typeof document !== 'undefined' && document.body) {
      document.body.classList.toggle('ui-light-mode', isLight);
    }
    if (metaThemeColor) {
      metaThemeColor.setAttribute('content', isLight ? '#ffffff' : '#06090f');
    }

    if (!isLight) {
      if (mapEl) mapEl.classList.add('map-dark-mode');
      if (themeBtnIcon) themeBtnIcon.textContent = '☀️';
      if (themeBtn) {
        themeBtn.setAttribute('title', 'Switch to White Light Mode (Map + UI)');
        themeBtn.style.color = '#fbbf24';
      }
    } else {
      if (mapEl) mapEl.classList.remove('map-dark-mode');
      if (themeBtnIcon) themeBtnIcon.textContent = '🌙';
      if (themeBtn) {
        themeBtn.setAttribute('title', 'Switch to OLED Dark Mode (Map + UI)');
        themeBtn.style.color = '#0284c7';
      }
    }

    if (!tileLayer && map) {
      tileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        subdomains: ['a', 'b', 'c'],
        updateWhenIdle: false,
        updateInterval: 150,
        keepBuffer: 4,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OSM</a> | VoltWay 2W'
      }).addTo(map);
    }
  }

  function toggleTileTheme() {
    const nextTheme = (currentTileTheme === 'dark') ? 'daylight' : 'dark';
    setTileTheme(nextTheme);
    if (window.SyncEngine && window.SyncEngine.showAutoUpdateToast) {
      window.SyncEngine.showAutoUpdateToast(nextTheme === 'dark' ? '🌙 OLED Dark Mode (UI + Map)' : '☀️ Daylight White Mode (UI + Map)');
    }
    return nextTheme;
  }

  function createClusterBadgeIcon(cluster) {
    const count = cluster.getChildCount();
    const display = count >= 10000
      ? `${(count / 1000).toFixed(1).replace(/\.0$/, '')}k`
      : String(count);

    let sizePx = 34;
    let sizeCls = 'cluster-xs';
    if (count >= 1000) {
      sizePx = 50;
      sizeCls = 'cluster-xl';
    } else if (count >= 100) {
      sizePx = 44;
      sizeCls = 'cluster-lg';
    } else if (count >= 50) {
      sizePx = 40;
      sizeCls = 'cluster-md';
    } else if (count >= 10) {
      sizePx = 38;
      sizeCls = 'cluster-sm';
    }

    return L.divIcon({
      html: `<div class="voltway-cluster-pill ${sizeCls}">${display}</div>`,
      className: 'voltway-cluster-container',
      iconSize: L.point(sizePx, sizePx),
      iconAnchor: L.point(sizePx / 2, sizePx / 2)
    });
  }

  function getBrandLogoSvg(network, size = 21) {
    if (network === 'ATHER_GRID') {
      // Official Ather Energy / Ather Grid emblem symbol (ring + dot + slanted pill mark)
      return `<svg width="${size}" height="${size}" viewBox="0 0 48 48" fill="none" aria-hidden="true"><circle cx="24" cy="24" r="20.2" stroke="currentColor" stroke-width="3.6"/><circle cx="17.336" cy="28.845" r="4.336" fill="currentColor"/><path fill="currentColor" d="m27.997 14.94 6.541 12.39a3.99 3.99 0 0 1-1.666 5.392 3.99 3.99 0 0 1-5.382-1.67L20.95 18.66a3.98 3.98 0 0 1 1.661-5.377 3.983 3.983 0 0 1 5.386 1.657Z"/></svg>`;
    }
    if (network === 'VIDA_GRID') {
      // Official Hero VIDA wings emblem (vidaworld.com/.../vida-white-logo-img.svg)
      return `<svg width="${size}" height="${size}" viewBox="95 -2 31 29" fill="currentColor" aria-hidden="true"><path d="M102.601 14.5565V12.9418C102.601 12.6793 102.741 12.4353 102.967 12.3028L109.458 8.53763C109.761 8.36264 109.948 8.0365 109.948 7.68385V0.493013C109.948 0.113849 109.539 -0.122133 109.215 0.0661225L98.1948 6.45887C97.8914 6.63386 97.7041 6.96 97.7041 7.30999V24.3352C97.7041 24.6083 97.9231 24.8284 98.1948 24.8284H102.07C102.413 24.8284 102.751 24.7382 103.049 24.5632L123.509 12.6899C123.813 12.5149 124 12.1887 124 11.8361V3.41761C124 3.03844 123.591 2.80246 123.267 2.99072L102.97 14.7686C102.807 14.8641 102.603 14.7448 102.603 14.5565"/></svg>`;
    }
    // Official Bolt.Earth ring + bolt emblem (media.bolt.earth/images/logo.svg)
    return `<svg width="${size}" height="${size}" viewBox="8 1 53 53" fill="currentColor" aria-hidden="true"><path d="M32.1234 12.9298L25.8125 29.9537H32.4352L26.9957 43.9875L44.2821 23.6421L36.7739 23.6561L44.8431 12.9023L32.1234 12.9298V12.9298Z"/><path d="M58.9805 27.1157C58.9805 13.4831 47.929 2.46606 34.3309 2.46606C20.7328 2.46606 9.69531 13.5041 9.69531 27.1157V27.2958C9.69531 40.8524 20.6983 51.8765 34.2548 51.8765C40.8776 51.8765 46.8914 49.2468 51.3061 44.9841C56.0326 40.4927 58.9805 34.1473 58.9805 27.1163V27.1157ZM19.6805 41.8766C15.7846 37.9806 13.6462 32.8114 13.6462 27.3029C13.6462 21.7944 15.7916 16.6251 19.6805 12.7292C23.5765 8.83323 28.7598 6.69487 34.2542 6.69487C39.7486 6.69487 44.932 8.84026 48.8279 12.7292C52.7238 16.6251 54.8622 21.7944 54.8622 27.3029C54.8622 32.8114 52.7168 37.9806 48.8279 41.8766C44.932 45.7725 39.7627 47.9109 34.2542 47.9109C28.7457 47.9109 23.5694 45.7655 19.6805 41.8766Z"/></svg>`;
  }

  const _iconCache = {};
  function createPinIcon(charger) {
    const key = `${charger.network}_${charger.type}`;
    if (_iconCache[key]) return _iconCache[key];

    let pinClass = 'pin-ather';
    const iconSvg = getBrandLogoSvg(charger.network, 21);
    let label = 'Ather Grid';

    if (charger.network === 'VIDA_GRID') {
      pinClass = 'pin-vida-fast';
      label = 'Vida Grid';
    } else if (charger.network === 'BOLT_EARTH') {
      label = 'Bolt.Earth';
      pinClass = charger.type === 'FAST' ? 'pin-bolt-fast' : 'pin-bolt-slow';
    }

    const html = `
      <div class="custom-pin ${pinClass}">
        <div class="pin-badge">
          <span class="pin-icon">${iconSvg}</span>
        </div>
        <span class="pin-label">${label}</span>
      </div>
    `;

    const icon = L.divIcon({
      className: 'custom-pin-container',
      html,
      iconSize: [64, 50],
      iconAnchor: [32, 39],
      popupAnchor: [0, -36]
    });
    _iconCache[key] = icon;
    return icon;
  }

  function createHighlightedStopPinIcon(wp, idx, customBadgeText = null) {
    let brandColor = '#00E676';
    let brandGlow = 'rgba(0, 230, 118, 0.55)';
    let networkTag = 'Ather Grid';

    if (wp.network === 'VIDA_GRID') {
      brandColor = '#FF5722';
      brandGlow = 'rgba(255, 87, 34, 0.55)';
      networkTag = 'Vida Grid';
    } else if (wp.network === 'BOLT_EARTH') {
      networkTag = 'Bolt.Earth';
      if (wp.type === 'FAST') {
        brandColor = '#FF9100';
        brandGlow = 'rgba(255, 145, 0, 0.55)';
      } else {
        brandColor = '#00B0FF';
        brandGlow = 'rgba(0, 176, 255, 0.55)';
      }
    }

    let cleanName = (wp.name || `Stop ${idx + 1}`)
      .replace(/^(?:Vida Grid Fast|Ather Grid Fast|Bolt\.Earth Fast|Bolt Fast)\s*-\s*/i, '')
      .replace(/\s*\(Ather Gun[^)]*\)/gi, '')
      .trim();

    const badgeLabel = customBadgeText || `STOP ${idx + 1}`;
    const brandIconHtml = (wp.network === 'ATHER_GRID' || wp.network === 'VIDA_GRID' || wp.network === 'BOLT_EARTH')
      ? getBrandLogoSvg(wp.network, 15)
      : '📍';
    const html = `
      <div class="highlight-stop-container" style="--brand-color: ${brandColor}; --brand-glow: ${brandGlow};">
        <div class="beacon-pulse-ring"></div>
        <div class="highlight-stop-pin">
          <div class="stop-badge-icon">${brandIconHtml}</div>
          <span class="stop-badge-text">${esc(badgeLabel)}</span>
        </div>
        <div class="highlight-stop-label">
          <span class="label-net">${networkTag}</span>
          <span class="label-name">${esc(cleanName)}</span>
        </div>
      </div>
    `;

    return L.divIcon({
      className: 'highlight-stop-div-icon',
      html,
      iconSize: [120, 64],
      iconAnchor: [60, 20],
      popupAnchor: [0, -28]
    });
  }

  function createEndpointPinIcon(type = 'START') {
    const isStart = type === 'START';
    const color = isStart ? '#0284c7' : '#10b981';
    const glow = isStart ? 'rgba(2, 132, 199, 0.55)' : 'rgba(16, 185, 129, 0.55)';
    const icon = isStart ? '🚩' : '🏁';
    const tag = isStart ? 'START' : 'DEST';

    const html = `
      <div class="route-endpoint-container" style="--end-color: ${color}; --end-glow: ${glow};">
        <div class="endpoint-pin">
          <span class="endpoint-icon">${icon}</span>
          <span class="endpoint-tag">${tag}</span>
        </div>
      </div>
    `;

    return L.divIcon({
      className: 'route-endpoint-div-icon',
      html,
      iconSize: [84, 38],
      iconAnchor: [42, 19],
      popupAnchor: [0, -24]
    });
  }

  function renderChargers(chargers = null) {
    if (!map || !markersLayer) return;
    if (renderRafId) cancelAnimationFrame(renderRafId);
    renderRafId = requestAnimationFrame(() => {
      _executeFastRender(chargers);
    });
  }

  function _executeFastRender(chargers = null) {
    const isExplicitList = Array.isArray(chargers);
    const sourceList = isExplicitList
      ? chargers
      : (window.SyncEngine ? window.SyncEngine.getChargers() : []);

    const activeRoute = window.RouteEngine ? window.RouteEngine.getActiveRoute() : null;
    const corridorBuffer = window.RouteEngine ? window.RouteEngine.getCorridorBufferKm() : 5;
    const isCorridorActive = Boolean(activeRoute && corridorBuffer !== 'all');
    isCorridorClusterMode = isCorridorActive;

    const activeRouteWaypoints = (activeRoute && activeRoute.waypoints) || [];
    const activeWpIds = new Set(activeRouteWaypoints.map(w => w.id));

    let visibleChargers = [];
    if (isCorridorActive && !isExplicitList) {
      const corridorChargers = (window.RouteEngine && window.RouteEngine.getCorridorChargers()) || [];
      for (let i = 0; i < corridorChargers.length; i++) {
        const c = corridorChargers[i];
        if (c.is_2w === false) continue;
        if (activeWpIds.has(c.id)) continue;
        if (c.network === 'ATHER_GRID' && !filters.atherFast) continue;
        if (c.network === 'VIDA_GRID' && !filters.vidaFast) continue;
        if (c.network === 'BOLT_EARTH' && c.type === 'FAST' && !filters.boltFast) continue;
        if (c.network === 'BOLT_EARTH' && c.type === 'SLOW' && !filters.boltSlow) continue;
        visibleChargers.push(c);
      }
    } else {
      for (let i = 0; i < sourceList.length; i++) {
        const c = sourceList[i];
        if (c.is_2w === false) continue;
        if (activeWpIds.has(c.id)) continue;
        if (activeStateFilter !== 'all' && c.state && c.state !== activeStateFilter) continue;
        if (c.network === 'ATHER_GRID' && !filters.atherFast) continue;
        if (c.network === 'VIDA_GRID' && !filters.vidaFast) continue;
        if (c.network === 'BOLT_EARTH' && c.type === 'FAST' && !filters.boltFast) continue;
        if (c.network === 'BOLT_EARTH' && c.type === 'SLOW' && !filters.boltSlow) continue;
        visibleChargers.push(c);
      }
    }

    const firstId = visibleChargers.length > 0 ? visibleChargers[0].id : '';
    const lastId = visibleChargers.length > 0 ? visibleChargers[visibleChargers.length - 1].id : '';
    const datasetKey = isExplicitList
      ? `explicit_${visibleChargers.length}_${firstId}_${lastId}_${Date.now()}`
      : [
          activeStateFilter,
          filters.atherFast ? 1 : 0,
          filters.vidaFast ? 1 : 0,
          filters.boltFast ? 1 : 0,
          filters.boltSlow ? 1 : 0,
          isCorridorActive ? `corr_${activeRoute.id || 'r'}_${corridorBuffer}` : 'all',
          visibleChargers.length,
          firstId,
          lastId,
          Array.from(activeWpIds).sort().join(',')
        ].join('|');

    if (datasetKey === lastDatasetKey) {
      return;
    }
    lastDatasetKey = datasetKey;

    if (markersLayer) {
      if (typeof markersLayer._processQueue === 'function' && Array.isArray(markersLayer._queue) && markersLayer._queue.length > 0) {
        try { markersLayer._processQueue(); } catch (e) {}
      }
      if (markersLayer._queueTimeout) {
        clearTimeout(markersLayer._queueTimeout);
        markersLayer._queueTimeout = null;
      }
      markersLayer._inZoomAnimation = 0;
      if (map && map._mapPane) {
        map._mapPane.className = map._mapPane.className.replace(/\bleaflet-cluster-anim\b/g, '').trim();
      }
      if (typeof markersLayer.clearLayers === 'function') {
        markersLayer.clearLayers();
      }
    }
    markerMap.clear();

    // Spread co-located overlapping chargers (within ~25m) neatly into a clickable ring without altering true GPS coords
    const displayPosMap = new Map();
    const ungrouped = visibleChargers.slice().sort((a, b) => a.lat - b.lat || a.lng - b.lng);
    const assigned = new Set();
    const spreadDeg = 0.00018;

    for (let i = 0; i < ungrouped.length; i++) {
      const base = ungrouped[i];
      if (assigned.has(base.id)) continue;
      const group = [base];
      assigned.add(base.id);
      for (let j = i + 1; j < ungrouped.length; j++) {
        const cand = ungrouped[j];
        if (cand.lat - base.lat > 0.00024) break;
        if (!assigned.has(cand.id) && Math.abs(cand.lng - base.lng) <= 0.00024) {
          group.push(cand);
          assigned.add(cand.id);
        }
      }
      if (group.length === 1) {
        displayPosMap.set(base.id, [base.lat, base.lng]);
      } else {
        group.sort((x, y) => String(x.id).localeCompare(String(y.id)));
        const cLat = group.reduce((s, g) => s + g.lat, 0) / group.length;
        const cLng = group.reduce((s, g) => s + g.lng, 0) / group.length;
        const ringRadius = spreadDeg * (group.length > 4 ? 1.35 : 1.0);
        group.forEach((item, idx) => {
          const theta = (2 * Math.PI * idx) / group.length;
          displayPosMap.set(item.id, [cLat + ringRadius * Math.sin(theta), cLng + ringRadius * Math.cos(theta)]);
        });
      }
    }

    const batchMarkers = [];
    for (let i = 0; i < visibleChargers.length; i++) {
      const charger = visibleChargers[i];
      const pos = displayPosMap.get(charger.id) || [charger.lat, charger.lng];
      const marker = L.marker(L.latLng(pos[0], pos[1]), { icon: createPinIcon(charger) });
      marker._chargerData = charger;

      marker.bindPopup(() => createChargerPopupHtml(charger), {
        maxWidth: 270,
        className: 'charger-popup',
        autoPan: false
      });

      marker.on('popupopen', () => { activePopupChargerId = charger.id; });
      marker.on('popupclose', () => { if (activePopupChargerId === charger.id) activePopupChargerId = null; });

      markerMap.set(charger.id, marker);
      batchMarkers.push(marker);
    }

    if (typeof markersLayer.addLayers === 'function') {
      markersLayer.addLayers(batchMarkers);
    } else {
      batchMarkers.forEach(m => m.addTo(markersLayer));
    }
  }

  function createChargerPopupHtml(charger, stopIndex = null) {
    const isAther = charger.network === 'ATHER_GRID';
    const isVida = charger.network === 'VIDA_GRID';
    const isFast = charger.type === 'FAST';

    let networkBadgeClass = 'badge-bolt-slow';
    let networkName = 'Bolt.Earth';
    if (isAther) {
      networkBadgeClass = 'badge-ather';
      networkName = 'Ather Grid';
    } else if (isVida) {
      networkBadgeClass = 'badge-vida-fast';
      networkName = 'Vida Grid';
    } else if (isFast) {
      networkBadgeClass = 'badge-bolt-fast';
      networkName = 'Bolt.Earth';
    }

    const waypoints = window.RouteEngine ? window.RouteEngine.getWaypoints() : [];
    const baseId = charger.originalId || charger.id;
    const isInRoute = waypoints.some(w => String(w.originalId || w.id) === String(baseId));

    const activeRoute = window.RouteEngine ? window.RouteEngine.getActiveRoute() : null;
    let routeDistanceHtml = '';
    if (activeRoute && window.RouteEngine.getDistanceToActiveRoute && stopIndex === null) {
      const distFromRoute = window.RouteEngine.getDistanceToActiveRoute(charger.lat, charger.lng);
      if (distFromRoute !== null) {
        const isHighway = distFromRoute <= 0.4;
        const distColor = isHighway ? '#00e676' : '#38bdf8';
        const labelText = isHighway ? 'Direct on Route' : `${distFromRoute} km off route`;
        routeDistanceHtml = `<div style="font-size: 0.72rem; font-weight: 700; color: ${distColor}; margin: 2px 0;">🛣️ ${labelText}</div>`;
      }
    }

    const cleanTitle = esc((charger.name || '2W Charger').replace(/\s*\(Ather Gun[^)]*\)/gi, '').trim());
    const safeAddr = esc(charger.address || '');

    const stopHeaderBadge = stopIndex !== null
      ? `<span class="popup-badge" style="background: #00E676; color: #000; font-weight: 900; padding: 2px 6px; font-size: 0.62rem;">⚡ STOP #${stopIndex + 1}</span>`
      : `<span class="popup-badge ${networkBadgeClass}" style="padding: 2px 6px; font-size: 0.62rem;">${networkName}</span>`;

    const safeIdAttr = esc(charger.id || charger.originalId || '');

    let stopActionButtons = '';
    if (stopIndex !== null) {
      stopActionButtons = `
        <div class="popup-actions">
          <button class="btn-popup-waypoint" style="background: rgba(255, 51, 102, 0.18); border: 1px solid var(--color-danger); color: var(--color-danger);" onclick="MapEngine.handleRemoveWaypoint('${safeIdAttr}', ${stopIndex})">
            ❌ Remove Stop #${stopIndex + 1}
          </button>
          <button class="btn-popup-nav" onclick="MapEngine.handleNavigateToCharger('${safeIdAttr}')">
            🗺️ Open in Google Maps
          </button>
        </div>
      `;
    } else {
      const waypointControlHtml = isInRoute
        ? `<button class="btn-sm btn-remove-stop" style="flex:1; min-height:36px;" onclick="MapEngine.handleRemoveWaypoint('${safeIdAttr}')">❌ Remove Stop</button>`
        : `<button class="btn-sm btn-add-stop" style="flex:1; min-height:36px;" onclick="MapEngine.handleAddWaypoint('${safeIdAttr}')">➕ Add Stop</button>`;

      stopActionButtons = `
        <div class="popup-actions">
          <button class="btn-popup-nav btn-direct-inapp-route" style="min-height: 38px; background: linear-gradient(135deg, #0284c7, #0369a1); border: none; color: #fff;" onclick="MapEngine.handleRouteDirectToCharger('${safeIdAttr}')">
            ⚡ Route Here
          </button>
          <div style="display: flex; gap: 6px;">
            ${waypointControlHtml}
            <button class="btn-sm btn-nav" style="flex: 1; min-height: 36px;" onclick="MapEngine.handleSetAsDest('${safeIdAttr}')">
              🏁 Dest
            </button>
          </div>
          <button class="btn-sm btn-nav" style="width:100%; min-height: 32px; font-size: 0.7rem;" onclick="MapEngine.handleOpenOfficialApp('${esc(charger.network)}', '${safeIdAttr}')">
            📱 Check Live Status in ${networkName} App
          </button>
        </div>
      `;
    }

    const venueHints = (window.Utilities && window.Utilities.renderAmenitiesHtml)
      ? window.Utilities.renderAmenitiesHtml(charger.name, charger.address)
      : '';

    let coLocatedHtml = '';
    if (window.SyncEngine && typeof window.SyncEngine.getChargersInBounds === 'function') {
      const box = {
        south: charger.lat - 0.00045,
        north: charger.lat + 0.00045,
        west: charger.lng - 0.00045,
        east: charger.lng + 0.00045
      };
      const nearby = window.SyncEngine.getChargersInBounds(box).filter(c => {
        if (!c || c.id === charger.id || c.is_2w === false) return false;
        if (Math.abs(c.lat - charger.lat) > 0.00038 || Math.abs(c.lng - charger.lng) > 0.00038) return false;
        return c.type === 'FAST' || c.network === 'ATHER_GRID' || c.network === 'VIDA_GRID' || filters.boltSlow;
      }).slice(0, 4);

      if (nearby.length > 0) {
        const btns = nearby.map(o => {
          const safeJsId = esc(String(o.id).replace(/['"\\]/g, ''));
          const badge = o.network === 'ATHER_GRID' ? '⚡Ather' : (o.network === 'VIDA_GRID' ? '⚡VIDA' : (o.type === 'FAST' ? '⚡Bolt' : '🔌15A'));
          return `<button type="button" class="popup-colocated-btn" onclick="MapEngine.handleFocusChargerById('${safeJsId}')"><span class="popup-colocated-name">${badge} • ${esc((o.name || 'Charger').slice(0, 26))}</span><span class="popup-colocated-go">View ➔</span></button>`;
        }).join('');
        coLocatedHtml = `<div class="popup-colocated-box"><div class="popup-colocated-hdr">📍 ${nearby.length} Other Charger${nearby.length > 1 ? 's' : ''} Right Here:</div>${btns}</div>`;
      }
    }

    return `
      <div class="popup-card">
        <div class="popup-header">
          ${stopHeaderBadge}
        </div>

        <div class="popup-title">${cleanTitle}</div>
        ${routeDistanceHtml}

        ${safeAddr ? `<div class="popup-address">📍 ${safeAddr}</div>` : ''}
        ${venueHints}
        ${coLocatedHtml}
        ${stopActionButtons}
      </div>
    `;
  }

  function handleOpenOfficialApp(network, chargerId) {
    const charger = (chargerId && window.SyncEngine && typeof window.SyncEngine.getChargerById === 'function')
      ? window.SyncEngine.getChargerById(chargerId)
      : null;

    const appConfig = {
      ATHER_GRID: {
        pkg: 'com.athermobileapp',
        appName: 'Ather',
        host: 'www.atherenergy.com/grid',
        scheme: 'https'
      },
      VIDA_GRID: {
        pkg: 'com.hero.vida',
        appName: 'My VIDA',
        host: 'www.vidaworld.com/',
        scheme: 'https'
      },
      BOLT_EARTH: {
        pkg: 'com.revos.bolt.android',
        appName: 'Bolt.Earth',
        host: 'bolt.earth/',
        scheme: 'https'
      }
    };
    const cfg = appConfig[network] || appConfig.BOLT_EARTH;

    // Auto-copy Charger ID (Bolt) or Station Name (Ather/VIDA) so user can paste directly inside the app's search
    let copyText = '';
    if (network === 'BOLT_EARTH' && chargerId) {
      copyText = String(chargerId).trim();
    } else if (charger && charger.name) {
      copyText = String(charger.name)
        .replace(/^(?:Vida Grid Fast|Ather Grid Fast|Bolt\.Earth Fast|Bolt\.Earth 15A|Bolt Fast)\s*-\s*/i, '')
        .replace(/\s*\(Ather Gun[^)]*\)/gi, '')
        .trim();
    }
    if (!copyText && charger && charger.address) {
      copyText = String(charger.address).split(',')[0].trim();
    }

    if (copyText) {
      try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          navigator.clipboard.writeText(copyText).catch(() => {});
        }
      } catch (e) {}
      if (window.SyncEngine && window.SyncEngine.showAutoUpdateToast) {
        window.SyncEngine.showAutoUpdateToast(`📋 Copied "${copyText}" — Opening ${cfg.appName} (Paste in Search)`);
      }
    }

    const playUrl = `https://play.google.com/store/apps/details?id=${cfg.pkg}`;
    const launcher = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.AppLauncher;
    if (launcher && typeof launcher.openUrl === 'function') {
      (async () => {
        try {
          const check = typeof launcher.canOpenUrl === 'function'
            ? await launcher.canOpenUrl({ url: cfg.pkg })
            : { value: true };
          if (check && check.value) {
            await launcher.openUrl({ url: cfg.pkg });
            return;
          }
        } catch (e) {}
        try {
          await launcher.openUrl({ url: `market://details?id=${cfg.pkg}` });
          return;
        } catch (e2) {}
        window.open(playUrl, '_blank', 'noopener,noreferrer');
      })();
      return cfg.pkg;
    }

    const isAndroid = /android/i.test(navigator.userAgent);
    if (isAndroid) {
      window.location.href = `intent://${cfg.host}#Intent;scheme=${cfg.scheme};package=${cfg.pkg};S.browser_fallback_url=${encodeURIComponent(playUrl)};end`;
    } else {
      window.open(playUrl, '_blank', 'noopener,noreferrer');
    }
    return cfg.pkg;
  }

  function handleNavigateToCharger(chargerId) {
    const c = window.SyncEngine ? window.SyncEngine.getChargerById(chargerId) : null;
    if (c && window.NavigationEngine) {
      window.NavigationEngine.navigateToNextCharger(c, userCoords);
    }
  }

  function handleAddWaypoint(chargerId) {
    const c = window.SyncEngine ? window.SyncEngine.getChargerById(chargerId) : null;
    if (c && window.RouteEngine) {
      const added = window.RouteEngine.addWaypoint(c);
      if (map) map.closePopup();
      if (added && window.SyncEngine && window.SyncEngine.showAutoUpdateToast) {
        window.SyncEngine.showAutoUpdateToast(`📍 Added Stop: ${c.name}`);
      }
    }
  }

  function handleRemoveWaypoint(chargerId, stopIndex = null) {
    if (window.RouteEngine) {
      if (chargerId) {
        window.RouteEngine.removeWaypoint(chargerId);
      } else if (typeof stopIndex === 'number') {
        window.RouteEngine.removeWaypoint(stopIndex);
      }
      if (map) map.closePopup();
    }
  }

  function handleSetAsDest(chargerId) {
    const c = window.SyncEngine ? window.SyncEngine.getChargerById(chargerId) : null;
    if (c && window.setPlannerDest) {
      window.setPlannerDest(c);
      if (map) map.closePopup();
    }
  }

  function setFilter(filterKey, value) {
    if (Object.prototype.hasOwnProperty.call(filters, filterKey)) {
      filters[filterKey] = Boolean(value);
      try { localStorage.setItem('voltway_network_filters', JSON.stringify(filters)); } catch (e) {}
      renderChargers();
    }
  }

  function setStateFilter(state) {
    activeStateFilter = state || 'all';
    try {
      localStorage.setItem('voltway_selected_state', activeStateFilter);
      localStorage.setItem('voltway_state_filter', activeStateFilter);
    } catch (e) {}

    // Update dataset synchronously before starting animated flyTo so cluster animations never collide with layer rebuild
    _executeFastRender();

    const activeRoute = window.RouteEngine ? window.RouteEngine.getActiveRoute() : null;
    if (!activeRoute && map) {
      if (activeStateFilter === 'kerala') map.flyTo([10.0246, 76.3079], 10, { animate: true, duration: 0.45 });
      else if (activeStateFilter === 'karnataka') map.flyTo([12.9716, 77.5946], 11, { animate: true, duration: 0.45 });
      else if (activeStateFilter === 'tamil_nadu') map.flyTo([11.0168, 76.9558], 10, { animate: true, duration: 0.45 });
      else if (activeStateFilter === 'all') map.flyTo([11.5, 77.0], 8, { animate: true, duration: 0.45 });
    }
  }

  function createRouteBadgeMarker(route, idx, isSelected, primaryDuration) {
    if (!route.coordinates || route.coordinates.length < 4) return null;
    const midIdx = Math.floor(route.coordinates.length * 0.48);
    const midCoord = route.coordinates[midIdx];

    const diffMins = route.durationMins - primaryDuration;
    const badgeText = `${route.durationMins} min`;
    const badgeSub = isSelected ? (route.isPrimary ? '⚡ Fastest' : 'Active') : (diffMins > 0 ? `+${diffMins}m` : `${route.distanceKm} km`);

    const icon = L.divIcon({
      className: 'route-duration-badge-wrapper',
      html: `
        <div class="map-route-duration-pill ${isSelected ? 'pill-active' : 'pill-alt'}" title="${esc(route.name)}">
          <span class="pill-duration-txt">${badgeText}</span>
          <span class="pill-badge-tag">${badgeSub}</span>
        </div>
      `,
      iconSize: [96, 32],
      iconAnchor: [48, 16]
    });

    const marker = L.marker(midCoord, { icon, zIndexOffset: isSelected ? 2000 : 1200 });
    marker.on('click', (e) => {
      L.DomEvent.stopPropagation(e);
      if (window.RouteEngine) window.RouteEngine.selectRoute(idx);
    });
    return marker;
  }

  function renderRoute(activeRoute, allRoutes = [], selectedIndex = 0, shouldFitBounds = false) {
    if (!map || !routeLayer || !waypointsLayer) return;

    routeLayer.clearLayers();
    waypointsLayer.clearLayers();
    activeMainLine = null;
    activeGlowLine = null;
    traversedMainLine = null;

    if (!activeRoute || !activeRoute.coordinates || activeRoute.coordinates.length < 2) {
      updateBatteryRangeCircle();
      return;
    }

    const routesList = (allRoutes && allRoutes.length > 0) ? allRoutes : [activeRoute];
    const primaryDuration = (routesList[0] && routesList[0].durationMins) || activeRoute.durationMins;

    routesList.forEach((r, idx) => {
      if (idx === selectedIndex) return;
      const altLine = L.polyline(r.coordinates, {
        color: '#64748B',
        weight: 6,
        opacity: 0.75,
        lineCap: 'round',
        lineJoin: 'round',
        className: 'clickable-route-line'
      }).addTo(routeLayer);

      altLine.on('click', () => {
        if (window.RouteEngine) window.RouteEngine.selectRoute(idx);
      });

      if (routesList.length > 1) {
        const altBadge = createRouteBadgeMarker(r, idx, false, primaryDuration);
        if (altBadge) altBadge.addTo(routeLayer);
      }
    });

    activeGlowLine = L.polyline(activeRoute.coordinates, {
      color: '#00E676',
      weight: 10,
      opacity: 0.42,
      lineCap: 'round',
      lineJoin: 'round',
      interactive: false
    }).addTo(routeLayer);

    activeMainLine = L.polyline(activeRoute.coordinates, {
      color: '#00B0FF',
      weight: 6,
      opacity: 0.98,
      lineCap: 'round',
      lineJoin: 'round',
      interactive: false
    }).addTo(routeLayer);

    if (routesList.length > 1) {
      const activeBadge = createRouteBadgeMarker(activeRoute, selectedIndex, true, primaryDuration);
      if (activeBadge) activeBadge.addTo(routeLayer);
    }

    waypointMarkersMap.clear();

    L.marker([activeRoute.origin.lat, activeRoute.origin.lng], {
      icon: createEndpointPinIcon('START'),
      zIndexOffset: 15000
    }).bindPopup(`
      <div class="popup-card">
        <div class="popup-header"><span class="popup-badge badge-ather">🚩 Starting Point</span></div>
        <div class="popup-title">${esc(activeRoute.origin.name || 'Origin')}</div>
      </div>
    `).addTo(waypointsLayer);

    const intermediateStops = activeRoute.waypoints || [];
    intermediateStops.forEach((wp, idx) => {
      const stopMarker = L.marker([wp.lat, wp.lng], {
        icon: createHighlightedStopPinIcon(wp, idx, `STOP ${idx + 1}`),
        zIndexOffset: 20000 + idx
      }).bindPopup(createChargerPopupHtml(wp, idx), { maxWidth: 270, className: 'charger-popup' }).addTo(waypointsLayer);

      waypointMarkersMap.set(wp.id, stopMarker);
    });

    L.marker([activeRoute.destination.lat, activeRoute.destination.lng], {
      icon: createEndpointPinIcon('DEST'),
      zIndexOffset: 15000
    }).bindPopup(`
      <div class="popup-card">
        <div class="popup-header"><span class="popup-badge" style="background: #10b981; color: #052e16;">🏁 Destination</span></div>
        <div class="popup-title">${esc(activeRoute.destination.name || 'Destination')}</div>
      </div>
    `).addTo(waypointsLayer);

    updateBatteryRangeCircle();

    if (userCoords && lastGpsFixTime > 0) {
      updateProgressAlongRoute(userCoords);
    }

    if (shouldFitBounds && activeMainLine) {
      // Mark as programmatic so movestart doesn't trigger isUserInteracting
      isProgrammaticMove = true;
      map.fitBounds(activeMainLine.getBounds(), { padding: [55, 55] });
      setTimeout(() => {
        isProgrammaticMove = false;
        isUserInteracting = false;
      }, 800);
    }
  }

  function updateProgressAlongRoute(coords, maxSnapKm = null) {
    if (!coords || !activeMainLine) return null;
    if (!window.RouteEngine || typeof window.RouteEngine.sliceActiveRouteAtPosition !== 'function') return null;

    const slice = window.RouteEngine.sliceActiveRouteAtPosition(coords.lat, coords.lng);
    if (!slice) return null;

    const snapLimitKm = maxSnapKm != null
      ? maxSnapKm
      : ((window.DriveEngine && window.DriveEngine.isActive()) ? 0.080 : 0.750);

    if (slice.distanceFromRouteKm <= snapLimitKm && slice.remainingCoords && slice.remainingCoords.length >= 2) {
      activeMainLine.setLatLngs(slice.remainingCoords);
      if (activeGlowLine) activeGlowLine.setLatLngs(slice.remainingCoords);

      if (slice.traversedCoords && slice.traversedCoords.length >= 2 && routeLayer) {
        if (!traversedMainLine) {
          traversedMainLine = L.polyline(slice.traversedCoords, {
            color: '#64748b',
            weight: 4,
            opacity: 0.72,
            dashArray: '6, 8',
            lineCap: 'round',
            interactive: false
          }).addTo(routeLayer);
        } else {
          traversedMainLine.setLatLngs(slice.traversedCoords);
        }
      }
    }
    return slice;
  }

  function scheduleBearingAnimation() {
    if (markerAnimRaf) return;
    if (bearingRafId) return;
    bearingRafId = requestAnimationFrame(() => {
      bearingRafId = null;
      if (!map || typeof map.setBearing !== 'function' || isUserRotating) return;

      let bDiff = (targetBearing - currentRenderedBearing + 180) % 360 - 180;
      if (bDiff < -180) bDiff += 360;

      if (Math.abs(bDiff) < 0.2) {
        currentRenderedBearing = targetBearing;
        map.setBearing(currentRenderedBearing);
        updatePuckHeading(userHeading);
        return;
      }

      currentRenderedBearing = (currentRenderedBearing + bDiff * 0.16 + 360) % 360;
      map.setBearing(currentRenderedBearing);
      updatePuckHeading(userHeading);
      scheduleBearingAnimation();
    });
  }

  function initCompass() {
    if (compassHandlerRef) return;

    const onOrientation = (e) => {
      // Ignore relative gyro readings without magnetometer absolute reference unless webkitCompassHeading exists
      if (e.webkitCompassHeading == null && e.absolute === false) {
        return;
      }

      // While riding >= 5 km/h (1.4 m/s), prefer smoothed GPS course direction
      if (userCoords && userCoords.speed != null && userCoords.speed >= 1.4 && userCoords.heading != null) {
        return;
      }

      let heading = null;
      if (e.webkitCompassHeading != null && !isNaN(e.webkitCompassHeading)) {
        heading = e.webkitCompassHeading;
      } else if (e.alpha != null && !isNaN(e.alpha)) {
        const degToRad = Math.PI / 180;
        const a = (e.alpha || 0) * degToRad;
        const b = (e.beta || 0) * degToRad;
        // Damp extreme lateral roll angles on handlebar mounts
        const clampedG = Math.max(-35, Math.min(35, e.gamma || 0)) * degToRad;
        const cA = Math.cos(a), sA = Math.sin(a);
        const cB = Math.cos(b), sB = Math.sin(b);
        const cG = Math.cos(clampedG), sG = Math.sin(clampedG);

        const x2 = -sB * sG;
        const y2 = cB * cB + sB * sB * cG;
        const xE = x2 * cA - y2 * sA;
        const yN = x2 * sA + y2 * cA;

        heading = (Math.atan2(xE, yN) * 180 / Math.PI + 360) % 360;
      }

      const screenAngle = (window.screen && window.screen.orientation && window.screen.orientation.angle) || window.orientation || 0;
      if (heading != null && !isNaN(heading)) {
        heading = (heading + screenAngle + 360) % 360;

        let diff = (heading - userHeading + 180) % 360 - 180;
        if (diff < -180) diff += 360;

        // Deadband against motorcycle idle vibration / magnetic micro-jitter
        if (Math.abs(diff) < 4.0) return;

        const alpha = Math.abs(diff) > 45 ? 0.30 : (Math.abs(diff) > 15 ? 0.20 : 0.12);
        userHeading = (userHeading + diff * alpha + 360) % 360;
        updatePuckHeading(userHeading);
      }
    };

    compassHandlerRef = onOrientation;

    if ('ondeviceorientationabsolute' in window) {
      compassEventType = 'deviceorientationabsolute';
      window.addEventListener('deviceorientationabsolute', compassHandlerRef, { passive: true });
    } else if ('ondeviceorientation' in window) {
      compassEventType = 'deviceorientation';
      window.addEventListener('deviceorientation', compassHandlerRef, { passive: true });
    }

    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      window.addEventListener('click', () => {
        DeviceOrientationEvent.requestPermission().then(state => {
          if (state === 'granted' && compassHandlerRef) {
            window.addEventListener('deviceorientation', compassHandlerRef, { passive: true });
          }
        }).catch(() => {});
      }, { once: true });
    }
  }

  function stopCompass() {
    if (compassHandlerRef && compassEventType) {
      window.removeEventListener(compassEventType, compassHandlerRef);
      compassHandlerRef = null;
      compassEventType = null;
    }
  }

  function updatePuckHeading(heading) {
    if (heading == null) return;
    let rotDeg = 0;
    const mapBearing = (map && typeof map.getBearing === 'function') ? map.getBearing() : 0;

    if (window.DriveEngine && window.DriveEngine.isActive()) {
      if (isNavCompassMode) {
        const roadHeading = (360 - mapBearing + 360) % 360;
        const diff = (heading - roadHeading + 180) % 360 - 180;
        rotDeg = Math.round((diff + 360) % 360);
      } else {
        rotDeg = 0;
      }
    } else {
      rotDeg = Math.round((heading - mapBearing + 360) % 360);
    }

    const navNeedle = document.getElementById('nav-compass-needle');
    if (navNeedle) navNeedle.style.transform = `rotate(${-mapBearing}deg)`;

    if (lastPuckRotDeg !== null && Math.abs((rotDeg - lastPuckRotDeg + 180) % 360 - 180) < 2.5) {
      return;
    }
    lastPuckRotDeg = rotDeg;

    const cone = document.querySelector('.puck-heading-cone');
    const arrow = document.querySelector('.puck-arrow-icon');
    if (cone) cone.style.transform = `rotate(${rotDeg}deg)`;
    if (arrow) arrow.style.transform = `rotate(${rotDeg}deg)`;
  }

  function startUnifiedMotionLoop() {
    if (markerAnimRaf) return;
    if (bearingRafId) {
      cancelAnimationFrame(bearingRafId);
      bearingRafId = null;
    }
    motionLastTickTime = performance.now();

    function tick(now) {
      const dt = Math.min(50, Math.max(4, now - motionLastTickTime));
      motionLastTickTime = now;

      let needsMore = false;
      const tRaw = glideDurationMs > 0 ? Math.min(1, Math.max(0, (now - glideStartTime) / glideDurationMs)) : 1;
      // Continuous velocity-preserving linear progression whenever moving (both in Drive Mode & live map follow); gentle ease-out only when stationary
      const isMovingSmoothly = Boolean(isContinuousMotion || (userCoords && (userCoords.speed || 0) >= 0.8));
      const tPos = isMovingSmoothly ? tRaw : (1 - Math.pow(1 - tRaw, 3));

      if (markerTargetLat != null && markerTargetLng != null && markerStartLat != null && markerStartLng != null) {
        markerCurrentLat = markerStartLat + (markerTargetLat - markerStartLat) * tPos;
        markerCurrentLng = markerStartLng + (markerTargetLng - markerStartLng) * tPos;
        if (userLocationMarker) userLocationMarker.setLatLng([markerCurrentLat, markerCurrentLng]);
        if (userAccuracyCircle) userAccuracyCircle.setLatLng([markerCurrentLat, markerCurrentLng]);
        if (tRaw < 1) needsMore = true;
      }

      if (cameraGlideActive && isAutoFollow && !isUserInteracting && map && !map._animatingZoom && cameraTargetLat != null && cameraTargetLng != null && cameraStartLat != null && cameraStartLng != null) {
        cameraCurrentLat = cameraStartLat + (cameraTargetLat - cameraStartLat) * tPos;
        cameraCurrentLng = cameraStartLng + (cameraTargetLng - cameraStartLng) * tPos;

        const targetPt = map.latLngToContainerPoint([cameraCurrentLat, cameraCurrentLng]);
        const centerPt = map.getSize()._divideBy(2);
        const dx = targetPt.x - centerPt.x;
        const dy = targetPt.y - centerPt.y;
        if (Math.abs(dx) >= 0.35 || Math.abs(dy) >= 0.35) {
          if (typeof map._rawPanBy === 'function') {
            map._rawPanBy(L.point(dx, dy));
            map.fire('move');
            panSinceMoveEndPx += Math.hypot(dx, dy);
            if (panSinceMoveEndPx >= 180 || (now - lastMoveEndSyncTime) >= 1800) {
              panSinceMoveEndPx = 0;
              lastMoveEndSyncTime = now;
              map.fire('moveend');
            }
          } else {
            map.setView([cameraCurrentLat, cameraCurrentLng], map.getZoom(), { animate: false });
          }
        }
        if (tRaw < 1) needsMore = true;
      }

      if (map && typeof map.setBearing === 'function' && !isUserRotating && isAutoFollow) {
        let bDiff = (targetBearing - currentRenderedBearing + 180) % 360 - 180;
        if (bDiff < -180) bDiff += 360;
        if (Math.abs(bDiff) >= 0.2) {
          const bAlpha = 1 - Math.exp(-dt / 190);
          currentRenderedBearing = (currentRenderedBearing + bDiff * bAlpha + 360) % 360;
          map.setBearing(currentRenderedBearing);
          updatePuckHeading(userHeading);
          needsMore = true;
        } else if (currentRenderedBearing !== targetBearing) {
          currentRenderedBearing = targetBearing;
          map.setBearing(currentRenderedBearing);
          updatePuckHeading(userHeading);
        }
      }

      if (needsMore) {
        markerAnimRaf = requestAnimationFrame(tick);
      } else {
        markerAnimRaf = null;
        if (cameraGlideActive && isAutoFollow && !isUserInteracting && map && !map._animatingZoom && panSinceMoveEndPx > 0) {
          panSinceMoveEndPx = 0;
          lastMoveEndSyncTime = now;
          map.fire('moveend');
        }
      }
    }

    markerAnimRaf = requestAnimationFrame(tick);
  }

  function animateMarkerTo(targetLat, targetLng, camLat = null, camLng = null) {
    const now = performance.now();
    const fixGap = prevGpsFixAt > 0 ? (now - prevGpsFixAt) : 1000;
    if (prevGpsFixAt > 0 && fixGap >= 250 && fixGap <= 2600) {
      smoothedGpsCadenceMs = smoothedGpsCadenceMs * 0.65 + fixGap * 0.35;
    }
    prevGpsFixAt = now;

    if (markerCurrentLat == null || markerCurrentLng == null) {
      markerCurrentLat = targetLat;
      markerCurrentLng = targetLng;
      markerStartLat = targetLat;
      markerStartLng = targetLng;
      markerTargetLat = targetLat;
      markerTargetLng = targetLng;
      if (userLocationMarker) userLocationMarker.setLatLng([targetLat, targetLng]);
      if (userAccuracyCircle) userAccuracyCircle.setLatLng([targetLat, targetLng]);
      if (camLat != null && camLng != null && map && isAutoFollow && !isUserInteracting) {
        cameraCurrentLat = camLat;
        cameraCurrentLng = camLng;
        cameraStartLat = camLat;
        cameraStartLng = camLng;
        cameraTargetLat = camLat;
        cameraTargetLng = camLng;
        map.setView([camLat, camLng], map.getZoom(), { animate: false });
      }
      return;
    }

    const dLat = targetLat - markerCurrentLat;
    const dLng = targetLng - markerCurrentLng;
    const hypot = Math.hypot(dLat, dLng);

    if (hypot > 0.005) {
      // Large jump (>550m): snap immediately instead of panning across cities
      isContinuousMotion = false;
      markerCurrentLat = markerStartLat = markerTargetLat = targetLat;
      markerCurrentLng = markerStartLng = markerTargetLng = targetLng;
      if (userLocationMarker) userLocationMarker.setLatLng([targetLat, targetLng]);
      if (userAccuracyCircle) userAccuracyCircle.setLatLng([targetLat, targetLng]);
      if (camLat != null && camLng != null && map && isAutoFollow && !isUserInteracting) {
        cameraCurrentLat = cameraStartLat = cameraTargetLat = camLat;
        cameraCurrentLng = cameraStartLng = cameraTargetLng = camLng;
        cameraGlideActive = false;
        map.setView([camLat, camLng], map.getZoom(), { animate: false });
      }
      return;
    }

    markerStartLat = markerCurrentLat;
    markerStartLng = markerCurrentLng;
    markerTargetLat = targetLat;
    markerTargetLng = targetLng;

    if (camLat != null && camLng != null && isAutoFollow && !isUserInteracting && map) {
      if (cameraCurrentLat == null || cameraCurrentLng == null) {
        const mc = map.getCenter();
        cameraCurrentLat = mc.lat;
        cameraCurrentLng = mc.lng;
      }
      cameraStartLat = cameraCurrentLat;
      cameraStartLng = cameraCurrentLng;
      cameraTargetLat = camLat;
      cameraTargetLng = camLng;
      cameraGlideActive = true;
    } else {
      cameraGlideActive = false;
    }

    isContinuousMotion = Boolean(fixGap <= 2800 && (hypot >= 0.000012 || (userCoords && (userCoords.speed || 0) >= 0.8)));
    glideStartTime = now;
    const cadenceRatio = fixGap >= 250 ? 1.03 : 0.72;
    glideDurationMs = isContinuousMotion
      ? Math.max(680, Math.min(1550, Math.round(smoothedGpsCadenceMs * cadenceRatio)))
      : 720;

    startUnifiedMotionLoop();
  }

  function updateUserPuck(lat, lng, accuracy = 15, heading = 0, cameraTarget = null) {
    if (!map) return;

    let renderLat = lat;
    let renderLng = lng;

    if (window.DriveEngine && window.DriveEngine.isActive() && window.RouteEngine && typeof window.RouteEngine.sliceActiveRouteAtPosition === 'function') {
      const slice = window.RouteEngine.sliceActiveRouteAtPosition(lat, lng);
      if (slice && slice.distanceFromRouteKm <= 0.045 && slice.snappedPoint) {
        renderLat = slice.snappedPoint[0];
        renderLng = slice.snappedPoint[1];
      }
    }

    const rotDeg = Math.round(heading || 0);

    if (!userLocationMarker) {
      const html = `
        <div class="user-nav-puck-wrapper">
          <div class="puck-heading-cone" style="transform: rotate(${rotDeg}deg);"></div>
          <div class="puck-outer-ring">
            <div class="puck-inner-dot">
              <div class="puck-arrow-icon" style="transform: rotate(${rotDeg}deg);">▲</div>
            </div>
          </div>
          <div class="puck-pulse-halo"></div>
        </div>
      `;

      const puckIcon = L.divIcon({
        className: 'user-nav-puck-container',
        html,
        iconSize: [44, 44],
        iconAnchor: [22, 22]
      });

      userLocationMarker = L.marker([renderLat, renderLng], { icon: puckIcon, zIndexOffset: 30000 }).addTo(map);
      markerCurrentLat = markerStartLat = markerTargetLat = renderLat;
      markerCurrentLng = markerStartLng = markerTargetLng = renderLng;
      if (cameraTarget && isAutoFollow && !isUserInteracting) {
        cameraCurrentLat = cameraStartLat = cameraTargetLat = cameraTarget[0];
        cameraCurrentLng = cameraStartLng = cameraTargetLng = cameraTarget[1];
        map.setView([cameraTarget[0], cameraTarget[1]], map.getZoom(), { animate: false });
      }
      updatePuckHeading(heading);
    } else {
      const camLat = cameraTarget ? cameraTarget[0] : null;
      const camLng = cameraTarget ? cameraTarget[1] : null;
      animateMarkerTo(renderLat, renderLng, camLat, camLng);
      updatePuckHeading(heading);
    }

    const safeRadius = Math.max(8, Math.min(accuracy || 20, 150));
    if (!userAccuracyCircle) {
      userAccuracyCircle = L.circle([renderLat, renderLng], {
        radius: safeRadius,
        color: '#38bdf8',
        weight: 1.5,
        fillColor: '#38bdf8',
        fillOpacity: 0.12,
        interactive: false
      }).addTo(map);
    } else {
      userAccuracyCircle.setRadius(safeRadius);
    }

    updateBatteryRangeCircle();
  }

  function updateBatteryRangeCircle() {
    if (batteryRangeCircle && map) {
      map.removeLayer(batteryRangeCircle);
    }
    batteryRangeCircle = null;
  }

  function refreshBatteryVisuals() {
    updateBatteryRangeCircle();
    if (!map) return;

    for (const marker of markerMap.values()) {
      if (marker && marker._chargerData) {
        marker.setPopupContent(createChargerPopupHtml(marker._chargerData, null));
      }
    }

    const activeRoute = window.RouteEngine ? window.RouteEngine.getActiveRoute() : null;
    const wps = (activeRoute && activeRoute.waypoints) || [];
    wps.forEach((wp, idx) => {
      const m = waypointMarkersMap.get(wp.id);
      if (m) {
        m.setPopupContent(createChargerPopupHtml(wp, idx));
      }
    });
  }

  function updateGpsButtonUi() {
    const gpsBtn = document.getElementById('btn-float-gps');
    if (gpsBtn) {
      gpsBtn.classList.toggle('tracking-active', isAutoFollow);
      gpsBtn.title = isAutoFollow ? 'GPS Auto-Follow Active' : 'Center on My GPS Location';
    }
  }

  let lastZoomAdjustTime = 0;
  function updateSpeedAdaptiveZoom(speedMps) {
    if (!map || !window.DriveEngine || !window.DriveEngine.isActive() || !isAutoFollow || isUserInteracting) return;
    const now = Date.now();
    if (now - lastZoomAdjustTime < 2500) return;

    const speedKmh = (speedMps || 0) * 3.6;
    let targetZoom = 17.5;
    if (speedKmh > 65) targetZoom = 15.5;
    else if (speedKmh > 35) targetZoom = 16.5;

    if (Math.abs(map.getZoom() - targetZoom) >= 0.5) {
      lastZoomAdjustTime = now;
      isProgrammaticMove = true;
      map.setZoom(targetZoom, { animate: true });
      setTimeout(() => { isProgrammaticMove = false; }, 300);
    }
  }

  function startLiveTracking(autoCenter = false) {
    initCompass();
    if (autoCenter) {
      isAutoFollow = true;
      isUserInteracting = false;
      updateGpsButtonUi();
    }
    if (watchId !== null || capWatchId !== null) return;

    const onPos = (pos) => {
      lastGpsFixTime = Date.now();
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const accuracy = pos.coords.accuracy || 15;
      const speed = pos.coords.speed;
      const heading = pos.coords.heading;

      // Reject coarse cell-tower jumps (> 120m inaccuracy) while riding if we have recent fix
      if (window.DriveEngine && window.DriveEngine.isActive() && accuracy > 120 && userCoords) {
        return;
      }

      if (speed != null && speed >= 1.4) {
        if (heading != null && !isNaN(heading) && heading >= 0) {
          let gDiff = (heading - userHeading + 180) % 360 - 180;
          if (gDiff < -180) gDiff += 360;
          userHeading = (userHeading + gDiff * 0.22 + 360) % 360;
        } else if (userCoords) {
          const distM = window.Utilities ? window.Utilities.haversine(userCoords.lat, userCoords.lng, lat, lng) * 1000 : 0;
          if (distM >= 5) {
            const dLng = (lng - userCoords.lng) * Math.PI / 180;
            const y = Math.sin(dLng) * Math.cos(lat * Math.PI / 180);
            const x = Math.cos(userCoords.lat * Math.PI / 180) * Math.sin(lat * Math.PI / 180) -
                      Math.sin(userCoords.lat * Math.PI / 180) * Math.cos(lat * Math.PI / 180) * Math.cos(dLng);
            const moveHeading = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
            let mDiff = (moveHeading - userHeading + 180) % 360 - 180;
            if (mDiff < -180) mDiff += 360;
            userHeading = (userHeading + mDiff * 0.22 + 360) % 360;
          }
        }
      }

      userCoords = { lat, lng, accuracy, heading: userHeading, speed };
      try { localStorage.setItem('voltway_last_known_pos', JSON.stringify({ lat, lng })); } catch (e) {}

      let cameraTarget = null;
      if (isAutoFollow && map) {
        if (window.DriveEngine && window.DriveEngine.isActive()) {
          let desiredHeading = userHeading;
          if (window.RouteEngine && typeof window.RouteEngine.sliceActiveRouteAtPosition === 'function') {
            const slice = window.RouteEngine.sliceActiveRouteAtPosition(lat, lng);
            if (slice && slice.segmentBearing != null && slice.distanceFromRouteKm <= 0.050) {
              desiredHeading = slice.segmentBearing;
            }
          }

          if (typeof map.setBearing === 'function' && desiredHeading != null) {
            const nextBearing = (360 - desiredHeading + 360) % 360;
            const bDiff = (nextBearing - targetBearing + 180) % 360 - 180;
            if (Math.abs(bDiff) >= 1.5) {
              targetBearing = nextBearing;
            }
          }

          const lookaheadKm = 0.055;
          const rad = (desiredHeading || 0) * Math.PI / 180;
          const lookLat = lat + (lookaheadKm / 111.32) * Math.cos(rad);
          const lookLng = lng + (lookaheadKm / (111.32 * Math.cos(lat * Math.PI / 180))) * Math.sin(rad);
          cameraTarget = [lookLat, lookLng];
        } else {
          if (typeof map.setBearing === 'function' && map.getBearing() !== 0) {
            targetBearing = 0;
            scheduleBearingAnimation();
          }
          cameraTarget = [lat, lng];
        }
      }

      updateUserPuck(lat, lng, accuracy, userHeading, cameraTarget);

      if (window.DriveEngine && window.DriveEngine.isActive() && isAutoFollow && map) {
        updateSpeedAdaptiveZoom(speed);
      }

      updateGpsButtonUi();

      if (window.DriveEngine && window.DriveEngine.isActive()) {
        window.DriveEngine.onLocationUpdate(userCoords);
      } else if (typeof window.onForegroundGpsUpdate === 'function') {
        window.onForegroundGpsUpdate(userCoords);
      }
    };

    const onErr = (err) => {
      console.warn('[VoltWay GPS] Watch warning:', err.message);
      if (window.DriveEngine && window.DriveEngine.isActive() && window.SyncEngine) {
        window.SyncEngine.showAutoUpdateToast('📡 Weak GPS signal — searching for satellites');
      }
    };

    const isNativeCap = Boolean(
      window.Capacitor &&
      typeof window.Capacitor.isNativePlatform === 'function' &&
      window.Capacitor.isNativePlatform() &&
      window.Capacitor.Plugins &&
      window.Capacitor.Plugins.Geolocation &&
      typeof window.Capacitor.Plugins.Geolocation.watchPosition === 'function'
    );

    if (isNativeCap) {
      try {
        capWatchId = window.Capacitor.Plugins.Geolocation.watchPosition(
          { enableHighAccuracy: true, maximumAge: 0, timeout: 12000 },
          (pos, err) => {
            if (err) onErr(err);
            else if (pos && pos.coords) onPos(pos);
          }
        );
        return;
      } catch (capWatchErr) {
        capWatchId = null;
      }
    }

    if (navigator.geolocation) {
      watchId = navigator.geolocation.watchPosition(onPos, onErr, {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 12000
      });
    }
  }

  function stopLiveTracking() {
    if (capWatchId !== null && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Geolocation && typeof window.Capacitor.Plugins.Geolocation.clearWatch === 'function') {
      try {
        Promise.resolve(capWatchId).then(id => window.Capacitor.Plugins.Geolocation.clearWatch({ id })).catch(() => {});
      } catch (e) {}
      capWatchId = null;
    }
    if (watchId !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
  }

  function setAutoFollow(val) {
    isAutoFollow = Boolean(val);
    updateGpsButtonUi();
    if (isAutoFollow && userCoords && map) {
      map.setView([userCoords.lat, userCoords.lng], 16, { animate: true });
    }
  }

  function recenterCamera(forcedZoom = null) {
    if (recenterTimer) {
      clearTimeout(recenterTimer);
      recenterTimer = null;
    }
    isAutoFollow = true;
    isUserInteracting = false;

    if (!userCoords) {
      try {
        const cached = localStorage.getItem('voltway_last_known_pos');
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed && parsed.lat && parsed.lng) {
            userCoords = { lat: parsed.lat, lng: parsed.lng, accuracy: 25, heading: 0, speed: 0 };
            updateUserPuck(parsed.lat, parsed.lng, 25, 0);
          }
        }
      } catch (e) {}
    }

    if (userCoords && map) {
      if (window.DriveEngine && window.DriveEngine.isActive()) {
        let desiredHeading = userHeading;
        if (window.RouteEngine && typeof window.RouteEngine.sliceActiveRouteAtPosition === 'function') {
          const slice = window.RouteEngine.sliceActiveRouteAtPosition(userCoords.lat, userCoords.lng);
          if (slice && slice.segmentBearing != null && slice.distanceFromRouteKm <= 0.050) {
            desiredHeading = slice.segmentBearing;
          }
        }
        const targetZoom = forcedZoom || (map.getZoom() < 16 ? 17.5 : map.getZoom());
        cameraCurrentLat = cameraStartLat = cameraTargetLat = userCoords.lat;
        cameraCurrentLng = cameraStartLng = cameraTargetLng = userCoords.lng;
        cameraGlideActive = false;
        map.setView([userCoords.lat, userCoords.lng], targetZoom, { animate: false });

        if (typeof map.setBearing === 'function' && desiredHeading != null) {
          targetBearing = (360 - desiredHeading + 360) % 360;
          currentRenderedBearing = targetBearing;
          map.setBearing(targetBearing);
        }
      } else {
        const targetZoom = forcedZoom || Math.max(16, map.getZoom());
        cameraCurrentLat = cameraStartLat = cameraTargetLat = userCoords.lat;
        cameraCurrentLng = cameraStartLng = cameraTargetLng = userCoords.lng;
        cameraGlideActive = false;
        map.setView([userCoords.lat, userCoords.lng], targetZoom, { animate: false });
        if (typeof map.setBearing === 'function') {
          targetBearing = 0;
          currentRenderedBearing = 0;
          map.setBearing(0);
        }
      }
    } else {
      locateUser(true);
    }

    updateGpsButtonUi();

    const gpsBtn = document.getElementById('btn-float-gps');
    if (gpsBtn) {
      gpsBtn.classList.add('recenter-flash');
      setTimeout(() => gpsBtn.classList.remove('recenter-flash'), 450);
    }

    if (window._voltwayResetOverviewMode) window._voltwayResetOverviewMode();
  }

  async function locateUser(panTo = true, forceFresh = false) {
    if (panTo) isAutoFollow = true;
    startLiveTracking(panTo);

    if (userCoords && panTo && !forceFresh && map) {
      recenterCamera();
      return userCoords;
    }

    let coords = null;
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Geolocation) {
      try {
        let permStatus = await window.Capacitor.Plugins.Geolocation.checkPermissions();
        if (permStatus.location !== 'granted') {
          permStatus = await window.Capacitor.Plugins.Geolocation.requestPermissions();
        }
        if (permStatus.location === 'granted') {
          const pos = await window.Capacitor.Plugins.Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 10000 });
          if (pos && pos.coords) coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        }
      } catch (capErr) {}
    }

    if (!coords && navigator.geolocation) {
      coords = await new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
          () => resolve(null),
          { enableHighAccuracy: true, timeout: 10000, maximumAge: forceFresh ? 0 : 5000 }
        );
      });
    }

    if (coords) {
      lastGpsFixTime = Date.now();
      userCoords = { ...coords, heading: userHeading };
      try { localStorage.setItem('voltway_last_known_pos', JSON.stringify({ lat: coords.lat, lng: coords.lng })); } catch (e) {}
      updateUserPuck(coords.lat, coords.lng, 15, userHeading);
      if (panTo && map) recenterCamera();
      if (typeof window.onForegroundGpsUpdate === 'function' && (!window.DriveEngine || !window.DriveEngine.isActive())) {
        window.onForegroundGpsUpdate(userCoords);
      }
      return userCoords;
    } else if (panTo && window.SyncEngine && window.SyncEngine.showAutoUpdateToast) {
      window.SyncEngine.showAutoUpdateToast('⚠️ Enable device Location (GPS) & allow permission');
    }
    return null;
  }

  function handleRouteDirectToCharger(chargerId) {
    const c = window.SyncEngine ? window.SyncEngine.getChargerById(chargerId) : null;
    if (!c) return;
    if (map) map.closePopup();

    if (window.setPlannerDest) window.setPlannerDest(c);

    const curOrigin = (typeof window.getPlannerOrigin === 'function') ? window.getPlannerOrigin() : null;
    if (!curOrigin || !curOrigin.lat) {
      if (userCoords && window.setPlannerOrigin) {
        window.setPlannerOrigin({ lat: userCoords.lat, lng: userCoords.lng, name: 'Current Location (GPS)' });
      } else if (map && window.setPlannerOrigin) {
        const center = map.getCenter();
        window.setPlannerOrigin({ lat: center.lat, lng: center.lng, name: 'Map Center' });
      }
    }

    if (window.activateTabSilently) window.activateTabSilently('route');
    const btnPlan = document.getElementById('btn-plan-route');
    if (btnPlan) setTimeout(() => btnPlan.click(), 200);
  }

  function onMapMoveEnd() {
    clearTimeout(moveDebounceTimer);
    moveDebounceTimer = setTimeout(() => {
      if (isUserRotating) return;
      renderChargers();

      if (map && map.getZoom() >= 13 && navigator.onLine && window.SyncEngine) {
        const now = Date.now();
        const minGap = (window.DriveEngine && window.DriveEngine.isActive()) ? 12000 : 1200;
        if (now - lastBoltLiveScanTime < minGap) return;
        lastBoltLiveScanTime = now;
        const b = map.getBounds();
        window.SyncEngine.fetchLiveBoltInBounds({
          south: Math.round(b.getSouth() * 1000) / 1000,
          west: Math.round(b.getWest() * 1000) / 1000,
          north: Math.round(b.getNorth() * 1000) / 1000,
          east: Math.round(b.getEast() * 1000) / 1000
        });
      }
    }, 320);
  }

  function focusCharger(charger) {
    if (!map || !charger) return;
    const fullCharger = (window.SyncEngine && window.SyncEngine.getChargerById(charger.id)) || charger;
    activePopupChargerId = fullCharger.id;

    let marker = markerMap.get(fullCharger.id) || waypointMarkersMap.get(fullCharger.id);
    if (!marker && !waypointMarkersMap.has(fullCharger.id)) {
      const icon = createPinIcon(fullCharger);
      marker = L.marker(L.latLng(fullCharger.lat, fullCharger.lng), { icon });
      marker._chargerData = fullCharger;
      marker.bindPopup(() => createChargerPopupHtml(fullCharger), {
        maxWidth: 270,
        className: 'charger-popup',
        autoPan: false
      });
      marker.on('popupopen', () => { activePopupChargerId = fullCharger.id; });
      marker.on('popupclose', () => { if (activePopupChargerId === fullCharger.id) activePopupChargerId = null; });
      if (typeof markersLayer.addLayer === 'function') markersLayer.addLayer(marker);
      else marker.addTo(markersLayer);
      markerMap.set(fullCharger.id, marker);
    }

    map.flyTo([fullCharger.lat, fullCharger.lng], 16, { animate: true, duration: 0.4 });
    setTimeout(() => {
      const wpMarker = waypointMarkersMap.get(fullCharger.id);
      if (wpMarker) {
        wpMarker.openPopup();
      } else if (marker) {
        if (typeof markersLayer.zoomToShowLayer === 'function') {
          markersLayer.zoomToShowLayer(marker, () => marker.openPopup());
        } else {
          marker.openPopup();
        }
      }
    }, 460);
  }

  function handleFocusChargerById(chargerId) {
    const c = window.SyncEngine ? window.SyncEngine.getChargerById(chargerId) : null;
    if (!c) return;
    activePopupChargerId = c.id;
    renderChargers();
    setTimeout(() => {
      const wpMarker = waypointMarkersMap.get(c.id);
      const m = markerMap.get(c.id);
      if (wpMarker) {
        wpMarker.openPopup();
      } else if (m) {
        if (typeof markersLayer.zoomToShowLayer === 'function') {
          markersLayer.zoomToShowLayer(m, () => m.openPopup());
        } else {
          m.openPopup();
        }
      } else {
        focusCharger(c);
      }
    }, 60);
  }

  function clearSearchPin() {
    if (searchPinMarker && map) {
      try { map.removeLayer(searchPinMarker); } catch (e) {}
    }
    searchPinMarker = null;
  }

  function clearDroppedPin() {
    if (droppedPinMarker && map) {
      try { map.removeLayer(droppedPinMarker); } catch (e) {}
    }
    droppedPinMarker = null;
  }

  function handleRouteDirectToCoords(lat, lng, name) {
    if (map) map.closePopup();
    clearDroppedPin();
    clearSearchPin();

    const destName = name || `Pin (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
    if (typeof window.setPlannerDest === 'function') {
      window.setPlannerDest({ lat, lng, name: destName });
    }

    const curOrigin = (typeof window.getPlannerOrigin === 'function') ? window.getPlannerOrigin() : null;
    if (!curOrigin || !curOrigin.lat) {
      if (userCoords && window.setPlannerOrigin) {
        window.setPlannerOrigin({ lat: userCoords.lat, lng: userCoords.lng, name: 'Current Location (GPS)' });
      } else if (map && window.setPlannerOrigin) {
        const center = map.getCenter();
        window.setPlannerOrigin({ lat: center.lat, lng: center.lng, name: 'Map Center' });
      }
    }

    if (window.activateTabSilently) window.activateTabSilently('route');
    const btnPlan = document.getElementById('btn-plan-route');
    if (btnPlan) setTimeout(() => btnPlan.click(), 250);
  }

  function showSearchPin(item) {
    if (!map || !item || typeof item.lat !== 'number' || typeof item.lng !== 'number') return;
    clearSearchPin();
    clearDroppedPin();

    const pinIcon = L.divIcon({
      className: 'voltway-search-pin-icon',
      html: '<div style="background: #ef4444; width: 30px; height: 30px; border-radius: 50% 50% 50% 0; transform: rotate(-45deg); display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 14px rgba(239,68,68,0.55); border: 2.5px solid #fff;"><span style="transform: rotate(45deg); font-size: 15px;">📍</span></div>',
      iconSize: [30, 30],
      iconAnchor: [15, 30],
      popupAnchor: [0, -30]
    });

    searchPinMarker = L.marker([item.lat, item.lng], { icon: pinIcon, zIndexOffset: 1200 }).addTo(map);

    searchPinMarker.bindPopup(() => {
      const card = document.createElement('div');
      card.className = 'popup-card';
      const safeName = esc(item.name || 'Location');
      const safeFull = esc(item.fullName || `${item.lat.toFixed(5)}, ${item.lng.toFixed(5)}`);
      card.innerHTML = `
        <div class="popup-header">
          <span class="popup-badge" style="background: #38bdf8; color: #000; font-weight: 800; padding: 2px 6px; font-size: 0.62rem;">📍 SEARCHED LOCATION</span>
        </div>
        <div class="popup-title">${safeName}</div>
        <div class="popup-address">${safeFull}</div>
        <div class="popup-actions" style="margin-top: 8px; display: flex; flex-direction: column; gap: 6px;">
          <button type="button" class="btn-popup-nav btn-direct-inapp-route js-search-pin-route" style="min-height: 38px; background: linear-gradient(135deg, #0284c7, #0369a1); border: none; color: #fff; width: 100%;">
            ⚡ Route Here
          </button>
          <button type="button" class="btn-sm btn-nav js-search-pin-dest" style="min-height: 34px;">
            🏁 Set as Destination
          </button>
        </div>
      `;
      const btnRoute = card.querySelector('.js-search-pin-route');
      if (btnRoute) {
        btnRoute.addEventListener('click', () => {
          handleRouteDirectToCoords(item.lat, item.lng, item.name || 'Location');
        });
      }
      const btnDest = card.querySelector('.js-search-pin-dest');
      if (btnDest) {
        btnDest.addEventListener('click', () => {
          if (typeof window.setPlannerDest === 'function') {
            window.setPlannerDest({ lat: item.lat, lng: item.lng, name: item.name || 'Location' });
          }
          clearSearchPin();
        });
      }
      return card;
    }, { maxWidth: 280, className: 'charger-popup' });

    setTimeout(() => {
      if (searchPinMarker && map && map.hasLayer(searchPinMarker)) {
        searchPinMarker.openPopup();
      }
    }, 280);
  }

  async function showDroppedPinAtCoords(lat, lng) {
    if (!map) return;
    clearDroppedPin();
    clearSearchPin();

    const pinIcon = L.divIcon({
      className: 'voltway-dropped-pin-icon',
      html: '<div style="background: #ef4444; width: 30px; height: 30px; border-radius: 50% 50% 50% 0; transform: rotate(-45deg); display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 14px rgba(239,68,68,0.55); border: 2.5px solid #fff;"><span style="transform: rotate(45deg); font-size: 15px;">📍</span></div>',
      iconSize: [30, 30],
      iconAnchor: [15, 30],
      popupAnchor: [0, -30]
    });

    droppedPinMarker = L.marker([lat, lng], { icon: pinIcon, zIndexOffset: 1200 }).addTo(map);

    let pinName = `Pin (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
    let pinAddress = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;

    const createPopupCard = () => {
      const card = document.createElement('div');
      card.className = 'popup-card';
      card.innerHTML = `
        <div class="popup-header">
          <span class="popup-badge" style="background: #ef4444; color: #fff; font-weight: 800; padding: 2px 6px; font-size: 0.62rem;">📍 DROPPED PIN</span>
        </div>
        <div class="popup-title js-dropped-title">${esc(pinName)}</div>
        <div class="popup-address js-dropped-addr">${esc(pinAddress)}</div>
        <div class="popup-actions" style="margin-top: 8px; display: flex; flex-direction: column; gap: 6px;">
          <button type="button" class="btn-popup-nav btn-direct-inapp-route js-route-to-dropped" style="min-height: 38px; background: linear-gradient(135deg, #0284c7, #0369a1); border: none; color: #fff; width: 100%;">
            ⚡ Route Here
          </button>
          <div style="display: flex; gap: 6px;">
            <button type="button" class="btn-sm btn-nav js-set-dest-dropped" style="flex: 1; min-height: 34px;">
              🏁 Set as Dest
            </button>
            <button type="button" class="btn-sm btn-add-stop js-add-stop-dropped" style="flex: 1; min-height: 34px;">
              ➕ Add Stop
            </button>
          </div>
        </div>
      `;

      card.querySelector('.js-route-to-dropped').addEventListener('click', () => {
        handleRouteDirectToCoords(lat, lng, pinName);
      });
      card.querySelector('.js-set-dest-dropped').addEventListener('click', () => {
        if (typeof window.setPlannerDest === 'function') {
          window.setPlannerDest({ lat, lng, name: pinName });
        }
        if (map) map.closePopup();
      });
      card.querySelector('.js-add-stop-dropped').addEventListener('click', () => {
        if (window.RouteEngine && typeof window.RouteEngine.addWaypoint === 'function') {
          const sid = `pin_${Date.now()}`;
          window.RouteEngine.addWaypoint({ id: sid, originalId: sid, lat, lng, name: pinName });
          if (window.SyncEngine) window.SyncEngine.showAutoUpdateToast(`📍 Added Stop: ${pinName}`);
        }
        if (map) map.closePopup();
      });

      return card;
    };

    droppedPinMarker.bindPopup(createPopupCard, { maxWidth: 280, className: 'charger-popup' });
    setTimeout(() => {
      if (droppedPinMarker && map && map.hasLayer(droppedPinMarker)) {
        droppedPinMarker.openPopup();
      }
    }, 280);

    // Asynchronously reverse geocode to fetch real street / city name
    if (navigator.onLine) {
      try {
        const revUrl = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), 2500);
        const resp = await fetch(revUrl, {
          headers: { 'Accept': 'application/json', 'User-Agent': 'VoltWay2W/5.51' },
          signal: ctrl.signal
        });
        clearTimeout(tid);
        if (resp.ok) {
          const data = await resp.json();
          if (data && data.display_name) {
            const parts = data.display_name.split(',').map(s => s.trim());
            pinName = parts.slice(0, 2).join(', ');
            pinAddress = parts.slice(2, 5).join(', ');
            if (droppedPinMarker && map && map.hasLayer(droppedPinMarker)) {
              const popup = droppedPinMarker.getPopup();
              const el = popup ? popup.getElement() : null;
              if (el) {
                const titleEl = el.querySelector('.js-dropped-title');
                const addrEl = el.querySelector('.js-dropped-addr');
                if (titleEl) titleEl.textContent = pinName;
                if (addrEl) addrEl.textContent = pinAddress;
              }
            }
          }
        }
      } catch (e) {}
    }
  }

  function getLoadedNetworkCounts() {
    const counts = { ATHER_GRID: 0, VIDA_GRID: 0, BOLT_EARTH: 0 };
    if (!markersLayer) return counts;
    const layers = typeof markersLayer.getLayers === 'function' ? markersLayer.getLayers() : [];
    for (let i = 0; i < layers.length; i++) {
      const d = layers[i]._chargerData;
      if (d && counts[d.network] !== undefined) counts[d.network]++;
    }
    return counts;
  }

  return {
    initMap,
    setTileTheme,
    toggleTileTheme,
    renderChargers,
    setFilter,
    getFilters: () => ({ ...filters }),
    setStateFilter,
    getStateFilter: () => activeStateFilter,
    renderRoute,
    updateBatteryRangeCircle,
    refreshBatteryVisuals,
    getBatteryRangeRadiusM: () => (batteryRangeCircle && map && map.hasLayer(batteryRangeCircle) ? Math.round(batteryRangeCircle.getRadius()) : 0),
    updateProgressAlongRoute,
    recenterCamera,
    locateUser,
    startLiveTracking,
    stopLiveTracking,
    setAutoFollow,
    isAutoFollowActive: () => isAutoFollow,
    focusCharger,
    handleFocusChargerById,
    showSearchPin,
    clearSearchPin,
    showDroppedPinAtCoords,
    clearDroppedPin,
    handleRouteDirectToCoords,
    isPopupOpen: () => Boolean(activePopupChargerId),
    getUserCoords: () => userCoords,
    getLastGpsFixAgeMs: () => (lastGpsFixTime ? Date.now() - lastGpsFixTime : Infinity),
    getMap: () => map,
    getLoadedNetworkCounts,
    getBearing: () => (map && typeof map.getBearing === 'function' ? map.getBearing() : 0),
    setBearing: (deg) => {
      if (map && typeof map.setBearing === 'function') {
        targetBearing = deg;
        scheduleBearingAnimation();
      }
    },
    getNavCompassMode: () => isNavCompassMode,
    setNavCompassMode: (active) => {
      isNavCompassMode = Boolean(active);
      updatePuckHeading(userHeading);
    },
    handleNavigateToCharger,
    handleAddWaypoint,
    handleRemoveWaypoint,
    handleSetAsDest,
    handleRouteDirectToCharger,
    handleOpenOfficialApp
  };
})();

window.MapEngine = MapEngine;
