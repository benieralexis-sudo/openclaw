// CRM Pilot - Client HubSpot API v3/v4 complet
const https = require('https');

const CONTACT_PROPERTIES = 'firstname,lastname,email,jobtitle,company,phone,city,lifecyclestage,hs_lead_status,createdate,lastmodifieddate';
const DEAL_PROPERTIES = 'dealname,dealstage,pipeline,amount,closedate,createdate,hs_lastmodifieddate';
const TASK_PROPERTIES = 'hs_task_subject,hs_task_body,hs_task_status,hs_task_priority,hs_timestamp,hs_task_due_date';
const NOTE_PROPERTIES = 'hs_note_body,hs_timestamp';

// Association type IDs HubSpot v4
const ASSOCIATION_TYPES = {
  note_to_contact: 202,
  note_to_deal: 214,
  task_to_contact: 204,
  task_to_deal: 216,
  deal_to_contact: 3
};

// Cache TTL simple en memoire (max 200 entrees)
const _cache = {};
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const CACHE_MAX_SIZE = 200;

function _cacheGet(key) {
  const entry = _cache[key];
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) { delete _cache[key]; return null; }
  return entry.data;
}

function _cacheSet(key, data) {
  // Eviction si cache plein : supprimer les entrees les plus anciennes
  const keys = Object.keys(_cache);
  if (keys.length >= CACHE_MAX_SIZE) {
    const sorted = keys.sort((a, b) => _cache[a].ts - _cache[b].ts);
    const toRemove = sorted.slice(0, Math.floor(CACHE_MAX_SIZE / 4));
    for (const k of toRemove) delete _cache[k];
  }
  _cache[key] = { data: data, ts: Date.now() };
}

function _cacheInvalidate(prefix) {
  for (const key of Object.keys(_cache)) {
    if (key.startsWith(prefix)) delete _cache[key];
  }
}

// Circuit breaker pour HubSpot
let _cbFailures = 0;
let _cbLastFailure = 0;
const CB_THRESHOLD = 3;
const CB_COOLDOWN = 60000;

