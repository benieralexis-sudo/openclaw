#!/usr/bin/env node
// MoltBot - Reset toutes les donnees de test (one-shot)
// Usage: docker compose exec telegram-router node /app/scripts/reset-data.js

const fs = require('fs');
const path = require('path');

const now = new Date().toISOString();

const dataSets = [
  {
    name: 'flowfast',
    file: path.join(process.env.FLOWFAST_DATA_DIR || '/data/flowfast', 'flowfast-db.json'),
    data: {
      users: {},
      searches: [],
      leads: {},
      emails: [],
      stats: {
        totalSearches: 0,
        totalLeadsFound: 0,
        totalLeadsQualified: 0,
        totalLeadsPushed: 0,
        totalEmailsSent: 0,
        totalEmailsDrafted: 0,
        createdAt: now
      }
    }
  },
  {
    name: 'automailer',
    file: path.join(process.env.AUTOMAILER_DATA_DIR || '/data/automailer', 'automailer-db.json'),
    data: {
      users: {},
      contactLists: {},
      templates: {},
      campaigns: {},
      emails: [],
      stats: {
        totalCampaigns: 0,
        totalEmailsSent: 0,
        totalEmailsDelivered: 0,
        totalEmailsOpened: 0,
        totalEmailsBounced: 0,
        totalContactsImported: 0,
        totalTemplatesCreated: 0,
        createdAt: now
      }
    }
  },
  {
    name: 'crm-pilot',
    file: path.join(process.env.CRM_PILOT_DATA_DIR || '/data/crm-pilot', 'crm-pilot-db.json'),
    data: {
      users: {},
      cache: { contacts: {}, deals: {}, pipeline: null },
      activityLog: [],
      stats: {
        totalActions: 0,
        totalContactsCreated: 0,
        totalDealsCreated: 0,
        totalNotesAdded: 0,
        totalTasksCreated: 0,
        createdAt: now
      }
    }
  },
  {
    name: 'lead-enrich',
    file: path.join(process.env.LEAD_ENRICH_DATA_DIR || '/data/lead-enrich', 'lead-enrich-db.json'),
    data: {
      users: {},
      enrichedLeads: {},
      apolloUsage: {
        creditsUsed: 0,
        creditsLimit: 100,
        lastResetAt: now,
        history: []
      },
      activityLog: [],
      stats: {
        totalEnrichments: 0,
        totalHubspotEnrichments: 0,
        totalAutomailerEnrichments: 0,
        totalTelegramEnrichments: 0,
        totalScored: 0,
        createdAt: now
      }
    }
  },
  {
    name: 'content-gen',
    file: path.join(process.env.CONTENT_GEN_DATA_DIR || '/data/content-gen', 'content-gen-db.json'),
    data: {
      users: {},
      generatedContents: {},
      activityLog: [],
      stats: {
        totalGenerated: 0,
        byType: { linkedin: 0, pitch: 0, description: 0, script: 0, email: 0, bio: 0, refine: 0 },
        createdAt: now
      }
    }
  },
  {
    name: 'invoice-bot',
    file: path.join(process.env.INVOICE_BOT_DATA_DIR || '/data/invoice-bot', 'invoice-bot-db.json'),
    data: {
      users: {},
      clients: {},
      invoices: {},
      nextInvoiceNumber: 1,
      activityLog: [],
      stats: {
        totalInvoices: 0,
        totalBilled: 0,
        totalPaid: 0,
        totalPending: 0,
        createdAt: now
      }
    }
  },
  {
    name: 'proactive-agent',
    file: path.join(process.env.PROACTIVE_DATA_DIR || '/data/proactive-agent', 'proactive-agent-db.json'),
    data: {
      config: {
        enabled: false,
        adminChatId: '1409505520',
        alerts: {
          morningReport: { enabled: true, hour: 8, minute: 0 },
          pipelineAlerts: { enabled: true, hour: 9, minute: 0 },
          weeklyReport: { enabled: true, dayOfWeek: 1, hour: 9, minute: 0 },
          monthlyReport: { enabled: true, dayOfMonth: 1, hour: 9, minute: 0 },
          emailStatusCheck: { enabled: true, intervalMinutes: 30 },
          nightlyAnalysis: { enabled: true, hour: 2, minute: 0 }
        },
        thresholds: {
          stagnantDealDays: 7,
          hotLeadOpens: 3,
          dealCloseWarningDays: 3
        }
      },
      alertHistory: [],
      hotLeads: {},
      nightlyBriefing: null,
      metrics: { dailySnapshots: [], weeklySnapshots: [], monthlySnapshots: [] },
      stats: {
        totalReportsSent: 0,
        totalAlertsSent: 0,
        lastMorningReport: null,
        lastWeeklyReport: null,
        lastMonthlyReport: null,
        lastNightlyAnalysis: null,
        lastEmailCheck: null,
        createdAt: now
      }
    }
  },
  {
    name: 'self-improve',
    file: path.join(process.env.SELF_IMPROVE_DATA_DIR || '/data/self-improve', 'self-improve-db.json'),
    data: {
      config: {
        enabled: false,
        adminChatId: '1409505520',
        analysisDay: 'sunday',
        analysisHour: 21,
        autoApply: false,
        scoringWeights: null,
        emailPreferences: {
          maxLength: null,
          preferredSendHour: null,
          preferredSendDay: null
        },
        targetingCriteria: { minScore: null }
      },
      metrics: { weeklySnapshots: [], emailDetails: [] },
      analysis: {
        lastAnalysis: null,
        lastRecommendations: [],
        pendingRecommendations: [],
        appliedRecommendations: []
      },
      feedback: { predictions: [], accuracyHistory: [] },
      backups: [],
      stats: {
        totalAnalyses: 0,
        totalRecommendations: 0,
        totalApplied: 0,
        totalRollbacks: 0,
        currentAccuracy: null,
        lastAnalysisAt: null,
        createdAt: now
      }
    }
  },
  {
    name: 'web-intelligence',
    file: path.join(process.env.WEB_INTEL_DATA_DIR || '/data/web-intelligence', 'web-intelligence.json'),
    data: {
      config: {
        enabled: false,
        adminChatId: '1409505520',
        checkIntervalHours: 6,
        maxArticlesPerWatch: 50,
        maxArticlesTotal: 500,
        notifications: {
          digestEnabled: true,
          digestHour: 9,
          instantAlerts: true,
          weeklyDigest: true,
          weeklyDigestDay: 1,
          weeklyDigestHour: 9
        }
      },
      watches: {},
      articles: [],
      analyses: [],
      stats: {
        totalArticlesFetched: 0,
        totalAnalysesGenerated: 0,
        totalAlertsSent: 0,
        lastScanAt: null,
        lastDigestAt: null,
        lastWeeklyDigestAt: null,
        watchesCreated: 0,
        createdAt: now
      }
    }
  },
  {
    name: 'system-advisor',
    file: path.join(process.env.SYSTEM_ADVISOR_DATA_DIR || '/data/system-advisor', 'system-advisor.json'),
    data: {
      config: {
        enabled: false,
        adminChatId: '1409505520',
        alerts: {
          metricsCollection: { enabled: true, intervalMinutes: 5 },
          healthCheck: { enabled: true, intervalMinutes: 60 },
          dailyReport: { enabled: true, hour: 7 },
          weeklyReport: { enabled: true, dayOfWeek: 1, hour: 8 }
        },
        thresholds: {
          ramWarning: 80,
          ramCritical: 95,
          diskWarning: 80,
          diskCritical: 95,
          errorRateWarning: 10,
          inactivityHours: 24
        }
      },
      systemMetrics: { snapshots: [], hourlyAggregates: [], dailyAggregates: [] },
      skillMetrics: { usage: {}, responseTimes: {}, errors: {}, cronExecutions: [] },
      healthChecks: { history: [], lastCheck: null },
      activeAlerts: [],
      alertHistory: [],
      stats: {
        totalSnapshots: 0,
        totalHealthChecks: 0,
        totalAlertsSent: 0,
        totalReportsSent: 0,
        lastSnapshotAt: null,
        lastHealthCheckAt: null,
        lastDailyReportAt: null,
        lastWeeklyReportAt: null,
        startedAt: now,
        createdAt: now
      }
    }
  }
];

console.log('=== MoltBot Reset Data ===\n');

let success = 0;
let errors = 0;

for (const ds of dataSets) {
  try {
    const dir = path.dirname(ds.file);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(ds.file, JSON.stringify(ds.data, null, 2));
    console.log('  ✅ ' + ds.name + ' → ' + ds.file);
    success++;
  } catch (e) {
    console.log('  ❌ ' + ds.name + ' : ' + e.message);
    errors++;
  }
}

console.log('\n' + success + ' skills reset, ' + errors + ' erreurs.');
console.log('Mode standby : toutes les donnees de test supprimees.');
