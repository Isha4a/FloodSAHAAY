document.addEventListener('DOMContentLoaded', async () => {
  // 1. Role Guard
  if (!AuthService.isAuthenticated()) {
    window.location.href = 'signin.html';
    return;
  }

  const currentUser = AuthService.getCurrentUser();
  const token = localStorage.getItem('floodsahaay_token') || localStorage.getItem('limitflood_token');
  const userRole = currentUser ? currentUser.role : null;

  // Verify role with backend profile if role isn't explicitly cached yet
  let verifiedRole = userRole;
  try {
    const profRes = await ApiService.get('/profile');
    if (profRes.success && profRes.user) {
      verifiedRole = profRes.user.role || 'citizen';
      // update cached user
      if (currentUser) {
        currentUser.role = verifiedRole;
        localStorage.setItem('floodsahaay_user', JSON.stringify(currentUser));
      }
    }
  } catch (e) {
    console.warn('Could not verify profile role:', e.message);
  }

  if (!['admin', 'responder'].includes(verifiedRole)) {
    alert(`Access Restricted: Responder Command Center requires 'admin' or 'responder' role. Your account role is '${verifiedRole || 'citizen'}'. Redirecting to Citizen Dashboard...`);
    window.location.href = 'dashboard.html';
    return;
  }

  // Toast Helper
  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<span>${type === 'sos' ? '🚨' : 'ℹ️'}</span> <span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  // 2. Initialize Command Map
  const mapCenter = [26.8467, 80.9462]; // Lucknow Default Center
  const adminMap = L.map('admin-map', { zoomControl: true }).setView(mapCenter, 13);

  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles &copy; Esri &mdash; OpenStreetMap contributors'
  }).addTo(adminMap);

  // Layer Groups
  const sosGroup = L.layerGroup().addTo(adminMap);
  const reportsGroup = L.layerGroup().addTo(adminMap);
  const sheltersGroup = L.layerGroup().addTo(adminMap);
  const volunteersGroup = L.layerGroup().addTo(adminMap);
  const checkinsGroup = L.layerGroup().addTo(adminMap);

  // Layer Toggles
  document.getElementById('layer-toggle-sos').addEventListener('change', e => {
    e.target.checked ? adminMap.addLayer(sosGroup) : adminMap.removeLayer(sosGroup);
  });
  document.getElementById('layer-toggle-reports').addEventListener('change', e => {
    e.target.checked ? adminMap.addLayer(reportsGroup) : adminMap.removeLayer(reportsGroup);
  });
  document.getElementById('layer-toggle-shelters').addEventListener('change', e => {
    e.target.checked ? adminMap.addLayer(sheltersGroup) : adminMap.removeLayer(sheltersGroup);
  });
  document.getElementById('layer-toggle-volunteers').addEventListener('change', e => {
    e.target.checked ? adminMap.addLayer(volunteersGroup) : adminMap.removeLayer(volunteersGroup);
  });
  document.getElementById('layer-toggle-checkins').addEventListener('change', e => {
    e.target.checked ? adminMap.addLayer(checkinsGroup) : adminMap.removeLayer(checkinsGroup);
  });

  // State
  let incidentsData = [];
  let activeModalIncident = null;

  // 3. Load Stats
  async function loadAdminStats() {
    try {
      const res = await ApiService.get('/admin/stats');
      if (res.success && res.stats) {
        document.getElementById('stat-active-sos').textContent = res.stats.activeSOS;
        document.getElementById('stat-unverified-reports').textContent = res.stats.unverifiedReports;
        document.getElementById('stat-verified-hazards').textContent = res.stats.verifiedHazards;
        document.getElementById('stat-shelters-cap').textContent = res.stats.sheltersNearCapacity;
        document.getElementById('stat-volunteers').textContent = res.stats.volunteersAvailable;
      }
    } catch (err) {
      console.warn('Failed to load admin stats:', err.message);
    }
  }

  // 4. Load Map Entities
  async function loadMapEntities() {
    // A. Shelters
    try {
      const res = await ApiService.get('/shelters');
      if (res.success && res.shelters) {
        sheltersGroup.clearLayers();
        res.shelters.forEach(s => {
          const cap = Number(s.capacity) || 100;
          const occ = Number(s.currentOccupancy ?? s.occupancy ?? 0);
          const ratio = occ / cap;

          // Color by occupancy: green < 60%, amber 60-90%, red > 90%
          let color = '#10B981';
          if (ratio >= 0.9) color = '#DC2626';
          else if (ratio >= 0.6) color = '#F59E0B';

          const icon = L.divIcon({
            className: 'shelter-marker-icon',
            html: `<div style="background: ${color}; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-size: 13px; font-weight: bold; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">🏠</div>`,
            iconSize: [28, 28],
            iconAnchor: [14, 14]
          });

          const marker = L.marker([s.lat, s.lng], { icon });
          marker.bindPopup(`
            <div style="font-family: Inter, sans-serif; min-width: 200px;">
              <h4 style="margin: 0 0 4px; font-size: 14px;">${s.name}</h4>
              <p style="margin: 0 0 6px; font-size: 11px; color: #666;">${s.address}</p>
              <div style="margin-bottom: 6px;">
                <strong>Occupancy:</strong> ${occ} / ${cap} (${Math.round(ratio * 100)}%)
                <div style="height: 6px; background: #eee; border-radius: 3px; margin-top: 2px;">
                  <div style="height: 100%; width: ${Math.min(100, ratio * 100)}%; background: ${color}; border-radius: 3px;"></div>
                </div>
              </div>
              <p style="margin: 0; font-size: 11px;"><strong>Supplies:</strong> Food: ${s.resources?.food || 'ok'}, Water: ${s.resources?.water || 'ok'}, Meds: ${s.resources?.medicine || 'ok'}</p>
            </div>
          `);
          sheltersGroup.addLayer(marker);
        });
      }
    } catch (e) { console.warn('Shelter map load error:', e.message); }

    // B. Volunteers
    try {
      const volRes = await ApiService.get('/volunteers/nearby?radiusKm=30');
      if (volRes.success && volRes.volunteers) {
        volunteersGroup.clearLayers();
        volRes.volunteers.forEach(v => {
          const vLat = v.location?.lat ?? 26.8467;
          const vLng = v.location?.lng ?? 80.9462;
          const icon = L.divIcon({
            className: 'vol-marker-icon',
            html: `<div style="background: #3B82F6; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-size: 11px; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">🤝</div>`,
            iconSize: [24, 24],
            iconAnchor: [12, 12]
          });
          const marker = L.marker([vLat, vLng], { icon });
          marker.bindPopup(`
            <div style="font-family: Inter, sans-serif;">
              <strong>${v.userName}</strong> (${v.availability})<br>
              Skills: ${(v.skills || []).join(', ')}<br>
              Vehicle: ${v.vehicle || 'none'}<br>
              Phone: ${v.phone || 'N/A'}
            </div>
          `);
          volunteersGroup.addLayer(marker);
        });
      }
    } catch (e) { console.warn('Volunteers map load error:', e.message); }

    // C. Check-ins
    try {
      const chkRes = await ApiService.get('/checkins/circle');
      if (chkRes.success && chkRes.circleCheckins) {
        checkinsGroup.clearLayers();
        chkRes.circleCheckins.forEach(c => {
          if (!c.location) return;
          const isNeedHelp = c.status === 'need_help';
          const isEvacuating = c.status === 'evacuating';
          const color = isNeedHelp ? '#DC2626' : (isEvacuating ? '#F59E0B' : '#10B981');
          const symbol = isNeedHelp ? '🚨' : (isEvacuating ? '🏃' : '✓');

          const icon = L.divIcon({
            className: 'chk-marker-icon',
            html: `<div style="background: ${color}; width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-size: 10px; border: 2px solid white; box-shadow: 0 1px 3px rgba(0,0,0,0.3);">${symbol}</div>`,
            iconSize: [22, 22],
            iconAnchor: [11, 11]
          });
          const marker = L.marker([c.location.lat, c.location.lng], { icon });
          marker.bindPopup(`<strong>${c.userName}</strong>: ${c.status.toUpperCase()}<br>"${c.message || ''}"<br>Battery: ${c.batteryLevel ? c.batteryLevel + '%' : 'N/A'}`);
          checkinsGroup.addLayer(marker);
        });
      }
    } catch (e) { console.warn('Checkins map load error:', e.message); }
  }

  // 5. Load Incidents (Triage Queue & SOS/Report Markers)
  async function loadIncidents() {
    const type = document.getElementById('filter-type').value;
    const status = document.getElementById('filter-status').value;
    const windowHours = document.getElementById('filter-window').value;
    const query = document.getElementById('filter-search').value;

    let url = `/admin/incidents?1=1`;
    if (type) url += `&type=${encodeURIComponent(type)}`;
    if (status) url += `&status=${encodeURIComponent(status)}`;
    if (windowHours) url += `&timeWindowHours=${encodeURIComponent(windowHours)}`;
    if (query) url += `&query=${encodeURIComponent(query)}`;

    try {
      const res = await ApiService.get(url);
      if (res.success && res.incidents) {
        incidentsData = res.incidents;
        renderTriageQueue(res.incidents);
        renderIncidentMarkers(res.incidents);
      }
    } catch (err) {
      console.warn('Failed to load incidents:', err.message);
    }
  }

  function renderIncidentMarkers(incidents) {
    sosGroup.clearLayers();
    reportsGroup.clearLayers();

    incidents.forEach(inc => {
      if (!inc.location || !inc.location.lat || !inc.location.lng) return;

      if (inc.type === 'sos') {
        const isMesh = inc.source === 'mesh';
        const color = inc.status === 'resolved' ? '#9CA3AF' : '#DC2626';

        const icon = L.divIcon({
          className: 'sos-marker-pin',
          html: `<div style="background: ${color}; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-size: 14px; border: 3px solid white; box-shadow: 0 0 12px ${color}; animation: ${inc.status === 'active' ? 'sos-pulse 1.5s infinite' : 'none'};">${isMesh ? '📡' : '🚨'}</div>`,
          iconSize: [32, 32],
          iconAnchor: [16, 16]
        });

        const marker = L.marker([inc.location.lat, inc.location.lng], { icon });
        marker.bindPopup(`
          <div style="font-family: Inter, sans-serif;">
            <strong style="color: #DC2626;">EMERGENCY SOS (${inc.source.toUpperCase()})</strong><br>
            <strong>${inc.reporterName}</strong> · ${inc.phone || 'No phone'}<br>
            <em>${inc.description}</em><br>
            Priority Score: <strong>${inc.priorityScore}/100</strong><br>
            Status: <strong>${inc.status}</strong><br>
            <button class="btn btn-primary btn-sm" style="margin-top: 6px; padding: 2px 8px; font-size: 11px;" onclick="window.openIncidentModal('${inc.id}')">Open Triage</button>
          </div>
        `);
        sosGroup.addLayer(marker);

      } else if (inc.type === 'report') {
        const conf = inc.confidenceScore || 40;
        const isVerified = inc.status === 'verified';
        const isDisputed = inc.status === 'disputed';
        const borderColor = isDisputed ? '#9CA3AF' : (isVerified ? '#10B981' : '#F59E0B');
        const borderStyle = isVerified ? 'solid' : (isDisputed ? 'solid' : 'dashed');

        const icon = L.divIcon({
          className: 'rep-marker-pin',
          html: `<div style="background: white; border: 2.5px ${borderStyle} ${borderColor}; width: 26px; height: 26px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">⚠️</div>`,
          iconSize: [26, 26],
          iconAnchor: [13, 13]
        });

        const marker = L.marker([inc.location.lat, inc.location.lng], { icon });
        marker.bindPopup(`
          <div style="font-family: Inter, sans-serif;">
            <strong>${inc.title}</strong><br>
            ${inc.description}<br>
            Confidence: <strong>${conf}% (${inc.status})</strong><br>
            <button class="btn btn-secondary btn-sm" style="margin-top: 6px; padding: 2px 8px; font-size: 11px;" onclick="window.openIncidentModal('${inc.id}')">Details</button>
          </div>
        `);
        reportsGroup.addLayer(marker);
      }
    });
  }

  function renderTriageQueue(incidents) {
    const container = document.getElementById('triage-queue-container');
    const badge = document.getElementById('incident-count-badge');
    badge.textContent = `${incidents.length} incidents`;

    if (!incidents.length) {
      container.innerHTML = `<div style="text-align: center; padding: 2.5rem 1rem; color: #9CA3AF;">✓ All incidents clear or no matching records found.</div>`;
      return;
    }

    container.innerHTML = incidents.map(inc => {
      let prioClass = 'priority-low';
      let prioBg = '#D1FAE5';
      let prioColor = '#065F46';

      if (inc.priorityScore >= 75) {
        prioClass = 'priority-critical';
        prioBg = '#FEE2E2';
        prioColor = '#991B1B';
      } else if (inc.priorityScore >= 50) {
        prioClass = 'priority-high';
        prioBg = '#FFEDD5';
        prioColor = '#9A3412';
      } else if (inc.priorityScore >= 30) {
        prioClass = 'priority-medium';
        prioBg = '#FEF3C7';
        prioColor = '#92400E';
      }

      return `
        <div class="incident-card ${prioClass}" onclick="window.openIncidentModal('${inc.id}')">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.35rem;">
            <span class="incident-score-badge" style="background: ${prioBg}; color: ${prioColor};">
              Priority ${inc.priorityScore}
            </span>
            <span class="badge ${inc.status === 'active' || inc.status === 'open' ? 'badge-critical' : 'badge-live'}" style="font-size: 0.68rem;">
              ${inc.status.toUpperCase()}
            </span>
          </div>

          <h4 style="font-size: 0.92rem; font-weight: 700; margin: 0 0 0.25rem; color: var(--text-primary);">
            ${inc.title}
          </h4>
          <p style="font-size: 0.8rem; color: var(--text-secondary); margin: 0 0 0.5rem; line-height: 1.4;">
            ${inc.description || 'No additional details'}
          </p>

          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.72rem; color: #6B7280;">
            <span>👤 ${inc.reporterName} ${inc.phone ? '· ' + inc.phone : ''}</span>
            <span>${new Date(inc.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
        </div>
      `;
    }).join('');
  }

  // 6. Incident Modal & Action Handler
  window.openIncidentModal = async function(incidentId) {
    const inc = incidentsData.find(i => String(i.id) === String(incidentId));
    if (!inc) return;

    activeModalIncident = inc;
    document.getElementById('modal-incident-type').textContent = `INCIDENT ${inc.type.toUpperCase()}`;
    document.getElementById('modal-incident-title').textContent = inc.title;

    document.getElementById('modal-incident-body').innerHTML = `
      <div style="background: var(--bg-surface); padding: 0.85rem; border-radius: var(--radius-sm); margin-bottom: 0.75rem;">
        <p style="margin: 0 0 0.25rem;"><strong>Reporter:</strong> ${inc.reporterName} (${inc.phone || 'No phone'})</p>
        <p style="margin: 0 0 0.25rem;"><strong>Coordinates:</strong> ${inc.location ? inc.location.lat.toFixed(4) + '°N, ' + inc.location.lng.toFixed(4) + '°E' : 'N/A'}</p>
        <p style="margin: 0 0 0.25rem;"><strong>Status:</strong> ${inc.status} | <strong>Priority:</strong> ${inc.priorityScore}/100</p>
        <p style="margin: 0;"><strong>Details:</strong> ${inc.description}</p>
      </div>
    `;

    // Center map on this incident
    if (inc.location && inc.location.lat && inc.location.lng) {
      adminMap.flyTo([inc.location.lat, inc.location.lng], 15);
    }

    // Load audit trail
    const auditContainer = document.getElementById('modal-audit-trail');
    auditContainer.innerHTML = '<span class="subtext">Loading history...</span>';

    try {
      const logsRes = await ApiService.get(`/admin/incidents/${inc.id}/logs`);
      if (logsRes.success && logsRes.logs && logsRes.logs.length > 0) {
        auditContainer.innerHTML = logsRes.logs.map(l => `
          <div style="padding: 0.5rem; background: var(--bg-surface); border-radius: var(--radius-sm); font-size: 0.8rem; border-left: 3px solid #3B82F6;">
            <strong>${l.action.toUpperCase()}</strong> by ${l.actorName} · <span style="color: #6B7280;">${new Date(l.at).toLocaleTimeString()}</span>
            <p style="margin: 0.2rem 0 0; color: var(--text-secondary);">${l.note}</p>
          </div>
        `).join('');
      } else {
        auditContainer.innerHTML = '<span class="subtext">No prior actions logged. First responders can acknowledge below.</span>';
      }
    } catch (e) {
      auditContainer.innerHTML = '<span class="subtext">Unable to load audit history.</span>';
    }

    document.getElementById('incident-modal').style.display = 'flex';
  };

  document.getElementById('btn-close-modal').addEventListener('click', () => {
    document.getElementById('incident-modal').style.display = 'none';
  });

  let selectedAction = 'acknowledged';
  document.querySelectorAll('.btn-action-select').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.btn-action-select').forEach(x => x.classList.replace('btn-primary', 'btn-secondary'));
      b.classList.replace('btn-secondary', 'btn-primary');
      selectedAction = b.dataset.action;
    });
  });

  document.getElementById('btn-submit-action').addEventListener('click', async () => {
    if (!activeModalIncident) return;
    const note = document.getElementById('action-note').value;

    try {
      const res = await ApiService.post(`/admin/incidents/${activeModalIncident.id}/action`, {
        action: selectedAction,
        note,
        incidentType: activeModalIncident.type
      });

      if (res.success) {
        showToast(`Action '${selectedAction}' submitted!`);
        document.getElementById('action-note').value = '';
        document.getElementById('incident-modal').style.display = 'none';
        loadAdminStats();
        loadIncidents();
      }
    } catch (err) {
      alert('Action submission failed: ' + err.message);
    }
  });

  // 7. Area Broadcast Modal
  const broadcastModal = document.getElementById('broadcast-modal');
  document.getElementById('btn-broadcast-modal').addEventListener('click', () => {
    broadcastModal.style.display = 'flex';
  });
  document.getElementById('btn-close-broadcast').addEventListener('click', () => {
    broadcastModal.style.display = 'none';
  });

  document.getElementById('btn-send-broadcast').addEventListener('click', async () => {
    const title = document.getElementById('bc-title').value.trim();
    const message = document.getElementById('bc-message').value.trim();
    const severity = document.getElementById('bc-severity').value;
    const radiusKm = parseFloat(document.getElementById('bc-radius').value) || 10;

    if (!title || !message) {
      alert('Please fill out both title and message.');
      return;
    }

    try {
      const res = await ApiService.post('/admin/broadcast', {
        title,
        message,
        severity,
        radiusKm,
        center: { lat: adminMap.getCenter().lat, lng: adminMap.getCenter().lng }
      });

      if (res.success) {
        showToast('Emergency Area Broadcast Dispatched!');
        broadcastModal.style.display = 'none';

        // Draw visual broadcast circle on map
        const circle = L.circle(adminMap.getCenter(), {
          radius: radiusKm * 1000,
          color: '#DC2626',
          fillColor: '#F87171',
          fillOpacity: 0.15,
          weight: 2,
          dashArray: '6, 6'
        }).addTo(adminMap);
        setTimeout(() => adminMap.removeLayer(circle), 30000);
      }
    } catch (err) {
      alert('Broadcast dispatch failed: ' + err.message);
    }
  });

  // 8. Damage Summary Modal & Canvas Chart
  const damageModal = document.getElementById('damage-modal');
  document.getElementById('btn-damage-summary').addEventListener('click', async () => {
    damageModal.style.display = 'flex';
    try {
      const res = await ApiService.get('/damage/summary');
      if (res.success && res.summary) {
        const s = res.summary;
        document.getElementById('dmg-total-loss').textContent = `₹ ${s.totalLossINR.toLocaleString('en-IN')}`;
        document.getElementById('dmg-total-claims').textContent = `${s.totalReports} claims filed`;

        // Draw canvas bar chart of categories
        drawDamageChart(s.byCategory || {});

        const breakdownContainer = document.getElementById('dmg-breakdown-details');
        breakdownContainer.innerHTML = Object.entries(s.byCategory || {}).map(([cat, cnt]) => `
          <div style="display: flex; justify-content: space-between; border-bottom: 1px solid var(--border); padding: 0.25rem 0;">
            <span style="text-transform: capitalize;">${cat} Damage Claims</span>
            <strong>${cnt}</strong>
          </div>
        `).join('');
      }
    } catch (e) {
      console.warn('Could not load damage summary:', e.message);
    }
  });

  document.getElementById('btn-close-damage').addEventListener('click', () => {
    damageModal.style.display = 'none';
  });

  function drawDamageChart(byCategory) {
    const canvas = document.getElementById('damage-summary-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const entries = Object.entries(byCategory);
    if (!entries.length) {
      ctx.fillStyle = '#9CA3AF';
      ctx.font = '12px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No damage assessments recorded yet', w / 2, h / 2);
      return;
    }

    const maxVal = Math.max(5, ...entries.map(e => e[1]));
    const barWidth = 36;
    const gap = (w - (entries.length * barWidth)) / (entries.length + 1);

    entries.forEach(([cat, val], idx) => {
      const barH = (val / maxVal) * (h - 50);
      const x = gap + idx * (barWidth + gap);
      const y = h - 25 - barH;

      ctx.fillStyle = '#DC2626';
      ctx.beginPath();
      ctx.roundRect(x, y, barWidth, barH, 4);
      ctx.fill();

      // Count label
      ctx.fillStyle = '#111827';
      ctx.font = '700 11px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(String(val), x + barWidth / 2, y - 5);

      // Category label
      ctx.fillStyle = '#6B7280';
      ctx.font = '500 10px Inter, sans-serif';
      ctx.fillText(cat.slice(0, 6), x + barWidth / 2, h - 8);
    });
  }

  // 9. Real-Time Server-Sent Events (SSE) with Fallback Polling
  function setupSSE() {
    const sseUrl = `/api/admin/stream?token=${encodeURIComponent(token)}`;
    const eventSource = new EventSource(sseUrl);

    eventSource.onopen = () => {
      console.log('[SSE] Authority event stream connected.');
      document.getElementById('sse-status-badge').innerHTML = '<span class="badge-dot"></span> Live Stream';
    };

    eventSource.onmessage = (e) => {
      try {
        const payload = JSON.parse(e.data);
        console.log('[SSE EVENT]', payload);

        if (payload.type === 'sos_alert') {
          showToast(`🚨 NEW EMERGENCY SOS from ${payload.data.userName || 'Citizen'}!`, 'sos');
          loadAdminStats();
          loadIncidents();
        } else if (payload.type === 'report_created' || payload.type === 'report_voted') {
          showToast(`⚠️ Citizen report update: ${payload.data.type?.replace('_', ' ')}`);
          loadAdminStats();
          loadIncidents();
        } else if (payload.type === 'shelter_updated' || payload.type === 'shelter_checkin') {
          loadAdminStats();
          loadMapEntities();
        } else {
          loadAdminStats();
          loadIncidents();
        }
      } catch (parseErr) {}
    };

    eventSource.onerror = (err) => {
      console.warn('[SSE ERROR] Connection lost. Falling back to 10s polling interval.', err);
      eventSource.close();
      document.getElementById('sse-status-badge').innerHTML = '<span class="badge-dot" style="background: #F59E0B;"></span> 10s Polling';
      // Fallback Polling every 10 seconds
      setInterval(() => {
        loadAdminStats();
        loadIncidents();
      }, 10000);
    };
  }

  // Hook up filter listeners
  ['filter-type', 'filter-status', 'filter-window'].forEach(id => {
    document.getElementById(id).addEventListener('change', loadIncidents);
  });
  document.getElementById('filter-search').addEventListener('input', () => {
    clearTimeout(window.searchDebounce);
    window.searchDebounce = setTimeout(loadIncidents, 300);
  });

  // Initial Load
  loadAdminStats();
  loadMapEntities();
  loadIncidents();
  setupSSE();
});