class HubSpotClient {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this._lastRequestTime = 0;
  }

  // --- Base HTTP ---

  async makeRequest(path, method, data) {
    // Circuit breaker : fail-fast si HubSpot est down
    if (_cbFailures >= CB_THRESHOLD) {
      if (Date.now() - _cbLastFailure < CB_COOLDOWN) {
        throw new Error('HubSpot temporairement indisponible (circuit breaker)');
      }
      _cbFailures = 0; // cooldown expire, retenter
    }

    // Rate limiting simple : 100ms entre chaque requete
    const now = Date.now();
    const elapsed = now - this._lastRequestTime;
    if (elapsed < 100) {
      await new Promise(r => setTimeout(r, 100 - elapsed));
    }
    this._lastRequestTime = Date.now();

    return new Promise((resolve, reject) => {
      const postData = data ? JSON.stringify(data) : '';
      const options = {
        hostname: 'api.hubapi.com',
        path: path,
        method: method || 'GET',
        headers: {
          'Authorization': 'Bearer ' + this.apiKey,
          'Content-Type': 'application/json'
        }
      };
      if (postData && (method === 'POST' || method === 'PATCH' || method === 'PUT')) {
        options.headers['Content-Length'] = Buffer.byteLength(postData);
      }

      const req = https.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            if (res.statusCode === 204) {
              resolve({ success: true });
              return;
            }
            const response = JSON.parse(body);
            if (res.statusCode >= 200 && res.statusCode < 300) {
              _cbFailures = 0; // succes = reset circuit breaker
              resolve(response);
            } else {
              if (res.statusCode >= 500) { _cbFailures++; _cbLastFailure = Date.now(); }
              const msg = response.message || response.errors?.[0]?.message || JSON.stringify(response);
              reject(new Error('HubSpot ' + res.statusCode + ': ' + msg));
            }
          } catch (e) {
            reject(new Error('Reponse HubSpot invalide: ' + body.substring(0, 200)));
          }
        });
      });
      req.on('error', (e) => { _cbFailures++; _cbLastFailure = Date.now(); reject(e); });
      req.setTimeout(15000, () => { req.destroy(); _cbFailures++; _cbLastFailure = Date.now(); reject(new Error('Timeout HubSpot API')); });
      if (postData && (method === 'POST' || method === 'PATCH' || method === 'PUT')) {
        req.write(postData);
      }
      req.end();
    });
  }

  // --- CONTACTS ---

  async listContacts(limit, after) {
    limit = limit || 10;
    const cacheKey = 'contacts_' + limit + '_' + (after || '');
    const cached = _cacheGet(cacheKey);
    if (cached) return cached;

    let path = '/crm/v3/objects/contacts?limit=' + limit + '&properties=' + CONTACT_PROPERTIES;
    if (after) path += '&after=' + after;
    const result = await this.makeRequest(path, 'GET');
    const formatted = {
      contacts: (result.results || []).map(c => this._formatContactResult(c)),
      hasMore: !!(result.paging && result.paging.next),
      nextCursor: result.paging?.next?.after || null,
      total: result.total || 0
    };
    _cacheSet(cacheKey, formatted);
    return formatted;
  }

  async getContact(contactId) {
    const result = await this.makeRequest(
      '/crm/v3/objects/contacts/' + contactId + '?properties=' + CONTACT_PROPERTIES,
      'GET'
    );
    return this._formatContactResult(result);
  }

  async createContact(properties) {
    _cacheInvalidate('contacts_');
    const result = await this.makeRequest('/crm/v3/objects/contacts', 'POST', {
      properties: {
        firstname: properties.firstname || '',
        lastname: properties.lastname || '',
        email: properties.email,
        jobtitle: properties.jobtitle || '',
        company: properties.company || '',
        phone: properties.phone || '',
        city: properties.city || '',
        lifecyclestage: properties.lifecyclestage || 'lead'
      }
    });
    return this._formatContactResult(result);
  }

  async updateContact(contactId, properties) {
    _cacheInvalidate('contacts_');
    const result = await this.makeRequest(
      '/crm/v3/objects/contacts/' + contactId,
      'PATCH',
      { properties: properties }
    );
    return this._formatContactResult(result);
  }

  async searchContacts(query, searchBy) {
    searchBy = searchBy || 'email';
    let filterGroups;

    if (searchBy === 'email') {
      filterGroups = [{ filters: [{ propertyName: 'email', operator: 'EQ', value: query }] }];
    } else if (searchBy === 'company') {
      filterGroups = [{ filters: [{ propertyName: 'company', operator: 'CONTAINS_TOKEN', value: query }] }];
    } else {
      // Recherche par nom (firstname ou lastname)
      filterGroups = [
        { filters: [{ propertyName: 'firstname', operator: 'CONTAINS_TOKEN', value: query }] },
        { filters: [{ propertyName: 'lastname', operator: 'CONTAINS_TOKEN', value: query }] }
      ];
    }

    const result = await this.makeRequest('/crm/v3/objects/contacts/search', 'POST', {
      filterGroups: filterGroups,
      properties: CONTACT_PROPERTIES.split(','),
      limit: 20
    });
    return (result.results || []).map(c => this._formatContactResult(c));
  }

  async findContactByEmail(email) {
    const contacts = await this.searchContacts(email, 'email');
    return contacts.length > 0 ? contacts[0] : null;
  }

  _formatContactResult(result) {
    if (!result || typeof result !== 'object' || !result.properties) return null;
    const p = result.properties || {};
    return {
      id: result.id,
      firstname: p.firstname || '',
      lastname: p.lastname || '',
      name: ((p.firstname || '') + ' ' + (p.lastname || '')).trim(),
      email: p.email || '',
      jobtitle: p.jobtitle || '',
      company: p.company || '',
      phone: p.phone || '',
      city: p.city || '',
      lifecyclestage: p.lifecyclestage || '',
      leadStatus: p.hs_lead_status || '',
      createdAt: p.createdate || '',
      updatedAt: p.lastmodifieddate || ''
    };
  }

  // --- DEALS ---

  async listDeals(limit, after) {
    limit = limit || 10;
    const cacheKey = 'deals_' + limit + '_' + (after || '');
    const cached = _cacheGet(cacheKey);
    if (cached) return cached;

    let path = '/crm/v3/objects/deals?limit=' + limit + '&properties=' + DEAL_PROPERTIES;
    if (after) path += '&after=' + after;
    const result = await this.makeRequest(path, 'GET');
    const formatted = {
      deals: (result.results || []).map(d => this._formatDealResult(d)),
      hasMore: !!(result.paging && result.paging.next),
      nextCursor: result.paging?.next?.after || null,
      total: result.total || 0
    };
    _cacheSet(cacheKey, formatted);
    return formatted;
  }

  async getDeal(dealId) {
    const result = await this.makeRequest(
      '/crm/v3/objects/deals/' + dealId + '?properties=' + DEAL_PROPERTIES,
      'GET'
    );
    return this._formatDealResult(result);
  }

  async createDeal(properties) {
    _cacheInvalidate('deals_');
    const result = await this.makeRequest('/crm/v3/objects/deals', 'POST', {
      properties: {
        dealname: properties.dealname,
        dealstage: properties.dealstage || 'appointmentscheduled',
        pipeline: properties.pipeline || 'default',
        amount: properties.amount ? String(properties.amount) : '',
        closedate: properties.closedate || ''
      }
    });
    return this._formatDealResult(result);
  }

  async updateDeal(dealId, properties) {
    _cacheInvalidate('deals_');
    const result = await this.makeRequest(
      '/crm/v3/objects/deals/' + dealId,
      'PATCH',
      { properties: properties }
    );
    return this._formatDealResult(result);
  }

  async searchDeals(query) {
    const result = await this.makeRequest('/crm/v3/objects/deals/search', 'POST', {
      filterGroups: [
        { filters: [{ propertyName: 'dealname', operator: 'CONTAINS_TOKEN', value: query }] }
      ],
      properties: DEAL_PROPERTIES.split(','),
      limit: 20
    });
    return (result.results || []).map(d => this._formatDealResult(d));
  }

  _formatDealResult(result) {
    if (!result || typeof result !== 'object' || !result.properties) return null;
    const p = result.properties || {};
    return {
      id: result.id,
      name: p.dealname || '',
      stage: p.dealstage || '',
      pipeline: p.pipeline || 'default',
      amount: p.amount ? parseFloat(p.amount) : 0,
      closeDate: p.closedate || '',
      createdAt: p.createdate || '',
      updatedAt: p.hs_lastmodifieddate || ''
    };
  }

  // --- PIPELINE ---

  async getDealPipeline(pipelineId) {
    pipelineId = pipelineId || 'default';
    const result = await this.makeRequest('/crm/v3/pipelines/deals/' + pipelineId, 'GET');
    return {
      id: result.id,
      label: result.label,
      stages: (result.stages || [])
        .sort((a, b) => a.displayOrder - b.displayOrder)
        .map(s => ({
          id: s.id,
          label: s.label,
          displayOrder: s.displayOrder
        }))
    };
  }

  async listDealPipelines() {
    const result = await this.makeRequest('/crm/v3/pipelines/deals', 'GET');
    return (result.results || []).map(p => ({
      id: p.id,
      label: p.label,
      stageCount: (p.stages || []).length
    }));
  }

  // --- NOTES ---

  async createNote(noteBody) {
    const result = await this.makeRequest('/crm/v3/objects/notes', 'POST', {
      properties: {
        hs_note_body: noteBody,
        hs_timestamp: new Date().toISOString()
      }
    });
    return { id: result.id, body: noteBody };
  }

  async associateNoteToContact(noteId, contactId) {
    return this._createAssociation('notes', noteId, 'contacts', contactId, ASSOCIATION_TYPES.note_to_contact);
  }

  async associateNoteToDeal(noteId, dealId) {
    return this._createAssociation('notes', noteId, 'deals', dealId, ASSOCIATION_TYPES.note_to_deal);
  }

  // --- TACHES ---

  async createTask(properties) {
    const result = await this.makeRequest('/crm/v3/objects/tasks', 'POST', {
      properties: {
        hs_task_subject: properties.subject || '',
        hs_task_body: properties.body || '',
        hs_task_status: properties.status || 'NOT_STARTED',
        hs_task_priority: properties.priority || 'MEDIUM',
        hs_timestamp: new Date().toISOString(),
        hs_task_due_date: properties.dueDate || ''
      }
    });
    return {
      id: result.id,
      subject: properties.subject,
      dueDate: properties.dueDate
    };
  }

  async associateTaskToContact(taskId, contactId) {
    return this._createAssociation('tasks', taskId, 'contacts', contactId, ASSOCIATION_TYPES.task_to_contact);
  }

  async associateTaskToDeal(taskId, dealId) {
    return this._createAssociation('tasks', taskId, 'deals', dealId, ASSOCIATION_TYPES.task_to_deal);
  }

  async listTasks(limit) {
    limit = limit || 10;
    const result = await this.makeRequest(
      '/crm/v3/objects/tasks?limit=' + limit + '&properties=' + TASK_PROPERTIES,
      'GET'
    );
    return (result.results || []).map(t => ({
      id: t.id,
      subject: t.properties.hs_task_subject || '',
      body: t.properties.hs_task_body || '',
      status: t.properties.hs_task_status || '',
      priority: t.properties.hs_task_priority || '',
      dueDate: t.properties.hs_task_due_date || '',
      createdAt: t.properties.hs_timestamp || ''
    }));
  }

  // --- ASSOCIATIONS (v4) ---

  async _createAssociation(fromType, fromId, toType, toId, typeId) {
    return this.makeRequest(
      '/crm/v4/objects/' + fromType + '/' + fromId + '/associations/' + toType + '/' + toId,
      'PUT',
      [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: typeId }]
    );
  }

  async associateDealToContact(dealId, contactId) {
    return this._createAssociation('deals', dealId, 'contacts', contactId, ASSOCIATION_TYPES.deal_to_contact);
  }

  async getContactDeals(contactId) {
    const result = await this.makeRequest(
      '/crm/v3/objects/contacts/' + contactId + '/associations/deals',
      'GET'
    );
    if (!result || !result.results) return [];
    const dealIds = result.results.map(r => r.toObjectId || r.id);
    const deals = [];
    for (const dealId of dealIds) {
      try {
        const deal = await this.getDeal(dealId);
        if (deal) deals.push(deal);
      } catch (e) { /* skip */ }
    }
    return deals;
  }

  async advanceDealStage(contactId, targetStage, triggerLabel) {
    const deals = await this.getContactDeals(contactId);
    const STAGE_ORDER = ['appointmentscheduled', 'qualifiedtobuy', 'presentationscheduled', 'decisionmakerboughtin', 'contractsent', 'closedwon', 'closedlost'];
    const targetIdx = STAGE_ORDER.indexOf(targetStage);
    let advanced = 0;
    for (const deal of deals) {
      const currentIdx = STAGE_ORDER.indexOf(deal.stage);
      if (currentIdx >= 0 && currentIdx < targetIdx && deal.stage !== 'closedwon' && deal.stage !== 'closedlost') {
        await this.updateDeal(deal.id, { dealstage: targetStage });
        advanced++;
      }
    }
    return advanced;
  }
}

module.exports = HubSpotClient;
