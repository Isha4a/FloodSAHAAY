/**
 * Reports Service
 * Offline-first client for citizen flood reports, voting, and local queue sync.
 */

class ReportsService {
  static QUEUE_KEY = 'floodsahaay_queued_reports';

  // Get locally queued reports
  static getQueuedReports() {
    try {
      const data = localStorage.getItem(this.QUEUE_KEY);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      return [];
    }
  }

  // Save queued report locally
  static saveQueuedReport(report) {
    const queue = this.getQueuedReports();
    queue.push(report);
    localStorage.setItem(this.QUEUE_KEY, JSON.stringify(queue));
  }

  // Clear queued report by local id
  static removeQueuedReport(localId) {
    const queue = this.getQueuedReports().filter(r => r.localId !== localId);
    localStorage.setItem(this.QUEUE_KEY, JSON.stringify(queue));
  }

  // Submit report with offline fallback
  static async submitReport(reportData) {
    const payload = {
      ...reportData,
      createdAt: reportData.createdAt || new Date().toISOString()
    };

    // If browser is offline, queue immediately
    if (!navigator.onLine) {
      const localReport = {
        ...payload,
        localId: 'local_' + Date.now(),
        _id: 'pending_' + Date.now(),
        status: 'unverified',
        confidenceScore: 40,
        isPendingSync: true
      };
      this.saveQueuedReport(localReport);
      return {
        success: true,
        offline: true,
        message: 'Report saved offline. It will automatically sync once your connection returns.',
        report: localReport
      };
    }

    try {
      const res = await ApiService.post('/reports', payload);
      return res;
    } catch (err) {
      // If network failure, queue locally
      if (err.message && (err.message.includes('fetch') || err.message.includes('network') || err.message.includes('timed out'))) {
        const localReport = {
          ...payload,
          localId: 'local_' + Date.now(),
          _id: 'pending_' + Date.now(),
          status: 'unverified',
          confidenceScore: 40,
          isPendingSync: true
        };
        this.saveQueuedReport(localReport);
        return {
          success: true,
          offline: true,
          message: 'Network issue. Report queued locally and will sync automatically.',
          report: localReport
        };
      }
      throw err;
    }
  }

  // Sync queued reports when online
  static async syncQueuedReports(onProgress = null) {
    if (!navigator.onLine) return;
    const queue = this.getQueuedReports();
    if (queue.length === 0) return;

    console.log(`[REPORTS SYNC] Attempting to sync ${queue.length} offline report(s)...`);

    for (const item of [...queue]) {
      try {
        const { localId, isPendingSync, _id, ...cleanData } = item;
        const res = await ApiService.post('/reports', cleanData);
        if (res.success) {
          this.removeQueuedReport(localId);
          if (typeof onProgress === 'function') onProgress(res.report);
        }
      } catch (err) {
        console.warn(`[REPORTS SYNC] Failed to sync report ${item.localId}:`, err.message);
      }
    }
  }

  // Fetch reports near coordinates
  static async getNearbyReports(lat, lng, radiusKm = 10, type = null, status = null) {
    let url = `/reports?lat=${lat}&lng=${lng}&radiusKm=${radiusKm}`;
    if (type) url += `&type=${encodeURIComponent(type)}`;
    if (status) url += `&status=${encodeURIComponent(status)}`;
    return await ApiService.get(url);
  }

  // Fetch blocked roads helper
  static async getBlockedRoads(lat, lng, radiusKm = 15) {
    return await ApiService.get(`/reports/blocked-roads?lat=${lat}&lng=${lng}&radiusKm=${radiusKm}`);
  }

  // Vote on a report
  static async voteReport(reportId, vote, lat, lng) {
    return await ApiService.post(`/reports/${reportId}/vote`, { vote, lat, lng });
  }

  // Resolve a report
  static async resolveReport(reportId) {
    return await ApiService.put(`/reports/${reportId}/resolve`, {});
  }
}

// Auto-sync listener on window online event
window.addEventListener('online', () => {
  ReportsService.syncQueuedReports((syncedReport) => {
    if (window.showToast) {
      window.showToast(`Synced offline report: ${syncedReport.type.replace('_', ' ')}`);
    }
  });
});
