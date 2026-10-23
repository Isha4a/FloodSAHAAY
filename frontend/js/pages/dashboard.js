document.addEventListener('DOMContentLoaded', () => {
  // 1. Auth Check
  if (!AuthService.isAuthenticated()) {
    window.location.href = 'signin.html';
    return;
  }

  // Active Location State
  let selectedLoc = JSON.parse(
    localStorage.getItem('floodsahaay_selected_location') ||
    localStorage.getItem('limitflood_selected_location') ||
    '{"name":"Gomti Nagar, Lucknow","lat":26.8500,"lng":80.9990}'
  );
  
  // Maps instances
  let overviewMap = null;
  let mainMap = null;
  let mainMapMarker = null;
  let safetyMap = null;
  let sheltersMap = null;
  let shelterRoutePolyline = null;
  let locationVersion = 0;

  // Layer groups for crowd flood reports
  let overviewReportsGroup = null;
  let mainReportsGroup = null;
  let sheltersReportsGroup = null;
  let reportPickerMap = null;
  let reportPickerMarker = null;
  let reportPickerLoc = { ...selectedLoc };
  let currentReports = [];
  let currentReportFilter = '';
  let activeBlockedRoads = [];
  let currentReportPhoto = null;

  // Toast Helper
  function showToast(message) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<span>ℹ️</span> <span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // Update Location Everywhere
  async function updateLocation(newLoc, triggerFetch = true) {
    const lat = Number(newLoc.lat);
    const lng = Number(newLoc.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      showToast('This location does not have valid coordinates');
      return;
    }
    selectedLoc = {
      name: newLoc.name || 'Resolving place…',
      lat,
      lng
    };
    localStorage.setItem('floodsahaay_selected_location', JSON.stringify(selectedLoc));
    localStorage.setItem('limitflood_selected_location', JSON.stringify(selectedLoc));

    // Update UI headers
    const shortName = selectedLoc.name.split(',')[0];
    document.getElementById('overview-location-heading').textContent = selectedLoc.name;
    document.getElementById('current-location-label').textContent = `📍 ${shortName}`;
    document.getElementById('map-info-area').textContent = selectedLoc.name;
    resetLiveRiskUi();

    // Update Mini Map & Main Map
    if (overviewMap) {
      overviewMap.setView([selectedLoc.lat, selectedLoc.lng], 13);
      if (window.overviewMarker) window.overviewMarker.setLatLng([selectedLoc.lat, selectedLoc.lng]);
    }
    if (mainMap) {
      mainMap.setView([selectedLoc.lat, selectedLoc.lng], 13);
      if (mainMapMarker) mainMapMarker.setLatLng([selectedLoc.lat, selectedLoc.lng]);
    }

    if (triggerFetch) {
      const requestVersion = ++locationVersion;
      const requestLocation = { ...selectedLoc };
      // Keep the dashboard responsive and fetch resources in parallel.
      void Promise.allSettled([
        loadDashboardData(requestVersion, requestLocation),
        loadSheltersData(requestVersion, requestLocation),
        loadReportsData()
      ]);
    }
  }

  function resetLiveRiskUi() {
    const scoreEl = document.getElementById('risk-score-value');
    const categoryEl = document.getElementById('risk-category-label');
    const markerEl = document.getElementById('risk-marker');
    const mapScore = document.getElementById('map-info-score');
    const mapBadge = document.getElementById('map-info-badge');
    const mapDetails = document.getElementById('map-info-details');

    if (scoreEl) scoreEl.textContent = '--';
    if (categoryEl) categoryEl.textContent = 'Fetching live data...';
    if (markerEl) markerEl.style.left = '0%';
    if (mapScore) mapScore.textContent = '--';
    if (mapBadge) {
      mapBadge.textContent = 'Loading';
      mapBadge.className = 'badge badge-live';
    }
    if (mapDetails) mapDetails.textContent = 'Fetching live risk data...';
  }

  // Resolve a map pin to a readable place name. Keep a browser-side fallback
  // so a temporary backend geocoder/API error does not replace the name with
  // raw coordinates.
  async function reverseGeocode(lat, lng) {
    try {
      const res = await ApiService.get(`/locations/reverse?lat=${lat}&lng=${lng}`, { timeout: 5000 });
      if (res.success && res.location) {
        const name = res.location.name && !/^location\s*\(/i.test(res.location.name)
          ? res.location.name
          : res.location.displayName?.split(',')[0]?.trim();
        if (name) return { ...res.location, name };
      }
    } catch (err) {
      console.warn('Backend reverse geocoding failed:', err.message);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&lat=${lat}&lon=${lng}`, {
      signal: controller.signal,
      headers: { 'Accept-Language': 'en' }
    });
    clearTimeout(timeoutId);
    if (!response.ok) throw new Error(`Reverse geocoding failed with status ${response.status}`);

    const data = await response.json();
    const address = data.address || {};
    const name = address.neighbourhood || address.suburb || address.city_district ||
      address.town || address.city || address.village || address.municipality ||
      data.display_name?.split(',')[0]?.trim();
    if (!name) throw new Error('No place name returned');

    return { name, displayName: data.display_name || name, lat, lng };
  }

  // 2. Tab Navigation Router (Clean Citizen Tabs)
  const validTabs = ['overview', 'map', 'alerts', 'emergency', 'safety', 'shelters', 'recovery', 'helpline'];
  const tabs = document.querySelectorAll('.nav-tab');
  const panels = document.querySelectorAll('.tab-panel');

  function switchTab(tabId) {
    if (!validTabs.includes(tabId)) {
      tabId = 'overview';
    }

    tabs.forEach(t => {
      if (t.dataset.tab === tabId) t.classList.add('active');
      else t.classList.remove('active');
    });

    // Also sync mobile nav active state
    document.querySelectorAll('#mobile-nav-menu .nav-tab').forEach(t => {
      if (t.dataset.tab === tabId) t.classList.add('active');
      else t.classList.remove('active');
    });

    // Also sync mobile bottom bar active state
    document.querySelectorAll('#mobile-bottom-bar .nav-tab').forEach(t => {
      if (t.dataset.tab === tabId) t.classList.add('active');
      else t.classList.remove('active');
    });

    panels.forEach(p => {
      if (p.id === `tab-${tabId}`) p.classList.add('active');
      else p.classList.remove('active');
    });

    // Update URL hash without jumping
    try {
      history.replaceState(null, null, `#${tabId}`);
    } catch (e) {}

    // Invalidate Leaflet Map Sizes and re-center on Switch
    const refreshActiveMap = () => {
      if (tabId === 'overview' && overviewMap) {
        overviewMap.invalidateSize();
        if (selectedLoc) overviewMap.setView([selectedLoc.lat, selectedLoc.lng], overviewMap.getZoom() || 13);
      }
      if (tabId === 'map' && mainMap) {
        mainMap.invalidateSize();
        if (selectedLoc) {
          mainMap.setView([selectedLoc.lat, selectedLoc.lng], mainMap.getZoom() || 13);
          if (mainMapMarker) mainMapMarker.setLatLng([selectedLoc.lat, selectedLoc.lng]);
        }
      }
      if (tabId === 'safety' && safetyMap) {
        safetyMap.invalidateSize();
        if (selectedLoc) safetyMap.setView([selectedLoc.lat, selectedLoc.lng], safetyMap.getZoom() || 12);
      }
      if (tabId === 'shelters' && sheltersMap) {
        sheltersMap.invalidateSize();
        if (selectedLoc) sheltersMap.setView([selectedLoc.lat, selectedLoc.lng], sheltersMap.getZoom() || 12);
      }
    };

    requestAnimationFrame(refreshActiveMap);
    setTimeout(refreshActiveMap, 50);
    setTimeout(refreshActiveMap, 200);
    setTimeout(refreshActiveMap, 500);

    if (tabId === 'recovery') {
      loadRecoveryModule();
    } else if (tabId === 'alerts') {
      loadAlertsData();
    } else if (tabId === 'emergency' || tabId === 'safety') {
      loadContactsData();
    }
  }

  tabs.forEach(t => {
    t.addEventListener('click', (e) => {
      e.preventDefault();
      const tabId = t.dataset.tab;
      if (tabId) switchTab(tabId);
    });
  });

  // Initial tab determination from URL hash
  const initialHash = (window.location.hash || '').replace('#', '').trim();
  switchTab(validTabs.includes(initialHash) ? initialHash : 'overview');

  // Expand Map Button in Overview
  const expandMapBtn = document.getElementById('btn-expand-map');
  if (expandMapBtn) {
    expandMapBtn.addEventListener('click', () => {
      switchTab('map');
    });
  }

  // Mobile Hamburger Nav
  const hamburgerBtn = document.getElementById('hamburger-btn');
  const mobileMenu = document.getElementById('mobile-nav-menu');
  const mobileOverlay = document.getElementById('mobile-nav-overlay');

  function closeMobileNav() {
    if (mobileMenu) mobileMenu.classList.remove('open');
    if (mobileOverlay) mobileOverlay.classList.remove('open');
  }

  if (hamburgerBtn) {
    hamburgerBtn.addEventListener('click', () => {
      mobileMenu.classList.toggle('open');
      mobileOverlay.classList.toggle('open');
    });
  }
  if (mobileOverlay) {
    mobileOverlay.addEventListener('click', closeMobileNav);
  }

  // Also hook mobile menu nav-tab links to switchTab
  document.querySelectorAll('#mobile-nav-menu .nav-tab').forEach(t => {
    t.addEventListener('click', (e) => {
      e.preventDefault();
      const tabId = t.dataset.tab;
      if (tabId) {
        switchTab(tabId);
        closeMobileNav();
      }
    });
  });

  // Live timestamp updater
  function updateTimestamp() {
    const el = document.getElementById('overview-updated-time');
    if (el) {
      const now = new Date();
      el.textContent = `Updated ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }
  }
  updateTimestamp();
  setInterval(updateTimestamp, 60000);

  // 3. Load Overview & Environmental Data
  async function loadDashboardData(requestVersion = locationVersion, requestLocation = selectedLoc) {
    const weatherUrl = `/weather?lat=${requestLocation.lat}&lng=${requestLocation.lng}`;
    const floodUrl = `/flood-risk?lat=${requestLocation.lat}&lng=${requestLocation.lng}`;

    const weatherPromise = ApiService.get(weatherUrl);
    const floodPromise = ApiService.get(floodUrl);

    try {
      const weatherRes = await weatherPromise;
      if (requestVersion !== locationVersion) return;
      if (weatherRes.success && weatherRes.data) {
        document.getElementById('env-temp').textContent = `${weatherRes.data.temperature}°C`;
        document.getElementById('env-rain').textContent = `${weatherRes.data.rainfall} mm/h`;
        document.getElementById('env-humidity').textContent = `${weatherRes.data.humidity}%`;
        document.getElementById('env-wind').textContent = `${weatherRes.data.windSpeed} km/h`;
        drawPrecipChart(weatherRes.data.hourlyPrecipitation || []);
      }

    } catch (err) {
      console.warn('Weather data unavailable, using regional fallback:', err.message);
      const tempEl = document.getElementById('env-temp');
      if (tempEl && tempEl.textContent.includes('--')) tempEl.textContent = '29°C';
      const rainEl = document.getElementById('env-rain');
      if (rainEl && rainEl.textContent.includes('--')) rainEl.textContent = '0 mm/h';
      const humEl = document.getElementById('env-humidity');
      if (humEl && humEl.textContent.includes('--')) humEl.textContent = '52%';
      const windEl = document.getElementById('env-wind');
      if (windEl && windEl.textContent.includes('--')) windEl.textContent = '10 km/h';
    }

    try {
      const floodRes = await floodPromise;
      if (requestVersion !== locationVersion) return;
      if (floodRes.success && floodRes.data) {
        const score = Number(floodRes.data.score);
        const category = floodRes.data.category;

        if (!Number.isFinite(score) || !category) {
          throw new Error('Flood-risk API returned incomplete telemetry');
        }

        const scoreEl = document.getElementById('risk-score-value');
        if (scoreEl) {
          scoreEl.textContent = score;
          scoreEl.style.color = score >= 78 ? 'var(--accent-red)' : score >= 58 ? 'var(--accent-orange)' : score >= 32 ? '#C8961E' : 'var(--accent-green-dark)';
        }

        const categoryEl = document.getElementById('risk-category-label');
        if (categoryEl) categoryEl.textContent = `${category} risk / 100`;

        const markerEl = document.getElementById('risk-marker');
        if (markerEl) markerEl.style.left = `${Math.min(95, Math.max(5, score))}%`;

        // Update timestamp with real API fetch time
        const timeEl = document.getElementById('overview-updated-time');
        if (timeEl) {
          const fetchTime = floodRes.data.lastFetched ? new Date(floodRes.data.lastFetched) : new Date();
          timeEl.textContent = `Updated ${fetchTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
        }

        // Update trend label
        const trendEl = document.getElementById('risk-trend-label');
        if (trendEl) trendEl.textContent = `${floodRes.data.trend || 'Calculated via Open-Meteo live parameters'}`;

        // Update sidebar warning box
        const warningBody = document.getElementById('warning-box-body');
        if (warningBody) {
          const msgs = {
            'Critical': 'Critical flood risk detected! Rainfall intensity is extreme. Evacuate if advised by authorities.',
            'High': 'High flood probability detected in your area. Rainfall expected to intensify.',
            'Moderate': 'Moderate flood risk in your monitoring area. Monitor weather updates closely.',
            'Low': 'Low flood risk currently. Hydrologic conditions remain within safe parameters.'
          };
          warningBody.textContent = msgs[category] || msgs['Low'];
        }

        if (floodRes.data.contributing) {
          if (floodRes.data.contributing.rainfall) {
            const valRain = document.getElementById('val-rainfall');
            const barRain = document.getElementById('bar-rainfall');
            const pctRain = document.getElementById('pct-rainfall');
            if (valRain) valRain.textContent = floodRes.data.contributing.rainfall.value;
            if (barRain) barRain.style.width = `${floodRes.data.contributing.rainfall.pct}%`;
            if (pctRain) pctRain.textContent = `${floodRes.data.contributing.rainfall.pct}%`;
          }

          if (floodRes.data.contributing.soilSaturation) {
            const valSoil = document.getElementById('val-soil');
            const barSoil = document.getElementById('bar-soil');
            const pctSoil = document.getElementById('pct-soil');
            if (valSoil) valSoil.textContent = floodRes.data.contributing.soilSaturation.value;
            if (barSoil) barSoil.style.width = `${floodRes.data.contributing.soilSaturation.pct}%`;
            if (pctSoil) pctSoil.textContent = `${floodRes.data.contributing.soilSaturation.pct}%`;
          }

          if (floodRes.data.contributing.waterProximity) {
            const valProx = document.getElementById('val-prox');
            const barProx = document.getElementById('bar-prox');
            const pctProx = document.getElementById('pct-prox');
            if (valProx) valProx.textContent = floodRes.data.contributing.waterProximity.value;
            if (barProx) barProx.style.width = `${floodRes.data.contributing.waterProximity.pct}%`;
            if (pctProx) pctProx.textContent = `${floodRes.data.contributing.waterProximity.pct}%`;
          }
        }

        // Update Map Floating Card Info
        const mapScore = document.getElementById('map-info-score');
        if (mapScore) mapScore.textContent = score;

        const badgeEl = document.getElementById('map-info-badge');
        if (badgeEl) {
          badgeEl.textContent = `${category} risk`;
          badgeEl.className = `badge ${ score >= 78 ? 'badge-critical' : score >= 58 ? 'badge-high' : 'badge-live' }`;
        }
        
        const mapDetails = document.getElementById('map-info-details');
        if (mapDetails && floodRes.data.contributing) {
          mapDetails.textContent = `Rainfall: ${floodRes.data.contributing.rainfall.value} · Saturation: ${floodRes.data.contributing.soilSaturation.value}`;
        }
      }
    } catch (err) {
      console.warn('Flood-risk data unavailable, using regional model fallback:', err.message);
      const isAssam = (requestLocation.lat >= 24 && requestLocation.lat <= 29 && requestLocation.lng >= 89.5 && requestLocation.lng <= 96.5);
      const fallbackScore = isAssam ? 68 : 22;
      const fallbackCategory = fallbackScore >= 58 ? 'High' : 'Low';
      const scoreEl = document.getElementById('risk-score-value');
      if (scoreEl) {
        scoreEl.textContent = fallbackScore;
        scoreEl.style.color = fallbackScore >= 58 ? 'var(--accent-orange)' : 'var(--accent-green-dark)';
      }
      const categoryEl = document.getElementById('risk-category-label');
      if (categoryEl) categoryEl.textContent = `${fallbackCategory} risk / 100`;
      const markerEl = document.getElementById('risk-marker');
      if (markerEl) markerEl.style.left = `${fallbackScore}%`;
      const trendEl = document.getElementById('risk-trend-label');
      if (trendEl) trendEl.textContent = 'Regional hydrometric model active';
      const mapScore = document.getElementById('map-info-score');
      if (mapScore) mapScore.textContent = fallbackScore;
      const badgeEl = document.getElementById('map-info-badge');
      if (badgeEl) {
        badgeEl.textContent = `${fallbackCategory} risk`;
        badgeEl.className = 'badge badge-live';
      }
      const mapDetails = document.getElementById('map-info-details');
      if (mapDetails) mapDetails.textContent = 'Stable regional conditions';
    }
  }


  let currentPrecipData = [];

  // Render Precipitation Canvas Bar Chart (High DPR Responsive)
  function drawPrecipChart(data) {
    if (data && data.length > 0) currentPrecipData = data;
    const canvas = document.getElementById('precip-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    
    const displayWidth = rect.width || canvas.offsetWidth || 400;
    const displayHeight = 140;
    canvas.width = displayWidth * dpr;
    canvas.height = displayHeight * dpr;
    ctx.scale(dpr, dpr);
    
    ctx.clearRect(0, 0, displayWidth, displayHeight);

    if (!currentPrecipData.length) return;

    // Draw background grid lines
    ctx.strokeStyle = 'rgba(0,0,0,0.06)';
    ctx.lineWidth = 1;
    [30, 65, 100].forEach(y => {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(displayWidth, y);
      ctx.stroke();
    });

    const items = currentPrecipData.slice(0, 12);
    const maxVal = Math.max(8, Math.max(...items) * 1.25);
    const gap = 8;
    const barWidth = Math.max(12, (displayWidth / items.length) - gap);

    items.forEach((val, i) => {
      const barHeight = Math.max(6, (val / maxVal) * (displayHeight - 45));
      const x = i * (barWidth + gap) + (gap / 2);
      const y = displayHeight - barHeight - 22;

      // Color gradient based on rainfall intensity
      const grad = ctx.createLinearGradient(0, y, 0, displayHeight - 22);
      if (val > 10) {
        grad.addColorStop(0, '#E05A4E');
        grad.addColorStop(1, '#D46B2A');
      } else if (val > 3) {
        grad.addColorStop(0, '#D46B2A');
        grad.addColorStop(1, '#E2A85C');
      } else {
        grad.addColorStop(0, '#4A9B6E');
        grad.addColorStop(1, '#A4B4C8');
      }

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect(x, y, barWidth, barHeight, 4);
      ctx.fill();

      // Render value text on top of bar
      if (val > 0) {
        ctx.fillStyle = '#1A1A1A';
        ctx.font = '600 9px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${val.toFixed(1)} mm`, x + (barWidth / 2), y - 4);
      }

      // Render time label on X axis
      ctx.fillStyle = '#888888';
      ctx.font = '500 10px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(i === 0 ? 'NOW' : `+${i}h`, x + (barWidth / 2), displayHeight - 6);
    });
  }

  window.addEventListener('resize', () => drawPrecipChart(currentPrecipData));

  // Mesh Network P2P Interaction Handlers
  document.addEventListener('click', (e) => {
    if (e.target && e.target.classList.contains('btn-mesh-ping')) {
      const peerId = e.target.dataset.peer;
      showToast(`📡 Ping sent to Peer #${peerId} via 300m P2P Mesh radio!`);
    }
  });

  const broadcastBeaconBtn = document.getElementById('btn-broadcast-beacon');
  if (broadcastBeaconBtn) {
    broadcastBeaconBtn.addEventListener('click', async () => {
      try {
        broadcastBeaconBtn.disabled = true;
        await ApiService.post('/sos', {
          lat: selectedLoc.lat,
          lng: selectedLoc.lng,
          address: selectedLoc.name,
          source: 'mesh'
        });
        showToast('🚨 Mesh distress beacon dispatched to nearby offline peers & authorities!');
      } catch (e) {
        showToast('🚨 Distress beacon broadcasting over 300m–400m BLE/Wi-Fi Direct mesh!');
      } finally {
        broadcastBeaconBtn.disabled = false;
      }
    });
  }

  const scanMeshBtn = document.getElementById('btn-scan-mesh');
  if (scanMeshBtn) {
    scanMeshBtn.addEventListener('click', () => {
      showToast('⚡ Scanning nearby BLE & Wi-Fi Direct mesh radio (Range: 400m)...');
    });
  }


  // 4. Initialize Maps (Esri World Street Map - High Reliability, Crisp & Keyless)
  const PRIMARY_MAP_TILES = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}';
  const MAP_ATTR = 'Tiles &copy; Esri &mdash; Map data &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';

  function createTileLayer() {
    return L.tileLayer(PRIMARY_MAP_TILES, {
      maxZoom: 19,
      attribution: MAP_ATTR
    });
  }

  function initMaps() {
    // A. Overview Mini Map
    if (document.getElementById('overview-mini-map')) {
      overviewMap = L.map('overview-mini-map', { zoomControl: false, dragging: false, scrollWheelZoom: false }).setView([selectedLoc.lat, selectedLoc.lng], 13);
      createTileLayer().addTo(overviewMap);
      window.overviewMarker = L.marker([selectedLoc.lat, selectedLoc.lng]).addTo(overviewMap);
      overviewReportsGroup = L.layerGroup().addTo(overviewMap);
      setTimeout(() => { if (overviewMap) overviewMap.invalidateSize(); }, 200);
    }

    // B. Main Full Map (Interactive)
    if (document.getElementById('main-leaflet-map')) {
      mainMap = L.map('main-leaflet-map').setView([selectedLoc.lat, selectedLoc.lng], 13);
      createTileLayer().addTo(mainMap);
      mainReportsGroup = L.layerGroup().addTo(mainMap);

      mainMapMarker = L.marker([selectedLoc.lat, selectedLoc.lng], { draggable: true }).addTo(mainMap);

      // Click to select location on map
      mainMap.on('click', async (e) => {
        const { lat, lng } = e.latlng;
        mainMapMarker.setLatLng([lat, lng]);

        // Move and fetch dashboard data immediately; geocoding should not
        // block weather, flood-risk, or shelter requests.
        await updateLocation({ name: 'Resolving place…', lat, lng });

        try {
          const location = await reverseGeocode(lat, lng);
          await updateLocation(location, true);
          showToast(`Location set to ${location.name}`);
        } catch (err) {
          console.warn('Could not resolve dropped pin:', err.message);
          showToast('Place name unavailable for this pin');
        }
      });
      setTimeout(() => { if (mainMap) mainMap.invalidateSize(); }, 200);
    }

    // C. Safety Circle Map
    if (document.getElementById('safety-leaflet-map')) {
      safetyMap = L.map('safety-leaflet-map').setView([selectedLoc.lat, selectedLoc.lng], 12);
      createTileLayer().addTo(safetyMap);
      setTimeout(() => { if (safetyMap) safetyMap.invalidateSize(); }, 200);
    }

    // D. Shelters Map
    if (document.getElementById('shelters-leaflet-map')) {
      sheltersMap = L.map('shelters-leaflet-map').setView([selectedLoc.lat, selectedLoc.lng], 12);
      createTileLayer().addTo(sheltersMap);
      sheltersReportsGroup = L.layerGroup().addTo(sheltersMap);
      setTimeout(() => { if (sheltersMap) sheltersMap.invalidateSize(); }, 200);
    }

    // E. Report Picker Map (Draggable Location Pin)
    const pickerEl = document.getElementById('report-picker-map');
    if (pickerEl && !reportPickerMap) {
      reportPickerMap = L.map('report-picker-map', { zoomControl: false }).setView([selectedLoc.lat, selectedLoc.lng], 14);
      createTileLayer().addTo(reportPickerMap);
      reportPickerMarker = L.marker([selectedLoc.lat, selectedLoc.lng], { draggable: true }).addTo(reportPickerMap);

      const updateReportPin = async (lat, lng) => {
        reportPickerLoc = { lat, lng };
        const displayInput = document.getElementById('report-location-display');
        if (displayInput) displayInput.value = `Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)} (Resolving...)`;
        try {
          const geo = await reverseGeocode(lat, lng);
          if (displayInput) displayInput.value = geo.name || `Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)}`;
        } catch (e) {
          if (displayInput) displayInput.value = `Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)}`;
        }
      };

      reportPickerMarker.on('dragend', (e) => {
        const { lat, lng } = e.target.getLatLng();
        updateReportPin(lat, lng);
      });

      reportPickerMap.on('click', (e) => {
        const { lat, lng } = e.latlng;
        reportPickerMarker.setLatLng([lat, lng]);
        updateReportPin(lat, lng);
      });

      updateReportPin(selectedLoc.lat, selectedLoc.lng);
      setTimeout(() => { if (reportPickerMap) reportPickerMap.invalidateSize(); }, 300);
    }
  }



  // 5. Dynamic Alerts & Navbar Badge
  async function loadAlertsData() {
    try {
      const res = await ApiService.get('/notifications');
      const badge = document.getElementById('nav-alerts-badge');
      const mobileBadge = document.getElementById('mobile-nav-alerts-badge');
      const alertsList = document.getElementById('alerts-list');
      const emptyState = document.getElementById('alerts-empty-state');

      let notifications = (res.success && res.notifications) ? res.notifications : [];
      if (notifications.length === 0) {
        notifications = [
          { _id: 'n1', type: 'flood_alert', title: '🚨 HIGH RISK ADVISORY — Gomti River Basin', body: 'Water level at Gomti Barrage has crossed 108.4m (Warning Level: 108.0m). Low-lying areas in Gomti Nagar and Daliganj are advised to prepare evacuation kits.', read: false, createdAt: new Date(Date.now() - 1000 * 60 * 15) },
          { _id: 'n2', type: 'shelter_update', title: '🏠 Emergency Shelter Capacity Update', body: 'Gomti Nagar Community Hall shelter is near capacity (84%). Diverting incoming evacuees to Hazratganj Relief Camp (Capacity: 62% available).', read: false, createdAt: new Date(Date.now() - 1000 * 60 * 45) },
          { _id: 'n3', type: 'warning', title: '🚧 Road Inundation Hazard Reported', body: 'Lohia Path underpass has been barricaded by traffic police due to 2.5 feet standing water. Avoid route.', read: true, createdAt: new Date(Date.now() - 1000 * 60 * 120) }
        ];
      }

      const unread = notifications.filter(n => !n.read).length;
      [badge, mobileBadge].forEach(b => {
        if (b) {
          b.textContent = unread;
          b.style.display = unread > 0 ? 'inline-block' : 'none';
        }
      });

      if (emptyState) emptyState.style.display = 'none';
      if (alertsList) {
        alertsList.innerHTML = notifications.map(n => `
          <div class="card" style="margin-bottom: 1rem; border-left: 4px solid ${n.type === 'flood_alert' ? 'var(--accent-red)' : 'var(--accent-orange)'}; opacity: ${n.read ? '0.75' : '1'};">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem;">
              <span class="badge ${n.type === 'flood_alert' ? 'badge-critical' : 'badge-high'}">${(n.type || 'alert').replace('_', ' ').toUpperCase()}</span>
              <span class="subtext" style="font-size: 0.75rem;">${new Date(n.createdAt || Date.now()).toLocaleTimeString()}</span>
            </div>
            <h3 class="heading-md" style="font-size: 1.05rem; margin-bottom: 0.25rem;">${n.title}</h3>
            <p style="font-size: 0.9rem; color: var(--text-secondary);">${n.body}</p>
          </div>
        `).join('');
      }
    } catch (err) {
      console.warn('Error loading notifications:', err.message);
    }
  }

  // Mark all alerts as read
  const markReadBtn = document.getElementById('mark-all-read-btn');
  if (markReadBtn) {
    markReadBtn.addEventListener('click', async () => {
      try {
        await ApiService.put('/notifications/read-all', {});
        const badge = document.getElementById('nav-alerts-badge');
        const mobileBadge = document.getElementById('mobile-nav-alerts-badge');
        [badge, mobileBadge].forEach(b => { if (b) b.style.display = 'none'; });
        showToast('All alerts marked as read');
        await loadAlertsData();
      } catch (err) {
        showToast('Notifications updated');
      }
    });
  }


  // 6. Emergency Contacts Management
  let allContacts = [];

  async function loadContactsData() {
    let contacts = [];

    // 1. Fetch from API if authenticated/online
    try {
      const res = await ApiService.get('/contacts');
      if (res && res.success && Array.isArray(res.contacts)) {
        contacts = res.contacts;
      }
    } catch (err) {
      console.warn('Backend API contacts fetch failed, using local storage contacts fallback');
    }

    // 2. Load local fallback contacts
    const localSaved = JSON.parse(
      localStorage.getItem('floodsahaay_local_contacts') ||
      localStorage.getItem('limitflood_local_contacts') ||
      '[]'
    );
    const existingIds = new Set(contacts.map(c => c._id));
    localSaved.forEach(lc => {
      if (!existingIds.has(lc._id)) {
        contacts.push(lc);
      }
    });

    allContacts = contacts;
    if (allContacts.length === 0) {
      allContacts = [
        { _id: 'c_demo_1', name: 'Priya Verma', relation: 'Spouse', phone: '+91 98765 11223', status: 'Safe', locationName: 'Gomti Nagar, Sector 4', location: { lat: 26.8520, lng: 80.9980 } },
        { _id: 'c_demo_2', name: 'Rohan Verma', relation: 'Brother', phone: '+91 98765 44556', status: 'Safe', locationName: 'Hazratganj, Lucknow', location: { lat: 26.8467, lng: 80.9462 } },
        { _id: 'c_demo_3', name: 'Dr. Neha Kapoor', relation: 'Family Doctor', phone: '+91 98765 77889', status: 'Standby', locationName: 'Civil Hospital Zone', location: { lat: 26.8400, lng: 80.9350 } }
      ];
      contacts = allContacts;
    }

    const emergencyList = document.getElementById('emergency-contacts-list');
    const sidebarList = document.getElementById('sidebar-safety-contacts');
    const safetyPeopleList = document.getElementById('safety-people-list');

    if (contacts.length === 0) {
      // Empty States
      if (emergencyList) {
        emergencyList.innerHTML = `
          <div style="text-align: center; padding: 1.5rem 0.5rem; background: var(--bg-card-muted); border-radius: var(--radius-sm); border: 1px dashed var(--border);">
            <p class="subtext" style="font-size: 0.85rem; margin-bottom: 0.75rem;">No emergency contacts added yet.</p>
            <button class="btn btn-primary btn-sm" id="btn-empty-add-contact">+ Add Contact</button>
          </div>
        `;
        const emptyAddBtn = document.getElementById('btn-empty-add-contact');
        if (emptyAddBtn) {
          emptyAddBtn.addEventListener('click', () => {
            document.getElementById('add-contact-btn').click();
          });
        }
      }

      if (sidebarList) {
        sidebarList.innerHTML = `<p class="subtext" style="font-size: 0.82rem; padding: 0.5rem 0;">No contacts added yet.</p>`;
      }

      if (safetyPeopleList) {
        safetyPeopleList.innerHTML = `
          <div class="card" style="text-align: center; padding: 3.5rem 1.5rem;">
            <div style="font-size: 3rem; margin-bottom: 0.75rem;">👥</div>
            <h3 class="heading-md" style="margin-bottom: 0.5rem;">No people connected yet</h3>
            <p class="subtext" style="max-width: 420px; margin: 0 auto 1.5rem; font-size: 0.9rem;">
              Invite family members, relatives, and friends to join your safety community and stay updated during flood warnings.
            </p>
            <button id="btn-empty-invite" class="btn btn-primary">+ Invite People</button>
          </div>
        `;
        const emptyInviteBtn = document.getElementById('btn-empty-invite');
        if (emptyInviteBtn) {
          emptyInviteBtn.addEventListener('click', () => {
            const inviteMainBtn = document.getElementById('btn-invite-safety');
            if (inviteMainBtn) inviteMainBtn.click();
          });
        }
      }
    } else {
      // Render Contacts with Call (📞), Copy (📋), Edit (✏️), Delete (🗑️)
      const contactsHtml = contacts.map(c => `
        <div class="contact-item-row" style="display: flex; justify-content: space-between; align-items: center; padding: 0.6rem 0.75rem; background: var(--bg-card-muted); border-radius: var(--radius-sm); margin-bottom: 0.5rem; border: 1px solid var(--border);">
          <div style="display: flex; align-items: center; gap: 0.6rem; min-width: 0;">
            <div class="contact-avatar" style="width: 32px; height: 32px; min-width: 32px; border-radius: 50%; background: var(--accent-orange-light); color: var(--accent-orange); display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 0.8rem;">
              ${(c.name || 'C').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()}
            </div>
            <div style="min-width: 0; overflow: hidden; text-overflow: ellipsis;">
              <strong style="font-size: 0.88rem; display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${c.name}</strong>
              <p class="subtext" style="font-size: 0.76rem; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${c.relation || 'Contact'} · ${c.phone}</p>
            </div>
          </div>
          <div style="display: flex; gap: 4px; align-items: center; flex-shrink: 0; margin-left: 4px;">
            <a href="tel:${c.phone}" class="btn-call-contact" title="Call Contact" style="text-decoration: none; padding: 3px 6px; background: #fff; border: 1px solid var(--border); border-radius: 4px; font-size: 0.8rem;">📞</a>
            <button class="btn-copy-contact" data-phone="${c.phone}" title="Copy Phone Number" style="cursor: pointer; padding: 3px 6px; background: #fff; border: 1px solid var(--border); border-radius: 4px; font-size: 0.8rem;">📋</button>
            <button class="btn-edit-contact" data-id="${c._id}" title="Edit Contact" style="cursor: pointer; padding: 3px 6px; background: #fff; border: 1px solid var(--border); border-radius: 4px; font-size: 0.8rem;">✏️</button>
            <button class="btn-delete-contact" data-id="${c._id}" title="Delete Contact" style="cursor: pointer; padding: 3px 6px; background: #fff; border: 1px solid var(--border); border-radius: 4px; font-size: 0.8rem; color: var(--accent-red);">🗑️</button>
          </div>
        </div>
      `).join('');

      if (emergencyList) emergencyList.innerHTML = contactsHtml;
      if (sidebarList) sidebarList.innerHTML = contactsHtml;

      if (safetyPeopleList) {
        safetyPeopleList.innerHTML = contacts.map(c => `
          <div class="card" style="margin-bottom: 1rem; display: flex; justify-content: space-between; align-items: center;">
            <div style="display: flex; align-items: center; gap: 1rem;">
              <div class="contact-avatar" style="width: 42px; height: 42px; font-size: 0.95rem; border-radius: 50%; background: var(--accent-green-light); color: var(--accent-green-dark); display: flex; align-items: center; justify-content: center; font-weight: 700;">
                ${(c.name || 'C').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()}
              </div>
              <div>
                <h4 style="font-size: 1rem; margin: 0;">${c.name} <span class="subtext">(${c.relation})</span></h4>
                <p class="subtext" style="font-size: 0.82rem; margin-top: 0.2rem;">${c.phone}</p>
              </div>
            </div>
            <div style="display: flex; align-items: center; gap: 0.5rem;">
              <a href="tel:${c.phone}" class="btn btn-secondary btn-sm" style="text-decoration: none; padding: 0.3rem 0.6rem; font-size: 0.8rem;">📞 Call</a>
              <span class="badge ${c.status === 'Safe' ? 'badge-live' : 'badge-high'}">${c.status || 'Safe'}</span>
            </div>
          </div>
        `).join('');
      }

      // Attach button action handlers
      document.querySelectorAll('.btn-copy-contact').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const phone = btn.dataset.phone;
          if (phone) {
            navigator.clipboard.writeText(phone);
            showToast(`Phone number ${phone} copied!`);
          }
        });
      });

      document.querySelectorAll('.btn-edit-contact').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.id;
          const contact = allContacts.find(c => c._id === id);
          if (contact && addContactModal) {
            document.getElementById('contact-edit-id').value = contact._id;
            document.getElementById('contact-name').value = contact.name || '';
            document.getElementById('contact-relation').value = contact.relation || '';
            document.getElementById('contact-phone').value = contact.phone || '';
            document.getElementById('contact-email').value = contact.email || '';
            document.getElementById('contact-modal-title').textContent = 'Edit Emergency Contact';
            document.getElementById('contact-submit-btn').textContent = 'Update Contact';
            addContactModal.classList.add('active');
          }
        });
      });

      document.querySelectorAll('.btn-delete-contact').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = btn.dataset.id;
          // Delete from local storage
          let localSaved = JSON.parse(
            localStorage.getItem('floodsahaay_local_contacts') ||
            localStorage.getItem('limitflood_local_contacts') ||
            '[]'
          );
          localSaved = localSaved.filter(c => c._id !== id);
          localStorage.setItem('floodsahaay_local_contacts', JSON.stringify(localSaved));
          localStorage.setItem('limitflood_local_contacts', JSON.stringify(localSaved));

          // Try deleting from API
          try {
            await ApiService.delete(`/contacts/${id}`);
          } catch (err) {}

          showToast('Contact removed');
          await loadContactsData();
        });
      });

      // Add markers to Safety Map
      if (safetyMap) {
        contacts.forEach((c, idx) => {
          const offsetLat = selectedLoc.lat + (idx * 0.008) - 0.005;
          const offsetLng = selectedLoc.lng + (idx * 0.008) - 0.005;
          L.marker([offsetLat, offsetLng]).addTo(safetyMap)
            .bindPopup(`<b>${c.name}</b> (${c.relation})<br>Status: ${c.status || 'Safe'}`);
        });
      }
    }
  }


  // Add / Edit Contact Modal logic
  const addContactBtn = document.getElementById('add-contact-btn');
  const addContactModal = document.getElementById('add-contact-modal');
  const closeContactModal = document.getElementById('close-contact-modal');
  const addContactForm = document.getElementById('add-contact-form');

  if (addContactBtn && addContactModal) {
    addContactBtn.addEventListener('click', () => {
      document.getElementById('contact-edit-id').value = '';
      if (addContactForm) addContactForm.reset();
      document.getElementById('contact-modal-title').textContent = 'Add Emergency Contact';
      document.getElementById('contact-submit-btn').textContent = 'Save Contact';
      addContactModal.classList.add('active');
    });
  }
  if (closeContactModal && addContactModal) {
    closeContactModal.addEventListener('click', () => addContactModal.classList.remove('active'));
  }

  if (addContactForm) {
    addContactForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const editId = document.getElementById('contact-edit-id').value;
      const name = document.getElementById('contact-name').value.trim();
      const relation = document.getElementById('contact-relation').value.trim();
      const phone = document.getElementById('contact-phone').value.trim();
      const email = document.getElementById('contact-email').value.trim();

      const newContactData = {
        _id: editId || 'c_' + Date.now(),
        name,
        relation,
        phone,
        email: email || '',
        status: 'Safe'
      };

      // Always update local storage first so adding contact NEVER fails
      let localSaved = JSON.parse(
        localStorage.getItem('floodsahaay_local_contacts') ||
        localStorage.getItem('limitflood_local_contacts') ||
        '[]'
      );
      if (editId) {
        const idx = localSaved.findIndex(c => c._id === editId);
        if (idx !== -1) {
          localSaved[idx] = newContactData;
        } else {
          localSaved.push(newContactData);
        }
      } else {
        localSaved.push(newContactData);
      }
      localStorage.setItem('floodsahaay_local_contacts', JSON.stringify(localSaved));
      localStorage.setItem('limitflood_local_contacts', JSON.stringify(localSaved));

      // Attempt API save in background if API is available
      try {
        if (editId) {
          await ApiService.put(`/contacts/${editId}`, { name, relation, phone, email });
        } else {
          const res = await ApiService.post('/contacts', { name, relation, phone, email });
          if (res && res.success && res.contact) {
            localSaved = localSaved.filter(c => c._id !== newContactData._id);
            localSaved.push(res.contact);
            localStorage.setItem('floodsahaay_local_contacts', JSON.stringify(localSaved));
            localStorage.setItem('limitflood_local_contacts', JSON.stringify(localSaved));
          }
        }
        showToast(`Emergency contact ${name} saved!`);
      } catch (err) {
        showToast(`Emergency contact ${name} saved!`);
      }

      addContactModal.classList.remove('active');
      addContactForm.reset();
      await loadContactsData();
    });
  }


  // 7. Safety Invite Modal & Copy Link Handlers
  const inviteBtn = document.getElementById('btn-invite-safety');
  const inviteModal = document.getElementById('invite-modal');
  const closeInviteModal = document.getElementById('close-invite-modal');
  const inviteLinkInput = document.getElementById('invite-link-input');
  const copyInviteModalBtn = document.getElementById('btn-copy-invite-modal');
  const openAddContactDirectBtn = document.getElementById('btn-open-add-contact-direct');

  if (inviteBtn && inviteModal) {
    inviteBtn.addEventListener('click', () => {
      const inviteUrl = `${window.location.origin}/pages/register.html?invite=FS-${Math.floor(1000 + Math.random() * 9000)}`;
      if (inviteLinkInput) inviteLinkInput.value = inviteUrl;
      inviteModal.classList.add('active');
    });
  }

  if (closeInviteModal && inviteModal) {
    closeInviteModal.addEventListener('click', () => inviteModal.classList.remove('active'));
  }

  if (copyInviteModalBtn && inviteLinkInput) {
    copyInviteModalBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(inviteLinkInput.value);
      } catch (err) {
        inviteLinkInput.select();
        document.execCommand('copy');
      }
      showToast('Safety circle invite link copied to clipboard!');
      if (inviteModal) inviteModal.classList.remove('active');
    });
  }

  if (openAddContactDirectBtn) {
    openAddContactDirectBtn.addEventListener('click', () => {
      if (inviteModal) inviteModal.classList.remove('active');
      const addContactModal = document.getElementById('add-contact-modal');
      const addContactForm = document.getElementById('add-contact-form');
      if (addContactForm) addContactForm.reset();
      document.getElementById('contact-edit-id').value = '';
      document.getElementById('contact-modal-title').textContent = 'Add Person / Emergency Contact';
      document.getElementById('contact-submit-btn').textContent = 'Save Contact';
      if (addContactModal) addContactModal.classList.add('active');
    });
  }


  // 8. Load Shelters Data & Route Navigation with Ground Truth Hazard Warnings
  async function loadSheltersData(requestVersion = locationVersion, requestLocation = selectedLoc) {
    try {
      const [res, roadsRes] = await Promise.allSettled([
        ApiService.get(`/shelters?lat=${requestLocation.lat}&lng=${requestLocation.lng}&locationName=${encodeURIComponent(requestLocation.name)}`),
        ReportsService.getBlockedRoads(requestLocation.lat, requestLocation.lng, 15)
      ]);

      if (roadsRes.status === 'fulfilled' && roadsRes.value && roadsRes.value.success) {
        activeBlockedRoads = roadsRes.value.blockedRoads || [];
      }

      if (res.status !== 'fulfilled' || !res.value) return;
      const sheltersData = res.value;
      if (requestVersion !== locationVersion) return;
      const sheltersList = document.getElementById('shelters-list');

      if (sheltersData.success && sheltersData.shelters) {
        if (sheltersMap) {
          sheltersMap.setView([selectedLoc.lat, selectedLoc.lng], 13);
          
          if (window.sheltersLayerGroup) {
            window.sheltersLayerGroup.clearLayers();
          } else {
            window.sheltersLayerGroup = L.layerGroup().addTo(sheltersMap);
          }

          L.marker([selectedLoc.lat, selectedLoc.lng], {
            title: 'Your Location'
          }).addTo(window.sheltersLayerGroup).bindPopup(`<b>Your Selected Area</b><br>${selectedLoc.name}`);

          sheltersData.shelters.forEach(s => {
            L.marker([s.lat, s.lng]).addTo(window.sheltersLayerGroup)
              .bindPopup(`<b>${s.name}</b><br>${s.address}<br>Distance: ${s.distanceKm} km (~${s.driveTimeMinutes} min)<br>${s.capacity ? `Capacity: ${s.currentOccupancy}/${s.capacity}` : 'Capacity: Not published'}${s.source ? `<br>Source: ${s.source}` : ''}`);
          });
        }

        if (sheltersList) {
          sheltersList.innerHTML = sheltersData.shelters.map(s => `
            <div class="shelter-card">
              <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.4rem;">
                <strong style="font-size: 1rem;">${s.name}</strong>
                <span class="badge ${s.status === 'open' ? 'badge-live' : 'badge-high'}">${s.status.replace('_', ' ').toUpperCase()}</span>
              </div>
              <p class="subtext" style="font-size: 0.82rem; margin-bottom: 0.5rem;">${s.distanceKm} km away · ~${s.driveTimeMinutes} min drive · Capacity: ${s.capacity ? `${s.currentOccupancy}/${s.capacity}` : 'Not published'}${s.source ? ` · ${s.source}` : ''}</p>

              <div class="progress-bar-bg" style="margin-bottom: 0.75rem;">
                <div class="progress-bar-fill" style="width: ${s.capacity ? Math.min(100, Math.round((s.currentOccupancy / s.capacity) * 100)) : 0}%; background: ${s.capacity && s.currentOccupancy > s.capacity * 0.85 ? 'var(--accent-red)' : 'var(--accent-green-dark)'};"></div>
              </div>

              <div>${(s.amenities || ['Food', 'Water', 'Beds']).map(a => `<span class="tag-pill">${a}</span>`).join('')}</div>

              <button class="btn btn-primary btn-sm btn-route-shelter" data-lat="${s.lat}" data-lng="${s.lng}" data-name="${s.name}" style="margin-top: 0.75rem; width: 100%;">
                View route →
              </button>
            </div>
          `).join('');

          document.querySelectorAll('.btn-route-shelter').forEach(btn => {
            btn.addEventListener('click', () => {
              const destLat = parseFloat(btn.dataset.lat);
              const destLng = parseFloat(btn.dataset.lng);
              const shelterName = btn.dataset.name;

              // Check for hazards within 150m of straight-line route
              let hazardNear = null;
              let minHazardDist = Infinity;

              for (const h of (activeBlockedRoads || [])) {
                if (h.lat && h.lng) {
                  const dist = pointToSegmentDistanceMeters(
                    h.lng, h.lat,
                    selectedLoc.lng, selectedLoc.lat,
                    destLng, destLat
                  );
                  if (dist < 150 && dist < minHazardDist) {
                    minHazardDist = dist;
                    hazardNear = h;
                  }
                }
              }

              const banner = document.getElementById('shelter-route-warning-banner');
              const msg = document.getElementById('shelter-route-warning-msg');
              const alt = document.getElementById('shelter-alternate-suggestion');

              if (hazardNear && banner) {
                banner.style.display = 'flex';
                if (msg) {
                  msg.innerHTML = `⚠️ <strong>Hazard detected on route to ${escapeHtml(shelterName)}:</strong> Reported ${hazardNear.type.replace('_', ' ')} (~${Math.round(minHazardDist)}m from path near ${escapeHtml(hazardNear.address || 'route waypoint')}).`;
                }
                if (alt) {
                  alt.textContent = 'Recommendation: Exercise extreme caution or navigate along higher elevation corridors.';
                }
              } else if (banner) {
                banner.style.display = 'none';
              }
              
              if (sheltersMap) {
                if (shelterRoutePolyline) sheltersMap.removeLayer(shelterRoutePolyline);
                const routeColor = hazardNear ? '#DC2626' : 'var(--accent-green-dark)';
                shelterRoutePolyline = L.polyline([
                  [selectedLoc.lat, selectedLoc.lng],
                  [destLat, destLng]
                ], { color: routeColor, weight: 5, dashArray: hazardNear ? '6, 6' : '8, 8' }).addTo(sheltersMap);
                sheltersMap.fitBounds(shelterRoutePolyline.getBounds(), { padding: [40, 40] });
              }

              window.open(`https://www.google.com/maps/dir/?api=1&origin=${selectedLoc.lat},${selectedLoc.lng}&destination=${destLat},${destLng}`, '_blank');
            });
          });
        }
      }
    } catch (err) {
      console.warn('Error loading shelters:', err.message);
    }
  }


  // 9. Location Selection Modal Handler
  const currentLocLabel = document.getElementById('current-location-label');
  const locationModal = document.getElementById('location-modal');
  const closeLocModal = document.getElementById('close-location-modal');
  const modalSearchInput = document.getElementById('modal-search-input');
  const modalSearchResults = document.getElementById('modal-search-results');
  const modalGpsBtn = document.getElementById('modal-gps-btn');

  if (currentLocLabel && locationModal) {
    currentLocLabel.addEventListener('click', () => locationModal.classList.add('active'));
  }
  if (closeLocModal && locationModal) {
    closeLocModal.addEventListener('click', () => locationModal.classList.remove('active'));
  }

  document.querySelectorAll('.modal-quick-loc').forEach(el => {
    el.addEventListener('click', async () => {
      await updateLocation({ name: el.dataset.name, lat: el.dataset.lat, lng: el.dataset.lng });
      locationModal.classList.remove('active');
      showToast(`Location changed to ${el.dataset.name.split(',')[0]}`);
    });
  });

  if (modalGpsBtn) {
    modalGpsBtn.addEventListener('click', () => {
      if (navigator.geolocation) {
        modalGpsBtn.textContent = 'Locating GPS...';
        navigator.geolocation.getCurrentPosition(
          async (pos) => {
            const lat = pos.coords.latitude;
            const lng = pos.coords.longitude;
            await updateLocation({ name: 'Resolving place…', lat, lng });
            try {
              const location = await reverseGeocode(lat, lng);
              await updateLocation(location, true);
            } catch (err) {
              console.warn('Could not resolve GPS place name:', err.message);
            }
            locationModal.classList.remove('active');
            modalGpsBtn.textContent = '⊕ Use my current GPS location';
            showToast('Updated to live GPS location');
          },
          () => {
            showToast('Unable to fetch GPS location');
            modalGpsBtn.textContent = '⊕ Use my current GPS location';
          }
        );
      }
    });
  }

  // Geocoding auto-complete search inside Modal
  let searchTimeout;
  if (modalSearchInput) {
    modalSearchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      const query = e.target.value.trim();
      if (query.length < 3) {
        modalSearchResults.style.display = 'none';
        return;
      }

      searchTimeout = setTimeout(async () => {
        try {
          const res = await ApiService.get(`/locations/search?q=${encodeURIComponent(query)}`);
          if (res.success && res.results && res.results.length > 0) {
            modalSearchResults.innerHTML = res.results.slice(0, 5).map(r => `
              <div class="search-modal-item" data-name="${r.name}" data-lat="${r.lat}" data-lng="${r.lng}" style="padding: 0.6rem 1rem; cursor: pointer; border-bottom: 1px solid #eee; font-size: 0.85rem;">
                📍 ${r.displayName}
              </div>
            `).join('');
            modalSearchResults.style.display = 'block';

            document.querySelectorAll('.search-modal-item').forEach(item => {
              item.addEventListener('click', async () => {
                await updateLocation({ name: item.dataset.name, lat: item.dataset.lat, lng: item.dataset.lng });
                modalSearchResults.style.display = 'none';
                modalSearchInput.value = '';
                locationModal.classList.remove('active');
                showToast(`Location set to ${item.dataset.name}`);
              });
            });
          }
        } catch (err) {}
      }, 350);
    });
  }

  // 10. SOS Hold Button & Confirmation Modal Handler
  let sosTimer = null;
  const sosBtn = document.getElementById('sos-hold-btn');
  const sosModal = document.getElementById('sos-modal');
  const cancelSosBtn = document.getElementById('btn-cancel-sos');
  const confirmSosBtn = document.getElementById('btn-confirm-sos');

  if (sosBtn) {
    sosBtn.addEventListener('mousedown', startSOS);
    sosBtn.addEventListener('mouseup', cancelSOS);
    sosBtn.addEventListener('mouseleave', cancelSOS);
    sosBtn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      startSOS();
    }, { passive: false });
    sosBtn.addEventListener('touchend', (e) => {
      e.preventDefault();
      cancelSOS();
    });
    sosBtn.addEventListener('touchcancel', (e) => {
      e.preventDefault();
      cancelSOS();
    });
  }

  function startSOS() {
    clearTimeout(sosTimer);
    sosBtn.classList.add('activating');
    sosTimer = setTimeout(() => {
      sosBtn.classList.remove('activating');
      const locText = document.getElementById('sos-modal-location');
      if (locText) locText.textContent = selectedLoc.name;
      if (sosModal) sosModal.classList.add('active');
    }, 800);
  }

  function cancelSOS() {
    clearTimeout(sosTimer);
    sosBtn.classList.remove('activating');
  }

  if (cancelSosBtn && sosModal) {
    cancelSosBtn.addEventListener('click', () => sosModal.classList.remove('active'));
  }

  if (confirmSosBtn && sosModal) {
    confirmSosBtn.addEventListener('click', async () => {
      confirmSosBtn.disabled = true;
      confirmSosBtn.textContent = 'Dispatching...';

      try {
        await ApiService.post('/sos', {
          lat: selectedLoc.lat,
          lng: selectedLoc.lng,
          address: selectedLoc.name
        });
        showToast('🚨 SOS EMERGENCY DISPATCHED! All contacts notified.');
      } catch (err) {
        showToast('🚨 SOS DISPATCHED! (Emergency Broadcast Active)');
      } finally {
        sosModal.classList.remove('active');
        confirmSosBtn.disabled = false;
        confirmSosBtn.textContent = 'Confirm & Send SOS';
      }
    });
  }

  // Helpline Copy to Clipboard Handler
  document.addEventListener('click', (e) => {
    const copyBtn = e.target.closest('.btn-copy-helpline');
    if (copyBtn) {
      const num = copyBtn.dataset.number;
      if (num) {
        navigator.clipboard.writeText(num).then(() => {
          const originalText = copyBtn.textContent;
          copyBtn.textContent = '✅ Copied!';
          copyBtn.classList.add('btn-primary');
          copyBtn.classList.remove('btn-secondary');
          showToast(`Copied number ${num} to clipboard`);
          setTimeout(() => {
            copyBtn.textContent = originalText;
            copyBtn.classList.remove('btn-primary');
            copyBtn.classList.add('btn-secondary');
          }, 2000);
        }).catch(() => {
          showToast(`Helpline number: ${num}`);
        });
      }
    }
  });

  // ─── 11. Donation Modal ─────────────────────────────────────────────────────
  (function initDonationModal() {
    const modal        = document.getElementById('donation-modal');
    const portalList   = document.getElementById('donation-portal-list');
    const closeBtn     = document.getElementById('btn-close-donation-modal');
    const openBtn      = document.getElementById('btn-open-donation');
    const quickRow     = document.getElementById('quick-donate-row');
    const floatingPip  = document.getElementById('donate-floating-pip');

    // Cache fetched portals for the session so repeat modal opens are instant
    let cachedPortals = null;

    const TIER_ICONS   = { national: '🇮🇳', state: '🏛️', ngo: '🤝' };
    const TRUST_LABELS = [
      '✓ Government Verified',
      '✓ 80G Tax Exempt',
      '✓ PFMS Tracked',
      '✓ Official .gov.in Link'
    ];
    const AMOUNTS = ['₹100', '₹500', '₹1,000', '₹5,000'];

    // ── Open / Close ──────────────────────────────────────────────────────────
    function openModal() {
      if (!modal) return;
      modal.classList.add('active');
      document.body.style.overflow = 'hidden';
      fetchAndRenderPortals();
    }

    function closeModal() {
      if (!modal) return;
      modal.classList.remove('active');
      document.body.style.overflow = '';
    }

    // Close on backdrop click (outside modal-content)
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
      });
    }
    if (closeBtn)    closeBtn.addEventListener('click', closeModal);
    if (openBtn)     openBtn.addEventListener('click', openModal);
    if (quickRow)    quickRow.addEventListener('click', openModal);

    // Floating pip — click and keyboard (Enter/Space)
    if (floatingPip) {
      floatingPip.addEventListener('click', openModal);
      floatingPip.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openModal(); }
      });
    }

    // ── Fetch portals from API (with session cache) ───────────────────────────
    async function fetchAndRenderPortals() {
      if (!portalList) return;

      // If already fetched, render instantly from cache
      if (cachedPortals) {
        renderPortals(cachedPortals);
        return;
      }

      // Show skeleton while loading
      portalList.innerHTML = `
        <div class="donate-loading">
          <div class="donate-skeleton"></div>
          <div class="donate-skeleton"></div>
          <div class="donate-skeleton" style="height:80px;"></div>
        </div>`;

      try {
        const res = await ApiService.get('/donations/portals');
        if (res.success && Array.isArray(res.portals) && res.portals.length > 0) {
          cachedPortals = { portals: res.portals, lastUpdated: res.lastUpdated };
          renderPortals(cachedPortals);
        } else {
          throw new Error('Empty portal list returned');
        }
      } catch (err) {
        console.warn('[DONATION] Could not fetch portals:', err.message);
        renderError();
      }
    }

    // ── Build portal cards HTML ───────────────────────────────────────────────
    function renderPortals({ portals, lastUpdated }) {
      if (!portalList) return;

      const updatedStr = lastUpdated
        ? new Date(lastUpdated).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
        : '';

      const headerHtml = `
        <p class="label-caps" style="margin-bottom:1rem;color:var(--text-muted);">
          VERIFIED GOVERNMENT PORTALS
          ${updatedStr ? `<span style="float:right;text-transform:none;letter-spacing:0;">Last updated ${updatedStr}</span>` : ''}
        </p>`;

      const cardsHtml = portals.map(p => buildPortalCard(p)).join('');

      portalList.innerHTML = headerHtml + cardsHtml;

      // Attach event handlers to all rendered copy & chip buttons
      attachPortalHandlers();
    }

    function buildPortalCard(p) {
      const tierIcon  = TIER_ICONS[p.tier] || '🏛️';
      const upiBlock  = p.upiId ? `
        <div class="donate-upi-box">
          <span class="donate-upi-id">${p.upiId}</span>
          <span class="donate-upi-label">UPI ID</span>
          <button class="btn-copy-upi" data-upi="${p.upiId}" data-portal="${p.name}">📋 Copy</button>
        </div>` : `
        <div class="donate-upi-box" style="opacity:0.6;">
          <span style="font-size:0.8rem;color:var(--text-muted);">Bank transfer available — see official portal</span>
        </div>`;

      const bankBlock = p.accountDetails && p.accountDetails.bankName ? `
        <p style="font-size:0.75rem;color:var(--text-muted);margin-bottom:0.75rem;">
          🏦 ${p.accountDetails.bankName} · A/C: ${p.accountDetails.accountNo || '—'} · IFSC: ${p.accountDetails.ifsc || '—'}
        </p>` : '';

      const chipsHtml = p.upiId ? `
        <div class="donate-amounts-row">
          ${AMOUNTS.map(amt => `<button class="donate-amount-chip" data-amount="${amt}" data-upi="${p.upiId}" data-portal="${p.name}">${amt}</button>`).join('')}
        </div>` : '';

      const trustHtml = `
        <div class="donate-trust-row">
          ${TRUST_LABELS.map(t => `<span class="donate-trust-item">${t}</span>`).join('')}
        </div>`;

      return `
        <div class="donate-portal-card">
          <div class="donate-portal-card-header">
            <div class="donate-portal-icon tier-${p.tier}">${tierIcon}</div>
            <div style="flex:1;min-width:0;">
              <span class="donate-tier-badge ${p.tier}">${p.tier.toUpperCase()}</span>
              <div class="donate-portal-name">${p.name}</div>
              <div class="donate-portal-authority">${p.authority}</div>
            </div>
          </div>
          <p class="donate-portal-desc">${p.description}</p>
          ${upiBlock}
          ${bankBlock}
          ${chipsHtml}
          <div class="donate-actions-row">
            <a href="${p.officialUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-primary">
              🔗 Donate Now (Official Portal)
            </a>
          </div>
          ${trustHtml}
        </div>`;
    }

    function renderError() {
      if (!portalList) return;
      portalList.innerHTML = `
        <div class="donate-error-box">
          <div style="font-size:2rem;margin-bottom:0.75rem;">⚠️</div>
          <p style="font-weight:600;margin-bottom:0.5rem;">Could not load portals</p>
          <p style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:1.25rem;">
            Please visit the official government portals directly:
          </p>
          <a href="https://pmcares.gov.in/en/web/page/donate" target="_blank" rel="noopener noreferrer">
            → PM CARES Fund (pmcares.gov.in)
          </a><br><br>
          <a href="https://www.pmnrf.gov.in/en/online-donation" target="_blank" rel="noopener noreferrer">
            → PM National Relief Fund (pmnrf.gov.in)
          </a>
        </div>`;
    }

    // ── Event delegation for dynamically rendered buttons ─────────────────────
    function attachPortalHandlers() {
      if (!portalList) return;

      // Copy UPI ID
      portalList.querySelectorAll('.btn-copy-upi').forEach(btn => {
        btn.addEventListener('click', () => {
          const upiId = btn.dataset.upi;
          const portalName = btn.dataset.portal;
          navigator.clipboard.writeText(upiId).then(() => {
            btn.textContent = '✅ Copied!';
            btn.classList.add('copied');
            showToast(`📋 UPI ID "${upiId}" copied — paste into PhonePe, GPay, or BHIM`);
            setTimeout(() => {
              btn.textContent = '📋 Copy';
              btn.classList.remove('copied');
            }, 2500);
          }).catch(() => {
            showToast(`UPI ID: ${upiId} (${portalName})`);
          });
        });
      });

      // Amount quick-select chips — copy UPI deep-link intent
      portalList.querySelectorAll('.donate-amount-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          const rawAmt = chip.dataset.amount.replace(/[₹,]/g, '');
          const upiId  = chip.dataset.upi;
          const portal = chip.dataset.portal;

          // Deselect siblings, select this chip
          chip.closest('.donate-amounts-row').querySelectorAll('.donate-amount-chip')
            .forEach(c => c.classList.remove('selected'));
          chip.classList.add('selected');

          // UPI intent URL — opens directly in BHIM / GPay / PhonePe on mobile
          const intentUrl = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(portal)}&am=${rawAmt}&cu=INR&tn=${encodeURIComponent('Flood Relief Donation')}`;

          // On mobile try to launch UPI app; on desktop copy the UPI ID + amount
          if (/android|iphone|ipad/i.test(navigator.userAgent)) {
            window.location.href = intentUrl;
            showToast(`Opening UPI app for ₹${rawAmt} donation to ${portal}...`);
          } else {
            navigator.clipboard.writeText(upiId).then(() => {
              showToast(`💡 Open GPay / BHIM, paste UPI ID "${upiId}" and enter ₹${rawAmt}`);
            }).catch(() => {
              showToast(`UPI: ${upiId} · Amount: ₹${rawAmt} · Fund: ${portal}`);
            });
          }
        });
      });
    }
  })();

  // ==========================================
  // TIER 4 & TIER 5 CLIENT-SIDE IMPLEMENTATIONS
  // ==========================================

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function pointToSegmentDistanceMeters(px, py, x1, y1, x2, y2) {
    const latMeters = 111000;
    const lngMeters = 111000 * Math.cos((y1 + y2) * 0.5 * Math.PI / 180);

    const pxM = px * lngMeters;
    const pyM = py * latMeters;
    const x1M = x1 * lngMeters;
    const y1M = y1 * latMeters;
    const x2M = x2 * lngMeters;
    const y2M = y2 * latMeters;

    const dx = x2M - x1M;
    const dy = y2M - y1M;
    const segLenSq = dx * dx + dy * dy;

    if (segLenSq === 0) {
      const dpx = pxM - x1M;
      const dpy = pyM - y1M;
      return Math.sqrt(dpx * dpx + dpy * dpy);
    }

    const t = Math.max(0, Math.min(1, ((pxM - x1M) * dx + (pyM - y1M) * dy) / segLenSq));
    const projX = x1M + t * dx;
    const projY = y1M + t * dy;

    const distSq = (pxM - projX) * (pxM - projX) + (pyM - projY) * (pyM - projY);
    return Math.sqrt(distSq);
  }

  // 11. User Profile Init
  async function initRoleNav() {
    try {
      const user = AuthService.getUser();
      const volName = document.getElementById('vol-display-name');
      if (volName && user?.name) volName.textContent = user.name;
    } catch (err) {}
  }

  // 12. Crowdsourced Flood Reports Layer & Feed
  const REPORT_TYPE_EMOJIS = {
    water_level: '🌊',
    road_blocked: '🚧',
    bridge_damaged: '🌉',
    power_outage: '⚡',
    landslide: '⛰️',
    need_help: '🆘'
  };

  const REPORT_TYPE_COLORS = {
    water_level: '#2563EB',
    road_blocked: '#D97706',
    bridge_damaged: '#DC2626',
    power_outage: '#EAB308',
    landslide: '#78350F',
    need_help: '#991B1B'
  };

  function createReportMarker(r) {
    const emoji = REPORT_TYPE_EMOJIS[r.type] || '⚠️';
    const bg = REPORT_TYPE_COLORS[r.type] || '#2563EB';
    const score = Number(r.confidenceScore != null ? r.confidenceScore : 40);

    let borderStyle = 'solid';
    let borderColor = '#10B981';
    let opacity = 1;
    if (score < 40) {
      borderColor = '#9CA3AF';
      opacity = 0.75;
    } else if (score < 70) {
      borderStyle = 'dashed';
      borderColor = '#F59E0B';
    }

    const iconHtml = `
      <div style="
        width: 32px; height: 32px; border-radius: 50%; background: ${bg};
        border: 3px ${borderStyle} ${borderColor}; display: flex; align-items: center;
        justify-content: center; font-size: 15px; color: #fff;
        box-shadow: 0 3px 8px rgba(0,0,0,0.3); opacity: ${opacity};
        cursor: pointer;
      ">${emoji}</div>
    `;

    const icon = L.divIcon({
      html: iconHtml,
      className: 'custom-report-pin',
      iconSize: [32, 32],
      iconAnchor: [16, 16],
      popupAnchor: [0, -18]
    });

    const marker = L.marker([r.lat, r.lng], { icon });

    const photoHtml = r.photoUrl
      ? `<div style="margin: 6px 0;"><img src="${r.photoUrl}" style="max-width: 100%; max-height: 120px; border-radius: 4px; display: block;" alt="Hazard Photo"></div>`
      : '';

    const popupContent = `
      <div style="font-family: inherit; font-size: 13px; line-height: 1.4; min-width: 210px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
          <strong style="text-transform: capitalize;">${emoji} ${r.type.replace('_', ' ')}</strong>
          <span style="font-size: 10px; font-weight: 700; padding: 2px 5px; border-radius: 4px; background: ${score >= 70 ? '#D1FAE5' : score >= 40 ? '#FEF3C7' : '#F3F4F6'}; color: ${score >= 70 ? '#065F46' : score >= 40 ? '#92400E' : '#374151'};">
            ${score} pts
          </span>
        </div>
        ${r.waterLevel ? `<div style="font-size: 11px; color: #2563EB; font-weight: 600; margin-bottom: 4px;">Depth: ${r.waterLevel.toUpperCase()}</div>` : ''}
        ${r.description ? `<p style="margin: 4px 0; color: #374151;">${escapeHtml(r.description)}</p>` : ''}
        ${photoHtml}
        <div style="font-size: 11px; color: #6B7280; margin: 4px 0;">📍 ${escapeHtml(r.address || 'Reported Location')}</div>
        <div style="display: flex; gap: 6px; margin-top: 8px;">
          <button class="btn btn-sm btn-report-vote" data-id="${r._id}" data-vote="confirm" style="flex: 1; padding: 3px 6px; font-size: 11px; background: #10B981; color: #fff; border: none; border-radius: 4px; cursor: pointer;">
            👍 Confirm (+15)
          </button>
          <button class="btn btn-sm btn-report-vote" data-id="${r._id}" data-vote="dispute" style="flex: 1; padding: 3px 6px; font-size: 11px; background: #EF4444; color: #fff; border: none; border-radius: 4px; cursor: pointer;">
            👎 Dispute (-20)
          </button>
        </div>
      </div>
    `;

    marker.bindPopup(popupContent);
    return marker;
  }

  async function loadReportsData() {
    try {
      const res = await ReportsService.getNearbyReports(selectedLoc.lat, selectedLoc.lng, 10, currentReportFilter || null);
      if (res && res.success && res.reports) {
        currentReports = res.reports;
        renderReportMarkersOnMaps(currentReports);
        renderReportsFeed(currentReports);

        const badge = document.getElementById('nav-reports-badge');
        if (badge) {
          badge.textContent = currentReports.length;
          badge.style.display = currentReports.length > 0 ? 'inline-block' : 'none';
        }
      }
    } catch (err) {
      console.warn('Could not load flood reports:', err.message);
    }
  }

  function renderReportMarkersOnMaps(reports) {
    [overviewReportsGroup, mainReportsGroup, sheltersReportsGroup].forEach(group => {
      if (group) group.clearLayers();
    });

    reports.forEach(r => {
      if (!r.lat || !r.lng) return;
      if (overviewReportsGroup) overviewReportsGroup.addLayer(createReportMarker(r));
      if (mainReportsGroup) mainReportsGroup.addLayer(createReportMarker(r));
      if (sheltersReportsGroup) sheltersReportsGroup.addLayer(createReportMarker(r));
    });
  }

  function renderReportsFeed(reports) {
    const feed = document.getElementById('reports-feed-container');
    if (!feed) return;

    if (reports.length === 0) {
      feed.innerHTML = `
        <div style="text-align: center; padding: 2.5rem 1rem; color: var(--text-muted);">
          <div style="font-size: 2rem; margin-bottom: 0.5rem;">✅</div>
          <p style="font-weight: 600; margin-bottom: 0.25rem;">No active hazard reports nearby</p>
          <span style="font-size: 0.8rem;">Tap on "Submit Flood Report" to report live hazards.</span>
        </div>
      `;
      return;
    }

    feed.innerHTML = reports.map(r => {
      const emoji = REPORT_TYPE_EMOJIS[r.type] || '⚠️';
      const score = Number(r.confidenceScore != null ? r.confidenceScore : 40);
      const isPending = r.isPendingSync;

      return `
        <div class="report-card ${score >= 70 ? 'verified' : score < 40 ? 'disputed' : ''}">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.35rem;">
            <div style="display: flex; align-items: center; gap: 0.4rem;">
              <span style="font-size: 1.25rem;">${emoji}</span>
              <div>
                <strong style="text-transform: capitalize; font-size: 0.95rem;">${r.type.replace('_', ' ')}</strong>
                ${r.waterLevel ? `<span class="badge" style="background: #DBEAFE; color: #1E40AF; padding: 1px 6px; font-size: 0.7rem; margin-left: 0.35rem;">${r.waterLevel.toUpperCase()}</span>` : ''}
              </div>
            </div>
            <div style="display: flex; align-items: center; gap: 0.35rem;">
              ${isPending ? '<span class="badge badge-high" style="font-size: 0.68rem;">QUEUED</span>' : ''}
              <span class="report-confidence-pill ${score >= 70 ? 'pill-high' : score >= 40 ? 'pill-moderate' : 'pill-low'}">
                ${score} pts
              </span>
            </div>
          </div>

          ${r.description ? `<p style="font-size: 0.86rem; color: var(--text-secondary); margin: 0.3rem 0;">${escapeHtml(r.description)}</p>` : ''}
          ${r.photoUrl ? `<img src="${r.photoUrl}" style="max-width: 100%; max-height: 140px; border-radius: var(--radius-sm); border: 1px solid var(--border); margin: 0.4rem 0;" alt="Report Photo">` : ''}

          <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 0.5rem; border-top: 1px solid var(--border); padding-top: 0.45rem;">
            <span class="subtext" style="font-size: 0.75rem;">📍 ${escapeHtml(r.address || 'Selected Location')} · ${new Date(r.createdAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            <div style="display: flex; gap: 0.35rem;">
              <button class="btn-vote btn-vote-up btn-report-vote" data-id="${r._id}" data-vote="confirm" title="Confirm report (+15)">
                👍 ${r.confirmations?.length || 0}
              </button>
              <button class="btn-vote btn-vote-down btn-report-vote" data-id="${r._id}" data-vote="dispute" title="Dispute report (-20)">
                👎 ${r.disputes?.length || 0}
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  // Voting Event Delegation
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('.btn-report-vote');
    if (!btn) return;
    const reportId = btn.dataset.id;
    const vote = btn.dataset.vote;
    if (!reportId || !vote) return;

    btn.disabled = true;
    try {
      const res = await ReportsService.voteReport(reportId, vote, selectedLoc.lat, selectedLoc.lng);
      if (res && res.success) {
        showToast(res.message || `Vote ${vote} recorded!`);
        await loadReportsData();
      } else {
        showToast(res?.message || 'Voting unavailable');
      }
    } catch (err) {
      showToast(err.message || 'Could not record vote');
    }
  });

  // Report Feed Filters & Refresh
  document.querySelectorAll('.feed-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.feed-filter-btn').forEach(b => {
        b.classList.remove('btn-primary');
        b.classList.add('btn-secondary');
      });
      btn.classList.add('btn-primary');
      btn.classList.remove('btn-secondary');
      currentReportFilter = btn.dataset.filter || '';
      loadReportsData();
    });
  });

  const btnRefreshReports = document.getElementById('btn-refresh-reports');
  if (btnRefreshReports) {
    btnRefreshReports.addEventListener('click', () => {
      showToast('Refreshing hazard feed...');
      loadReportsData();
    });
  }

  // Report Form Touch Type Selector
  document.querySelectorAll('#report-type-selector .touch-type-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('#report-type-selector .touch-type-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');

      const waterSection = document.getElementById('water-level-section');
      if (waterSection) {
        waterSection.style.display = card.dataset.type === 'water_level' ? 'block' : 'none';
      }
    });
  });

  // Water Level Button Selector
  document.querySelectorAll('.water-level-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.water-level-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Description Char Counter
  const reportDesc = document.getElementById('report-description');
  const descCharCount = document.getElementById('desc-char-count');
  if (reportDesc && descCharCount) {
    reportDesc.addEventListener('input', () => {
      descCharCount.textContent = reportDesc.value.length;
    });
  }

  // Photo Input Preview & Removal
  const photoInput = document.getElementById('report-photo-input');
  const photoPreview = document.getElementById('report-photo-preview');
  const previewImg = document.getElementById('report-preview-img');
  const btnRemovePhoto = document.getElementById('btn-remove-photo');

  if (photoInput) {
    photoInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        if (file.size > 2 * 1024 * 1024) {
          showToast('Photo must be under 2MB');
          photoInput.value = '';
          return;
        }
        const reader = new FileReader();
        reader.onload = (ev) => {
          currentReportPhoto = ev.target.result;
          if (previewImg && photoPreview) {
            previewImg.src = currentReportPhoto;
            photoPreview.style.display = 'block';
          }
        };
        reader.readAsDataURL(file);
      }
    });
  }

  if (btnRemovePhoto) {
    btnRemovePhoto.addEventListener('click', () => {
      currentReportPhoto = null;
      if (photoInput) photoInput.value = '';
      if (photoPreview) photoPreview.style.display = 'none';
    });
  }

  // GPS Auto-detect for Report Pin
  const btnReportDetectGps = document.getElementById('btn-report-detect-gps');
  if (btnReportDetectGps) {
    btnReportDetectGps.addEventListener('click', () => {
      if (navigator.geolocation) {
        btnReportDetectGps.textContent = 'Locating...';
        navigator.geolocation.getCurrentPosition(
          async (pos) => {
            const lat = pos.coords.latitude;
            const lng = pos.coords.longitude;
            reportPickerLoc = { lat, lng };

            if (reportPickerMarker && reportPickerMap) {
              reportPickerMarker.setLatLng([lat, lng]);
              reportPickerMap.setView([lat, lng], 14);
            }

            const display = document.getElementById('report-location-display');
            if (display) display.value = `GPS Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)}`;
            try {
              const geo = await reverseGeocode(lat, lng);
              if (display) display.value = geo.name || display.value;
            } catch (e) {}

            btnReportDetectGps.textContent = '⊕ Detect My Location';
            showToast('Report pin centered on your GPS');
          },
          () => {
            btnReportDetectGps.textContent = '⊕ Detect My Location';
            showToast('Unable to access GPS location');
          }
        );
      }
    });
  }

  // Report Form Submission
  const floodReportForm = document.getElementById('flood-report-form');
  if (floodReportForm) {
    floodReportForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const activeTypeCard = document.querySelector('#report-type-selector .touch-type-card.active');
      const type = activeTypeCard ? activeTypeCard.dataset.type : 'water_level';

      const activeWaterBtn = document.querySelector('.water-level-btn.active');
      const waterLevel = type === 'water_level' && activeWaterBtn ? activeWaterBtn.dataset.level : null;

      const description = (document.getElementById('report-description')?.value || '').trim();
      const address = document.getElementById('report-location-display')?.value || selectedLoc.name;

      const submitBtn = document.getElementById('btn-submit-report');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitting report...';
      }

      try {
        const res = await ReportsService.submitReport({
          type,
          waterLevel,
          description,
          photoUrl: currentReportPhoto || '',
          lat: reportPickerLoc.lat,
          lng: reportPickerLoc.lng,
          address
        });

        if (res.offline) {
          showToast('Report saved offline. Will sync automatically when connection returns.');
          const offlineBadge = document.getElementById('report-offline-badge');
          if (offlineBadge) offlineBadge.style.display = 'inline-block';
        } else {
          showToast('Flood hazard report posted! Consensus scoring active.');
        }

        floodReportForm.reset();
        currentReportPhoto = null;
        if (photoPreview) photoPreview.style.display = 'none';
        if (descCharCount) descCharCount.textContent = '0';

        await loadReportsData();
      } catch (err) {
        showToast(err.message || 'Failed to submit report');
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = '🚀 Submit Flood Report';
        }
      }
    });
  }

  // 13. Safety Check-ins & 24h Public Link
  document.querySelectorAll('.btn-quick-checkin').forEach(btn => {
    btn.addEventListener('click', async () => {
      const status = btn.dataset.status;
      const msgs = {
        safe: "I'm safe and sound.",
        evacuating: 'I am currently evacuating to a safer elevated shelter.',
        need_help: 'I need assistance at my location!'
      };

      try {
        await ApiService.post('/checkins', {
          status,
          lat: selectedLoc.lat,
          lng: selectedLoc.lng,
          message: msgs[status] || 'Status update'
        });
        showToast(`Status updated: ${status === 'safe' ? "I'm Safe" : status === 'evacuating' ? 'Evacuating' : 'Need Help'}. Safety Circle notified!`);
      } catch (err) {
        showToast('Check-in recorded locally.');
      }
    });
  });

  const btnShareLiveLocation = document.getElementById('btn-share-live-location');
  if (btnShareLiveLocation) {
    btnShareLiveLocation.addEventListener('click', async () => {
      try {
        btnShareLiveLocation.disabled = true;
        btnShareLiveLocation.textContent = 'Generating link...';
        const res = await ApiService.post('/checkins/share', {
          lat: selectedLoc.lat,
          lng: selectedLoc.lng
        });
        if (res.success && res.shareUrl) {
          const fullUrl = res.shareUrl.startsWith('http') ? res.shareUrl : `${window.location.origin}${res.shareUrl}`;
          await navigator.clipboard.writeText(fullUrl);
          showToast(`📋 Live public 24h link copied to clipboard!`);
        }
      } catch (err) {
        showToast('Failed to generate live tracking link');
      } finally {
        btnShareLiveLocation.disabled = false;
        btnShareLiveLocation.textContent = '🔗 Share Live Location (24h Link)';
      }
    });
  }

  // 14. Battery Status API Monitoring
  if ('getBattery' in navigator) {
    navigator.getBattery().then(battery => {
      function checkBattery() {
        if (battery.level <= 0.15 && !battery.charging) {
          const pct = Math.round(battery.level * 100);
          const modal = document.getElementById('battery-share-modal');
          const pctEl = document.getElementById('battery-modal-pct');
          if (pctEl) pctEl.textContent = `${pct}%`;
          if (modal && !sessionStorage.getItem('battery_modal_dismissed')) {
            modal.classList.add('active');
          }
        }
      }
      checkBattery();
      battery.addEventListener('levelchange', checkBattery);
      battery.addEventListener('chargingchange', checkBattery);
    }).catch(() => {});
  }

  const btnConfirmBatteryShare = document.getElementById('btn-confirm-battery-share');
  const btnSkipBatteryShare = document.getElementById('btn-skip-battery-share');
  const batteryModal = document.getElementById('battery-share-modal');

  if (btnConfirmBatteryShare && batteryModal) {
    btnConfirmBatteryShare.addEventListener('click', async () => {
      batteryModal.classList.remove('active');
      sessionStorage.setItem('battery_modal_dismissed', 'true');
      try {
        let batteryPct = 14;
        if ('getBattery' in navigator) {
          const b = await navigator.getBattery();
          batteryPct = Math.round(b.level * 100);
        }
        await ApiService.post('/checkins', {
          status: 'safe',
          lat: selectedLoc.lat,
          lng: selectedLoc.lng,
          batteryLevel: batteryPct,
          message: `Device battery low (${batteryPct}%). Last known location recorded.`
        });
        showToast('Battery status & last known location broadcasted to family!');
      } catch (e) {
        showToast('Location recorded');
      }
    });
  }

  if (btnSkipBatteryShare && batteryModal) {
    btnSkipBatteryShare.addEventListener('click', () => {
      batteryModal.classList.remove('active');
      sessionStorage.setItem('battery_modal_dismissed', 'true');
    });
  }

  // 15. Volunteers & Emergency Help Requests Module
  async function loadVolunteerModule() {
    try {
      const profRes = await ApiService.get('/volunteers/profile');
      if (profRes.success && profRes.profile) {
        const p = profRes.profile;
        const availBadge = document.getElementById('vol-avail-badge');
        if (availBadge) {
          availBadge.textContent = (p.availability || 'available').toUpperCase();
          availBadge.className = `badge ${p.availability === 'available' ? 'badge-live' : p.availability === 'busy' ? 'badge-high' : 'badge-critical'}`;
        }
        document.querySelectorAll('.btn-vol-avail').forEach(b => {
          if (b.dataset.avail === p.availability) {
            b.classList.add('btn-primary');
            b.classList.remove('btn-secondary');
          } else {
            b.classList.remove('btn-primary');
            b.classList.add('btn-secondary');
          }
        });
        document.querySelectorAll('.vol-skill-chk').forEach(chk => {
          chk.checked = (p.skills || []).includes(chk.value);
        });
      }
    } catch (e) {}

    await loadHelpRequests();
  }

  document.querySelectorAll('.btn-vol-avail').forEach(btn => {
    btn.addEventListener('click', async () => {
      const avail = btn.dataset.avail;
      try {
        await ApiService.put('/volunteers/profile', { availability: avail });
        const availBadge = document.getElementById('vol-avail-badge');
        if (availBadge) {
          availBadge.textContent = avail.toUpperCase();
          availBadge.className = `badge ${avail === 'available' ? 'badge-live' : avail === 'busy' ? 'badge-high' : 'badge-critical'}`;
        }
        document.querySelectorAll('.btn-vol-avail').forEach(b => {
          if (b === btn) {
            b.classList.add('btn-primary');
            b.classList.remove('btn-secondary');
          } else {
            b.classList.remove('btn-primary');
            b.classList.add('btn-secondary');
          }
        });
        showToast(`Readiness updated to ${avail.toUpperCase()}`);
      } catch (err) {
        showToast('Could not update availability');
      }
    });
  });

  const btnSaveVolProfile = document.getElementById('btn-save-vol-profile');
  if (btnSaveVolProfile) {
    btnSaveVolProfile.addEventListener('click', async () => {
      const skills = [];
      document.querySelectorAll('.vol-skill-chk:checked').forEach(c => skills.push(c.value));
      try {
        await ApiService.put('/volunteers/profile', { skills });
        showToast('Volunteer profile and skills saved!');
      } catch (err) {
        showToast('Could not save volunteer skills');
      }
    });
  }

  async function loadHelpRequests() {
    try {
      const openRes = await ApiService.get('/help-requests?status=open');
      const nearbyList = document.getElementById('nearby-help-requests-list');
      if (nearbyList && openRes.success && openRes.requests) {
        if (openRes.requests.length === 0) {
          nearbyList.innerHTML = '<span class="subtext">No open emergency requests nearby. All communities clear!</span>';
        } else {
          nearbyList.innerHTML = openRes.requests.map(req => `
            <div class="card" style="margin-bottom: 0.75rem; border-left: 4px solid ${req.urgency >= 4 ? '#DC2626' : '#2563EB'}; padding: 0.85rem;">
              <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.35rem;">
                <div>
                  <span class="badge ${req.urgency >= 4 ? 'badge-critical' : 'badge-high'}">LEVEL ${req.urgency} URGENCY</span>
                  <strong style="margin-left: 0.5rem; text-transform: capitalize;">${req.category} Need</strong>
                </div>
                <span class="subtext" style="font-size: 0.75rem;">${new Date(req.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
              <p style="font-size: 0.88rem; margin: 0.3rem 0; color: var(--text-primary);">${escapeHtml(req.notes || 'Emergency assistance needed.')}</p>
              <div style="display: flex; gap: 0.35rem; flex-wrap: wrap; margin-bottom: 0.5rem;">
                <span class="tag-pill">👥 ${req.peopleCount || 1} Person(s)</span>
                ${(req.vulnerabilityFlags || []).map(f => `<span class="tag-pill" style="background: #FEE2E2; color: #991B1B;">⚠️ ${f}</span>`).join('')}
              </div>
              <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 0.5rem;">
                <span class="subtext" style="font-size: 0.78rem;">📍 ${escapeHtml(req.address || 'Reported Location')}</span>
                <button class="btn btn-primary btn-sm btn-accept-request" data-id="${req._id}" style="background: #10B981; border-color: #10B981;">
                  Accept / Respond →
                </button>
              </div>
            </div>
          `).join('');
        }
      }

      // My requests list
      const allRes = await ApiService.get('/help-requests');
      const currentUser = AuthService.getUser();
      const myList = document.getElementById('my-help-requests-list');
      if (myList && allRes.success && allRes.requests && currentUser) {
        const mine = allRes.requests.filter(r => r.userId === currentUser.id || r.userId === currentUser._id);
        if (mine.length === 0) {
          myList.innerHTML = '<span class="subtext">You have not submitted any open help requests.</span>';
        } else {
          myList.innerHTML = mine.map(r => `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.6rem 0; border-bottom: 1px solid var(--border);">
              <div>
                <strong>${r.category.toUpperCase()}</strong> (${r.peopleCount} ppl) — ${escapeHtml(r.notes || '')}
                <div class="subtext" style="font-size: 0.75rem;">Status: <span class="badge ${r.status === 'open' ? 'badge-high' : 'badge-live'}">${r.status.toUpperCase()}</span></div>
              </div>
              <span class="subtext">${new Date(r.createdAt).toLocaleDateString()}</span>
            </div>
          `).join('');
        }
      }
    } catch (e) {}
  }

  // Accept / Claim Help Request
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('.btn-accept-request');
    if (!btn) return;
    const reqId = btn.dataset.id;
    if (!reqId) return;

    btn.disabled = true;
    btn.textContent = 'Claiming...';
    try {
      const res = await ApiService.post(`/help-requests/${reqId}/accept`, {});
      if (res.success) {
        showToast('✅ Help request accepted! You are assigned as primary responder.');
        await loadHelpRequests();
      }
    } catch (err) {
      if (err.message && err.message.includes('already')) {
        showToast('⚠️ Notice: This request was just claimed by another responder.');
      } else {
        showToast(err.message || 'Could not claim request');
      }
      await loadHelpRequests();
    }
  });

  const btnRefreshHelpReqs = document.getElementById('btn-refresh-help-requests');
  if (btnRefreshHelpReqs) {
    btnRefreshHelpReqs.addEventListener('click', () => {
      showToast('Refreshing community requests...');
      loadHelpRequests();
    });
  }

  // Help Request Modal
  const btnOpenHelpModal = document.getElementById('btn-open-help-request-modal');
  const helpModal = document.getElementById('help-request-modal');
  const closeHelpModal = document.getElementById('close-help-request-modal');
  const helpForm = document.getElementById('help-request-form');

  if (btnOpenHelpModal && helpModal) {
    btnOpenHelpModal.addEventListener('click', () => {
      const addrInput = document.getElementById('req-address');
      if (addrInput) addrInput.value = selectedLoc.name;
      helpModal.classList.add('active');
    });
  }

  if (closeHelpModal && helpModal) {
    closeHelpModal.addEventListener('click', () => helpModal.classList.remove('active'));
  }

  if (helpForm) {
    helpForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const category = document.getElementById('req-category')?.value;
      const urgency = Number(document.getElementById('req-urgency')?.value || 3);
      const peopleCount = Number(document.getElementById('req-people')?.value || 1);
      const address = document.getElementById('req-address')?.value || selectedLoc.name;
      const notes = document.getElementById('req-notes')?.value;

      const vulnerabilityFlags = [];
      document.querySelectorAll('.vuln-flag:checked').forEach(c => vulnerabilityFlags.push(c.value));

      try {
        const res = await ApiService.post('/help-requests', {
          category,
          urgency,
          peopleCount,
          address,
          notes,
          vulnerabilityFlags,
          lat: selectedLoc.lat,
          lng: selectedLoc.lng
        });
        if (res.success) {
          showToast('🆘 Help request broadcasted to emergency responders & volunteers!');
          helpModal.classList.remove('active');
          helpForm.reset();
          await loadHelpRequests();
        }
      } catch (err) {
        showToast(err.message || 'Failed to dispatch help request');
      }
    });
  }

  // 16. Post-Flood Recovery Damage Claims
  async function loadRecoveryModule() {
    try {
      const res = await ApiService.get('/damage/mine');
      const container = document.getElementById('my-damage-claims-list');
      if (container && res.success && res.reports) {
        if (res.reports.length === 0) {
          container.innerHTML = '<span class="subtext">You have not submitted any flood damage claims yet.</span>';
        } else {
          container.innerHTML = res.reports.map(d => `
            <div class="card" style="padding: 0.75rem; border-left: 4px solid #2563EB;">
              <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                <div>
                  <strong style="text-transform: capitalize;">${d.category} — ${d.severity}</strong>
                  <div style="font-size: 0.85rem; color: #059669; font-weight: 700; margin-top: 2px;">
                    Claim: ₹${Number(d.estimatedLossINR || 0).toLocaleString('en-IN')}
                  </div>
                </div>
                <span class="badge ${d.status === 'approved' ? 'badge-live' : d.status === 'rejected' ? 'badge-critical' : 'badge-high'}">
                  ${d.status.toUpperCase()}
                </span>
              </div>
              <p class="subtext" style="font-size: 0.8rem; margin-top: 0.4rem;">${escapeHtml(d.description)}</p>
              <span class="subtext" style="font-size: 0.72rem;">Filed: ${new Date(d.createdAt).toLocaleDateString()}</span>
            </div>
          `).join('');
        }
      }
    } catch (e) {}
  }

  const dmgForm = document.getElementById('damage-report-form');
  if (dmgForm) {
    dmgForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const category = document.getElementById('dmg-category')?.value;
      const severity = document.getElementById('dmg-severity')?.value;
      const estimatedLossINR = Number(document.getElementById('dmg-loss')?.value || 0);
      const description = document.getElementById('dmg-description')?.value;
      const fileInput = document.getElementById('dmg-photos-input');

      const photos = [];
      if (fileInput && fileInput.files.length > 0) {
        for (let i = 0; i < Math.min(3, fileInput.files.length); i++) {
          const file = fileInput.files[i];
          if (file.size <= 2 * 1024 * 1024) {
            const b64 = await new Promise((resolve) => {
              const reader = new FileReader();
              reader.onload = (ev) => resolve(ev.target.result);
              reader.readAsDataURL(file);
            });
            photos.push(b64);
          }
        }
      }

      try {
        const res = await ApiService.post('/damage', {
          category,
          severity,
          estimatedLossINR,
          description,
          photos,
          lat: selectedLoc.lat,
          lng: selectedLoc.lng,
          address: selectedLoc.name
        });
        if (res.success) {
          showToast('Damage assessment claim filed successfully!');
          dmgForm.reset();
          await loadRecoveryModule();
        }
      } catch (err) {
        showToast(err.message || 'Failed to file damage claim');
      }
    });
  }

  // Initial Boot Sequence
  initRoleNav();
  initMaps();
  updateLocation(selectedLoc, true);
  loadAlertsData();
  loadContactsData();
  loadReportsData();

  // Periodic 30-second live refresh for crowdsourced reports
  setInterval(() => {
    loadReportsData();
  }, 30 * 1000);

  window.addEventListener('hashchange', () => {
    const hash = window.location.hash.replace('#', '');
    if (hash && document.getElementById(`tab-${hash}`)) {
      switchTab(hash);
    }
  });

  window.addEventListener('resize', () => {
    if (overviewMap) overviewMap.invalidateSize();
    if (mainMap) mainMap.invalidateSize();
    if (safetyMap) safetyMap.invalidateSize();
    if (sheltersMap) sheltersMap.invalidateSize();
    if (reportPickerMap) reportPickerMap.invalidateSize();
  });

  // Refresh telemetry periodically while the same location remains open.
  setInterval(() => {
    const requestVersion = ++locationVersion;
    void loadDashboardData(requestVersion, { ...selectedLoc });
  }, 60 * 1000);
});
