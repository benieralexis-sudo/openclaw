/* ===== CHARTS — MISSION CONTROL ===== */

const Charts = {
  instances: {},

  // External tooltip (HTML-based, premium look)
  externalTooltip(context) {
    const { chart, tooltip } = context;
    let el = chart.canvas.parentNode.querySelector('.chart-tooltip');

    if (!el) {
      el = document.createElement('div');
      el.className = 'chart-tooltip';
      chart.canvas.parentNode.appendChild(el);
    }

    if (tooltip.opacity === 0) {
      el.style.opacity = '0';
      el.style.pointerEvents = 'none';
      return;
    }

    // Build HTML
    let html = '';
    if (tooltip.title && tooltip.title.length) {
      html += `<div class="ct-title">${tooltip.title[0]}</div>`;
    }
    if (tooltip.body) {
      const bodyLines = tooltip.body.map(b => b.lines);
      bodyLines.forEach((lines, i) => {
        const colors = tooltip.labelColors[i];
        const color = colors.borderColor || colors.backgroundColor;
        lines.forEach(line => {
          const parts = line.split(':');
          const label = parts[0].trim();
          const value = parts.length > 1 ? parts.slice(1).join(':').trim() : '';
          html += `<div class="ct-row">
            <span class="ct-dot" style="background:${color}"></span>
            <span class="ct-label">${label}</span>
            ${value ? `<span class="ct-value">${value}</span>` : ''}
          </div>`;
        });
      });
    }
    el.innerHTML = html;

    // Position
    const { offsetLeft, offsetTop } = chart.canvas;
    const tooltipWidth = el.offsetWidth;
    const chartWidth = chart.canvas.offsetWidth;
    let left = offsetLeft + tooltip.caretX;

    // Prevent overflow right
    if (left + tooltipWidth / 2 > chartWidth) {
      left = chartWidth - tooltipWidth / 2 - 8;
    }
    // Prevent overflow left
    if (left - tooltipWidth / 2 < 0) {
      left = tooltipWidth / 2 + 8;
    }

    el.style.opacity = '1';
    el.style.pointerEvents = 'none';
    el.style.left = left + 'px';
    el.style.top = (offsetTop + tooltip.caretY) + 'px';
  },

  // Default Chart.js config
  defaults() {
    Chart.defaults.font.family = "'Inter', sans-serif";
    Chart.defaults.font.size = 12;
    Chart.defaults.color = '#71717a';
    Chart.defaults.plugins.legend.display = false;
    // Disable default tooltip — use external HTML tooltip
    Chart.defaults.plugins.tooltip.enabled = false;
    Chart.defaults.plugins.tooltip.external = (ctx) => this.externalTooltip(ctx);
    Chart.defaults.scale.grid.color = 'rgba(28, 28, 30, 0.8)';
    Chart.defaults.scale.grid.drawBorder = false;
    Chart.defaults.scale.ticks.padding = 8;
  },

  // Destroy existing chart
  destroy(id) {
    if (this.instances[id]) {
      this.instances[id].destroy();
      delete this.instances[id];
    }
  },

  // Destroy all
  destroyAll() {
    Object.keys(this.instances).forEach(id => this.destroy(id));
  },

  // Create gradient fill
  gradient(ctx, color, height = 280) {
    const g = ctx.createLinearGradient(0, 0, 0, height);
    g.addColorStop(0, color.replace(')', ', 0.25)').replace('rgb', 'rgba'));
    g.addColorStop(1, color.replace(')', ', 0.0)').replace('rgb', 'rgba'));
    return g;
  },

  gradientFromHex(ctx, hex, height = 280) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, `rgba(${r},${g},${b},0.2)`);
    grad.addColorStop(1, `rgba(${r},${g},${b},0.0)`);
    return grad;
  },

  // Crosshair plugin (vertical line on hover)
  crosshairPlugin: {
    id: 'crosshair',
    afterDraw(chart) {
      if (chart.tooltip?._active?.length) {
        const activePoint = chart.tooltip._active[0];
        const ctx = chart.ctx;
        const x = activePoint.element.x;
        const topY = chart.scales.y.top;
        const bottomY = chart.scales.y.bottom;

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(x, topY);
        ctx.lineTo(x, bottomY);
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(59, 130, 246, 0.15)';
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.restore();
      }
    }
  },

  // Overview line chart (leads + emails + opens)
  overviewLine(canvasId, data) {
    this.destroy(canvasId);
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const labels = data.map(d => {
      const date = new Date(d.date);
      return date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
    });

    this.instances[canvasId] = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Leads',
            data: data.map(d => d.leads),
            borderColor: '#3b82f6',
            backgroundColor: this.gradientFromHex(ctx, '#3b82f6'),
            fill: true,
            tension: 0.4,
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 5,
            pointHoverBackgroundColor: '#3b82f6',
            pointHoverBorderColor: '#fff',
            pointHoverBorderWidth: 2
          },
          {
            label: 'Emails envoyés',
            data: data.map(d => d.emailsSent),
            borderColor: '#8b5cf6',
            backgroundColor: 'transparent',
            fill: false,
            tension: 0.4,
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 5,
            pointHoverBackgroundColor: '#8b5cf6',
            pointHoverBorderColor: '#fff',
            pointHoverBorderWidth: 2
          },
          {
            label: 'Emails ouverts',
            data: data.map(d => d.emailsOpened),
            borderColor: '#22c55e',
            backgroundColor: 'transparent',
            fill: false,
            tension: 0.4,
            borderWidth: 2,
            borderDash: [5, 5],
            pointRadius: 0,
            pointHoverRadius: 5,
            pointHoverBackgroundColor: '#22c55e',
            pointHoverBorderColor: '#fff',
            pointHoverBorderWidth: 2
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' },
        plugins: {
          legend: {
            display: true,
            position: 'top',
            align: 'end',
            labels: {
              usePointStyle: true,
              pointStyle: 'circle',
              padding: 16,
              font: { size: 11 }
            }
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { maxTicksLimit: 10 } },
          y: { beginAtZero: true, ticks: { maxTicksLimit: 5 } }
        }
      },
      plugins: [this.crosshairPlugin]
    });
  },

  // Bar chart
  barChart(canvasId, labels, data, color = '#3b82f6', label = '') {
    this.destroy(canvasId);
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    this.instances[canvasId] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label,
          data,
          backgroundColor: color + '40',
          borderColor: color,
          borderWidth: 1,
          borderRadius: 4,
          borderSkipped: false
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { maxTicksLimit: 10 } },
          y: { beginAtZero: true, ticks: { maxTicksLimit: 5 } }
        }
      }
    });
  },

  // Area chart (open rate)
  areaChart(canvasId, labels, data, color = '#8b5cf6', label = '') {
    this.destroy(canvasId);
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    this.instances[canvasId] = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label,
          data,
          borderColor: color,
          backgroundColor: this.gradientFromHex(ctx, color),
          fill: true,
          tension: 0.4,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 5,
          pointHoverBackgroundColor: color,
          pointHoverBorderColor: '#fff',
          pointHoverBorderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' },
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { maxTicksLimit: 10 } },
          y: { beginAtZero: true, ticks: { maxTicksLimit: 5 } }
        }
      },
      plugins: [this.crosshairPlugin]
    });
  },

  // Doughnut chart (score santé)
  doughnutChart(canvasId, value, max = 100, color = '#22c55e') {
    this.destroy(canvasId);
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    this.instances[canvasId] = new Chart(ctx, {
      type: 'doughnut',
      data: {
        datasets: [{
          data: [value, max - value],
          backgroundColor: [color, 'rgba(28, 28, 30, 0.5)'],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '78%',
        plugins: { legend: { display: false }, tooltip: { enabled: false } }
      }
    });
  },

  // System gauge (CPU/RAM/Disk)
  systemGauges(canvasId, data) {
    this.destroy(canvasId);
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const labels = data.map(d => {
      const date = new Date(d.timestamp);
      return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    });

    this.instances[canvasId] = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'RAM %',
            data: data.map(d => d.ram?.percent || 0),
            borderColor: '#3b82f6',
            backgroundColor: 'transparent',
            tension: 0.3,
            borderWidth: 1.5,
            pointRadius: 0
          },
          {
            label: 'CPU %',
            data: data.map(d => d.cpu?.percent || 0),
            borderColor: '#f59e0b',
            backgroundColor: 'transparent',
            tension: 0.3,
            borderWidth: 1.5,
            pointRadius: 0
          },
          {
            label: 'Disque %',
            data: data.map(d => d.disk?.percent || 0),
            borderColor: '#22c55e',
            backgroundColor: 'transparent',
            tension: 0.3,
            borderWidth: 1.5,
            pointRadius: 0
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' },
        plugins: {
          legend: {
            display: true,
            position: 'top',
            align: 'end',
            labels: { usePointStyle: true, pointStyle: 'circle', padding: 12, font: { size: 11 } }
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { maxTicksLimit: 12 } },
          y: { beginAtZero: true, max: 100, ticks: { callback: v => v + '%', maxTicksLimit: 5 } }
        }
      },
      plugins: [this.crosshairPlugin]
    });
  },

  // Monthly revenue
  monthlyRevenue(canvasId, monthlyData) {
    this.destroy(canvasId);
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const entries = Object.entries(monthlyData).sort((a, b) => a[0].localeCompare(b[0])).slice(-12);
    const labels = entries.map(([m]) => {
      const [y, mo] = m.split('-');
      return new Date(y, mo - 1).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' });
    });
    const values = entries.map(([, v]) => v);

    this.instances[canvasId] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Revenus',
          data: values,
          backgroundColor: '#22c55e40',
          borderColor: '#22c55e',
          borderWidth: 1,
          borderRadius: 4,
          borderSkipped: false
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => Utils.formatCurrency(ctx.raw)
            }
          }
        },
        scales: {
          x: { grid: { display: false } },
          y: { beginAtZero: true, ticks: { callback: v => v + '€', maxTicksLimit: 5 } }
        }
      }
    });
  }
};

// Init defaults
Charts.defaults();
