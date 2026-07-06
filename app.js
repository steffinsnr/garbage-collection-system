'use strict';

class GarbageCollectionSystem {
  constructor() {
    this.requests = [];
    this.collectors = [];
    this.schedules = [];
    this.init();
  }

  init() {
    this.setupEventListeners();
    this.loadData();
    this.realtime = NSNR.connectRealtime(() => this.loadData());
  }

  setupEventListeners() {
    const form = document.getElementById('requestForm');
    if (form) form.addEventListener('submit', (e) => this.handleFormSubmit(e));

    const trackButton = document.getElementById('trackBtn');
    if (trackButton) trackButton.addEventListener('click', (e) => { e.preventDefault(); this.trackRequest(); });

    const trackingInput = document.getElementById('trackingId');
    if (trackingInput) {
      trackingInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); this.trackRequest(); }
      });
    }

    ['areaFilter', 'typeFilter'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', () => this.renderSchedule());
    });

    const hamburger = document.querySelector('.hamburger');
    const navMenu = document.querySelector('.nav-menu');
    if (hamburger && navMenu) {
      hamburger.addEventListener('click', () => {
        const open = hamburger.classList.toggle('active');
        navMenu.classList.toggle('active');
        hamburger.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    }

    document.querySelectorAll('.nav-link').forEach(link => {
      link.addEventListener('click', (e) => {
        const href = link.getAttribute('href');
        if (href && (href.includes('.html') || href.startsWith('http'))) return;
        e.preventDefault();
        const targetId = href.substring(1);
        const section = document.getElementById(targetId);
        if (section) section.scrollIntoView({ behavior: 'smooth' });
        document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
        link.classList.add('active');
      });
    });
  }

  async loadData() {
    try {
      const [stats, schedules, collectors] = await Promise.all([
        NSNR.api('/api/stats'),
        NSNR.api('/api/schedules'),
        NSNR.api('/api/collectors')
      ]);
      this.schedules = schedules;
      this.collectors = collectors;
      this.updateStats(stats);
      this.renderSchedule();
    } catch (err) {
      console.error(err);
      NSNR.showMessage(document.getElementById('message'), 'Unable to load data. Is the server running?', 'error');
    }
  }

  updateStats(stats) {
    NSNR.setText(document.getElementById('totalResidents'), stats.totalResidents.toLocaleString());
    NSNR.setText(document.getElementById('activeCollectors'), stats.activeCollectors);
    NSNR.setText(document.getElementById('completedToday'), stats.completedToday);
  }

  async handleFormSubmit(e) {
    e.preventDefault();
    const msgEl = document.getElementById('message');
    const payload = {
      residentId: document.getElementById('residentId').value.trim(),
      residentName: document.getElementById('residentName').value.trim(),
      wasteType: document.getElementById('wasteType').value,
      priority: document.getElementById('priority').value,
      address: document.getElementById('address').value.trim(),
      phone: document.getElementById('phone').value.trim(),
      description: document.getElementById('description').value.trim(),
      preferredDate: document.getElementById('preferredDate').value
    };

    const errors = NSNR.validateRequestForm(payload);
    if (errors.length) {
      NSNR.showMessage(msgEl, errors.join(' '), 'error');
      return;
    }

    try {
      const created = await NSNR.api('/api/requests', { method: 'POST', body: payload });
      NSNR.showMessage(msgEl, `Request submitted successfully! Your request ID is: ${created.id}`, 'success');
      NSNR.announce(`Request ${created.id} submitted successfully.`);
      document.getElementById('requestForm').reset();
      await this.loadData();
    } catch (err) {
      NSNR.showMessage(msgEl, err.message, 'error');
    }
  }

  async trackRequest() {
    const trackingId = document.getElementById('trackingId')?.value.trim();
    const resultsContainer = document.getElementById('trackingResults');
    if (!resultsContainer) return;

    NSNR.clearElement(resultsContainer);

    if (!trackingId) {
      resultsContainer.appendChild(NSNR.createEl('p', {
        className: 'tracking-notice tracking-error',
        role: 'alert',
        text: 'Please enter a Request ID or Resident ID'
      }));
      return;
    }

    try {
      const results = await NSNR.api(`/api/requests/track/${encodeURIComponent(trackingId)}`);
      if (!results.length) {
        const p = NSNR.createEl('p', { className: 'tracking-notice tracking-warn', role: 'status' });
        p.appendChild(document.createTextNode('No requests found for: '));
        p.appendChild(NSNR.createEl('strong', { text: trackingId }));
        resultsContainer.appendChild(p);
        return;
      }

      results.forEach(req => resultsContainer.appendChild(this.buildRequestCard(req)));
      NSNR.announce(`Found ${results.length} request(s).`);
    } catch (err) {
      resultsContainer.appendChild(NSNR.createEl('p', {
        className: 'tracking-notice tracking-error',
        role: 'alert',
        text: err.message
      }));
    }
  }

  buildRequestCard(req) {
    const card = NSNR.createEl('div', { className: 'request-card', role: 'article' });
    card.appendChild(NSNR.createEl('h3', { text: `Request #${req.id}` }));

    const fields = [
      ['Resident', `${req.residentName} (${req.residentId})`],
      ['Waste Type', req.wasteType],
      ['Priority', req.priority],
      ['Address', req.address],
      ['Status', req.status],
      ['Submitted', NSNR.formatDate(req.timestamp)]
    ];
    if (req.assignedCollector) fields.push(['Assigned Collector', req.assignedCollector]);
    if (req.collectionDate) fields.push(['Collection Date', NSNR.formatDate(req.collectionDate)]);

    fields.forEach(([label, value]) => {
      const p = NSNR.createEl('p');
      p.appendChild(NSNR.createEl('strong', { text: `${label}: ` }));
      if (label === 'Status') {
        p.appendChild(NSNR.createEl('span', { className: `status-badge ${NSNR.statusClass(req.status)}`, text: value }));
      } else {
        p.appendChild(document.createTextNode(value));
      }
      card.appendChild(p);
    });
    return card;
  }

  renderSchedule() {
    const scheduleGrid = document.getElementById('scheduleGrid');
    if (!scheduleGrid) return;

    NSNR.clearElement(scheduleGrid);
    const areaFilter = document.getElementById('areaFilter')?.value || '';
    const typeFilter = document.getElementById('typeFilter')?.value || '';

    let filtered = this.schedules;
    if (areaFilter) filtered = filtered.filter(s => s.area.includes(areaFilter));
    if (typeFilter) filtered = filtered.filter(s => s.type === typeFilter);

    if (!filtered.length) {
      scheduleGrid.appendChild(NSNR.createEl('p', { text: 'No schedule entries match your filters.' }));
      return;
    }

    filtered.forEach(schedule => {
      const card = NSNR.createEl('div', { className: 'schedule-card', role: 'article' });
      card.appendChild(NSNR.createEl('h3', { text: `${schedule.type} Collection` }));
      card.appendChild(NSNR.createEl('div', {
        className: 'date',
        text: `${schedule.dayName}, ${NSNR.formatDate(schedule.date + 'T12:00:00')}`
      }));
      card.appendChild(NSNR.createEl('div', { className: 'area', text: schedule.area }));
      card.appendChild(NSNR.createEl('p', {}, [
        NSNR.createEl('strong', { text: 'Time (EAT): ' }),
        document.createTextNode(schedule.time)
      ]));
      card.appendChild(NSNR.createEl('p', {}, [
        NSNR.createEl('strong', { text: 'Collector: ' }),
        document.createTextNode(schedule.collector || 'Unassigned')
      ]));
      scheduleGrid.appendChild(card);
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.garbageSystem = new GarbageCollectionSystem();
  const lastId = sessionStorage.getItem('lastRegisteredId');
  if (lastId) {
    const residentIdInput = document.getElementById('residentId');
    if (residentIdInput && !residentIdInput.value) residentIdInput.value = lastId;
    sessionStorage.removeItem('lastRegisteredId');
  }
});
