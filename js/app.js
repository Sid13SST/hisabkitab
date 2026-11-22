/* HisabKitab UI layer. All business rules come from window.Logic (js/logic.js).
 * This file only handles storage, routing, rendering and user input. */
(function () {
  'use strict';

  const L = window.Logic;
  const STORE_KEY = 'hisabkitab.store.v1';
  const HORIZONS = [30, 60, 90];

  // ---------- tiny utils ----------

  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
  const money = (n) => L.formatINR(n);
  const fdate = (ymd) => (ymd ? L.formatDate(ymd) : '-');
  const now = () => new Date();
  const todayStr = () => L.todayYmd(now());

  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ESC[c]);

  const uid = (prefix) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  function relDays(ymd) {
    const d = L.diffDays(ymd, todayStr());
    if (d === 0) return 'today';
    if (d === 1) return 'tomorrow';
    if (d === -1) return 'yesterday';
    return d > 0 ? `in ${d} days` : `${-d} days ago`;
  }

  // Accepts "98765 43210", "+91 9876543210", "09876543210" -> "9876543210" or null.
  function normalisePhone(raw) {
    let digits = String(raw || '').replace(/\D/g, '');
    if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
    if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
    return /^[6-9]\d{9}$/.test(digits) ? digits : null;
  }

  const fmtPhone = (p) => (p && p.length === 10 ? `${p.slice(0, 5)} ${p.slice(5)}` : p || '-');

  // ---------- storage ----------

  function freshStore() {
    const s = window.SampleData.generate(now());
    s.pristine = true; // untouched sample data: safe to regenerate for a new day
    s.generatedOn = todayStr();
    return s;
  }

  function isValidStore(s) {
    return s && Array.isArray(s.customers) && Array.isArray(s.invoices) && Array.isArray(s.bills) && s.settings;
  }

  function loadStore() {
    let s = null;
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) s = JSON.parse(raw);
    } catch (e) {
      s = null;
    }
    if (!isValidStore(s)) return freshStore();
    // Keep the demo fresh: untouched sample data is re-anchored to today.
    if (s.pristine && s.generatedOn !== todayStr()) {
      const f = freshStore();
      f.settings = Object.assign(f.settings, s.settings);
      return f;
    }
    s.seenAlertIds = Array.isArray(s.seenAlertIds) ? s.seenAlertIds : [];
    s.settings.openingCash = Number(s.settings.openingCash) || 0;
    if (!HORIZONS.includes(s.settings.horizonDays)) s.settings.horizonDays = 90;
    return s;
  }

  let store = loadStore();

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(store));
    } catch (e) {
      toast('Could not save: browser storage is unavailable');
    }
  }

  // Data changed by the user (not just a setting): stop auto-refreshing the sample.
  function commit() {
    store.pristine = false;
    save();
  }

  const findCustomer = (id) => store.customers.find((c) => c.id === id);
  const findInvoice = (id) => store.invoices.find((i) => i.id === id);
  const findBill = (id) => store.bills.find((b) => b.id === id);

  function nextInvoiceNumber() {
    const max = store.invoices.reduce((m, inv) => {
      const n = parseInt(String(inv.number).match(/(\d+)\s*$/)?.[1] || '0', 10);
      return Math.max(m, n);
    }, 100);
    return `HK-${String(max + 1).padStart(4, '0')}`;
  }

  // ---------- derived data (always via Logic) ----------

  function currentAlerts() {
    return L.alerts(store.invoices, store.bills, store.customers, {
      today: now(),
      openingCash: store.settings.openingCash,
      forecastHorizonDays: 90,
    });
  }

  function receivablesMap() {
    const map = new Map();
    L.receivablesByCustomer(store.invoices, store.customers, now()).forEach((r) => map.set(r.customerId, r));
    return map;
  }

  // ---------- UI state (not persisted) ----------

  const ui = {
    invoiceFilter: 'open',
    scenario: { customerId: null, delayDays: 15, active: false },
    lastRoute: null,
  };

  // ---------- toast ----------

  let toastTimer = null;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.hidden = true;
    }, 2400);
  }

  // ---------- small render helpers ----------

  function statusChip(inv) {
    const st = L.invoiceStatus(inv);
    return `<span class="chip chip-${st}">${st}</span>`;
  }

  function extraChips(inv) {
    let out = '';
    if (L.isOverdue(inv, now())) out += ` <span class="chip chip-overdue">${L.daysOverdue(inv, now())}d overdue</span>`;
    if (inv.sent === false && L.invoiceBalance(inv) > 0) out += ' <span class="chip chip-neutral">not sent</span>';
    return out;
  }

  function stat(label, value, sub, tone = '') {
    return `<div class="stat ${tone}"><div class="stat-label">${esc(label)}</div>
      <div class="stat-value">${value}</div>${sub ? `<div class="stat-sub">${sub}</div>` : ''}</div>`;
  }

  const AGE_CLASS = { current: 'age-current', '1-30': 'age-1-30', '31-60': 'age-31-60', '61-90': 'age-61-90', '90+': 'age-90' };

  function notFound(what, back) {
    return `<div class="card empty"><h2>${esc(what)} not found</h2><p>It may have been deleted, or the data was reset.</p>
      <a class="btn" href="${back}">Go back</a></div>`;
  }

  function invoiceRows(list, { showCustomer = true } = {}) {
    if (!list.length) return `<div class="empty">No invoices here.</div>`;
    const rows = list
      .map((inv) => {
        const c = findCustomer(inv.customerId);
        return `<tr class="clickable" data-href="#/invoices/${esc(inv.id)}">
          <td><a class="strong" href="#/invoices/${esc(inv.id)}">${esc(inv.number)}</a></td>
          ${showCustomer ? `<td>${esc(c ? c.name : 'Unknown')}</td>` : ''}
          <td class="nowrap hide-sm">${fdate(inv.issueDate)}</td>
          <td class="nowrap">${fdate(inv.dueDate)}</td>
          <td class="num hide-sm">${money(L.invoiceTotal(inv))}</td>
          <td class="num">${money(L.invoiceBalance(inv))}</td>
          <td>${statusChip(inv)}${extraChips(inv)}</td>
        </tr>`;
      })
      .join('');
    return `<div class="table-wrap"><table>
      <thead><tr><th>Invoice</th>${showCustomer ? '<th>Customer</th>' : ''}<th class="hide-sm">Issued</th><th>Due</th>
      <th class="num hide-sm">Total</th><th class="num">Balance</th><th>Status</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
  }

  function alertItem(a, isNew) {
    return `<div class="alert sev-${esc(a.severity)}">
      <div class="body">
        <div class="sev">${a.severity === 'info' ? 'FYI' : esc(a.severity)}${isNew ? '<span class="new-dot" title="New"></span>' : ''}</div>
        <div class="title">${esc(a.title)}</div>
        ${a.detail ? `<div class="detail">${esc(a.detail)}</div>` : ''}
      </div>
      <a class="btn btn-sm" href="${esc(a.route)}">${esc(a.actionLabel)}</a>
    </div>`;
  }

  // ---------- views ----------

  function viewDashboard() {
    const today = now();
    const tot = L.dashboardTotals(store.invoices, store.bills, today);
    const aging = L.agingSummary(store.invoices, store.customers, today).buckets;
    const rows = L.receivablesByCustomer(store.invoices, store.customers, today);
    const fc30 = L.forecast({
      horizonDays: 30,
      openingCash: store.settings.openingCash,
      invoices: store.invoices,
      bills: store.bills,
      customers: store.customers,
      today,
    });
    const alerts = currentAlerts();
    const overduePct = tot.receivable ? Math.round((tot.overdue / tot.receivable) * 100) : 0;

    const totalAging = L.AGING_BUCKETS.reduce((s, b) => s + aging[b.key].amount, 0);
    const bar = L.AGING_BUCKETS.filter((b) => aging[b.key].amount > 0)
      .map((b) => {
        const pct = (aging[b.key].amount / totalAging) * 100;
        return `<span class="${AGE_CLASS[b.key]}" style="width:${pct.toFixed(2)}%" title="${esc(b.label)}: ${esc(money(aging[b.key].amount))}"></span>`;
      })
      .join('');
    const agingItems = L.AGING_BUCKETS.map((b) => {
      const bk = aging[b.key];
      const custs = bk.customers
        .slice(0, 4)
        .map((c) => `<li><a href="#/customers/${esc(c.customerId)}">${esc(c.name)}</a><span class="num">${money(c.amount)}</span></li>`)
        .join('');
      const more = bk.customers.length > 4 ? `<li>+${bk.customers.length - 4} more</li>` : '';
      return `<div class="aging-item">
        <div class="small"><span class="dot ${AGE_CLASS[b.key]}"></span>${esc(b.label)}</div>
        <div class="amt">${money(bk.amount)}</div>
        <div class="small muted">${bk.count} invoice${bk.count === 1 ? '' : 's'}</div>
        ${custs || more ? `<ul>${custs}${more}</ul>` : ''}
      </div>`;
    }).join('');

    const recRows = rows
      .map(
        (r) => `<tr class="clickable" data-href="#/customers/${esc(r.customerId)}">
        <td><a class="strong" href="#/customers/${esc(r.customerId)}">${esc(r.name)}</a></td>
        <td class="num">${money(r.outstanding)}</td>
        <td class="num ${r.overdue > 0 ? 'neg' : 'muted'}">${money(r.overdue)}</td>
        <td class="nowrap">${fdate(r.oldestUnpaidDate)} <span class="muted small">· ${r.oldestDays} days</span></td>
        <td class="num">${r.openInvoiceCount}</td>
      </tr>`
      )
      .join('');

    const greet = now().getHours() < 12 ? 'Suprabhat' : 'Namaste';

    return `
      <div class="page-head">
        <div><h1>${greet} 🙏</h1><p class="muted">Who owes you, how much, and since when · ${esc(fdate(todayStr()))}</p></div>
        <div class="row"><a class="btn" href="#/invoices/new">+ New invoice</a></div>
      </div>
      <div class="stats">
        ${stat('Total receivable (kul udhaar)', money(tot.receivable), `${rows.length} customer${rows.length === 1 ? '' : 's'} owe you`)}
        ${stat('Overdue', money(tot.overdue), `${overduePct}% of receivable`, tot.overdue > 0 ? 'bad' : '')}
        ${stat('Expected in next 30 days', money(tot.dueNext30), 'by expected payment date', 'info')}
        ${stat('Bills due in next 30 days', money(tot.billsNext30), '<a href="#/bills">View bills</a>', 'warn')}
        ${stat('Cash in 30 days (projected)', `<span class="${fc30.endingCash < 0 ? 'neg' : ''}">${money(fc30.endingCash)}</span>`, `<a href="#/forecast">Lowest ${money(fc30.lowestCash)}</a>`, fc30.negativeWeeks.length ? 'bad' : '')}
      </div>

      <section class="card">
        <div class="card-head"><h2>Aging: how old is the udhaar?</h2><span class="muted small">${money(totalAging)} open</span></div>
        ${totalAging > 0 ? `<div class="aging-bar" role="img" aria-label="Receivables by age">${bar}</div>` : ''}
        <div class="aging-list">${agingItems}</div>
      </section>

      <div class="grid-2">
        <section class="card" style="grid-column: 1 / -1">
          <div class="card-head"><h2>Who owes me</h2><a class="small" href="#/customers">All customers</a></div>
          ${rows.length ? `<div class="table-wrap"><table>
            <thead><tr><th>Customer</th><th class="num">Outstanding</th><th class="num">Overdue</th><th>Oldest unpaid</th><th class="num">Open</th></tr></thead>
            <tbody>${recRows}</tbody></table></div>` : '<div class="empty">Nobody owes you anything. Badhai ho! 🎉</div>'}
        </section>
      </div>

      <section class="card">
        <div class="card-head"><h2>Today's to-do</h2><a class="small" href="#/alerts">All ${alerts.length} alerts</a></div>
        ${alerts.length ? alerts.slice(0, 4).map((a) => alertItem(a, false)).join('') : '<div class="empty">Sab theek hai. Nothing urgent today.</div>'}
      </section>`;
  }

  // ----- customers -----

  function customerForm(c) {
    return `<form data-form="customer" class="card" novalidate>
      <h2>${c ? 'Edit customer' : 'Add customer'}</h2>
      ${c ? `<input type="hidden" name="id" value="${esc(c.id)}">` : ''}
      <div class="form-grid">
        <label class="field">Name<input name="name" required maxlength="80" value="${esc(c ? c.name : '')}" placeholder="e.g. Sharma General Store" autocomplete="off"></label>
        <label class="field">Phone (10 digits)<input name="phone" required inputmode="tel" maxlength="16" value="${esc(c ? c.phone : '')}" placeholder="98765 43210" autocomplete="off"></label>
      </div>
      <div class="error" data-error hidden></div>
      <div class="form-actions">
        <button class="btn" type="submit">${c ? 'Save changes' : 'Add customer'}</button>
        <a class="btn btn-ghost" href="${c ? `#/customers/${esc(c.id)}` : '#/customers'}">Cancel</a>
      </div>
    </form>`;
  }

  function viewCustomers() {
    const rec = receivablesMap();
    const list = store.customers.slice().sort((a, b) => {
      const oa = rec.get(a.id)?.outstanding || 0;
      const ob = rec.get(b.id)?.outstanding || 0;
      return ob - oa || a.name.localeCompare(b.name);
    });
    const rows = list
      .map((c) => {
        const r = rec.get(c.id);
        return `<tr class="clickable" data-href="#/customers/${esc(c.id)}">
          <td><a class="strong" href="#/customers/${esc(c.id)}">${esc(c.name)}</a></td>
          <td class="nowrap"><a href="tel:+91${esc(c.phone)}">${esc(fmtPhone(c.phone))}</a></td>
          <td class="num">${r ? money(r.outstanding) : '<span class="muted">₹0</span>'}</td>
          <td class="num ${r && r.overdue ? 'neg' : 'muted'} hide-sm">${money(r ? r.overdue : 0)}</td>
          <td class="num hide-sm">${r ? r.openInvoiceCount : 0}</td>
          <td class="nowrap hide-sm">${r && r.lastPaymentDate ? fdate(r.lastPaymentDate) : '<span class="muted">-</span>'}</td>
        </tr>`;
      })
      .join('');
    return `
      <div class="page-head">
        <div><h1>Customers</h1><p class="muted">${store.customers.length} customers · udhaar khata</p></div>
        <a class="btn" href="#/customers/new">+ Add customer</a>
      </div>
      <section class="card">
        ${store.customers.length ? `<div class="table-wrap"><table>
          <thead><tr><th>Name</th><th>Phone</th><th class="num">Outstanding</th><th class="num hide-sm">Overdue</th><th class="num hide-sm">Open inv.</th><th class="hide-sm">Last payment</th></tr></thead>
          <tbody>${rows}</tbody></table></div>` : '<div class="empty">No customers yet. Add your first one.</div>'}
      </section>`;
  }

  function viewCustomerNew() {
    return `<a class="back" href="#/customers">← Customers</a>${customerForm(null)}`;
  }

  function viewCustomerDetail(id, editing) {
    const c = findCustomer(id);
    if (!c) return notFound('Customer', '#/customers');
    if (editing) return `<a class="back" href="#/customers/${esc(c.id)}">← ${esc(c.name)}</a>${customerForm(c)}`;
    const r = receivablesMap().get(c.id);
    const invs = store.invoices.filter((i) => i.customerId === c.id).sort((a, b) => (a.issueDate < b.issueDate ? 1 : -1));
    const lifetime = invs.reduce((s, i) => s + L.invoiceTotal(i), 0);
    const oldestOpen = invs
      .filter((i) => L.invoiceBalance(i) > 0)
      .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))[0];
    return `
      <a class="back" href="#/customers">← Customers</a>
      <div class="page-head">
        <div><h1>${esc(c.name)}</h1>
          <p class="muted"><a href="tel:+91${esc(c.phone)}">${esc(fmtPhone(c.phone))}</a> · ${invs.length} invoice${invs.length === 1 ? '' : 's'}</p></div>
        <div class="row">
          <a class="btn btn-ghost" href="#/customers/${esc(c.id)}/edit">Edit</a>
          <a class="btn" href="#/invoices/new?customer=${encodeURIComponent(c.id)}">+ New invoice</a>
        </div>
      </div>
      <div class="stats">
        ${stat('Outstanding', money(r ? r.outstanding : 0), r ? `${r.openInvoiceCount} open invoice${r.openInvoiceCount === 1 ? '' : 's'}` : 'All clear')}
        ${stat('Overdue', money(r ? r.overdue : 0), r && r.overdue ? 'needs a follow-up' : '', r && r.overdue ? 'bad' : '')}
        ${stat('Owing since', r ? fdate(r.oldestUnpaidDate) : '-', r ? `${r.oldestDays} days` : '', 'info')}
        ${stat('Last payment', r && r.lastPaymentDate ? fdate(r.lastPaymentDate) : '-', r && r.lastPaymentDate ? relDays(r.lastPaymentDate) : 'no payments yet', 'warn')}
        ${stat('Lifetime billed', money(lifetime), '')}
      </div>
      ${oldestOpen ? `<div class="banner banner-note"><strong>Follow up</strong>Oldest open invoice is <a href="#/invoices/${esc(oldestOpen.id)}">${esc(oldestOpen.number)}</a> (${money(L.invoiceBalance(oldestOpen))}). Open it to draft a WhatsApp reminder.</div>` : ''}
      <section class="card"><h2>Invoices</h2>${invoiceRows(invs, { showCustomer: false })}</section>`;
  }

  // ----- invoices -----

  const INVOICE_FILTERS = [
    ['open', 'Open'],
    ['overdue', 'Overdue'],
    ['unsent', 'Not sent'],
    ['paid', 'Paid'],
    ['all', 'All'],
  ];

  function filterInvoices(key) {
    const today = now();
    const list = store.invoices.slice().sort((a, b) => (a.issueDate < b.issueDate ? 1 : a.issueDate > b.issueDate ? -1 : 0));
    switch (key) {
      case 'open':
        return list.filter((i) => L.invoiceBalance(i) > 0);
      case 'overdue':
        return list.filter((i) => L.isOverdue(i, today)).sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
      case 'unsent':
        return list.filter((i) => i.sent === false);
      case 'paid':
        return list.filter((i) => L.invoiceStatus(i) === 'paid');
      default:
        return list;
    }
  }

  function viewInvoices() {
    const list = filterInvoices(ui.invoiceFilter);
    const counts = Object.fromEntries(INVOICE_FILTERS.map(([k]) => [k, filterInvoices(k).length]));
    const openBal = list.reduce((s, i) => s + L.invoiceBalance(i), 0);
    return `
      <div class="page-head">
        <div><h1>Invoices</h1><p class="muted">${store.invoices.length} invoices · ${money(openBal)} balance in this view</p></div>
        <a class="btn" href="#/invoices/new">+ New invoice</a>
      </div>
      <div class="filters" role="group" aria-label="Filter invoices">
        ${INVOICE_FILTERS.map(
          ([k, label]) =>
            `<button type="button" data-action="filter" data-filter="${k}" class="${ui.invoiceFilter === k ? 'active' : ''}" aria-pressed="${ui.invoiceFilter === k}">${label} (${counts[k]})</button>`
        ).join('')}
      </div>
      <section class="card">${invoiceRows(list)}</section>`;
  }

  function lineItemRow(item = { description: '', qty: 1, rate: '' }) {
    return `<tr data-line>
      <td><input name="desc" list="item-list" value="${esc(item.description)}" placeholder="e.g. Sugar, 50 kg bag" aria-label="Description" autocomplete="off"></td>
      <td class="qty"><input name="qty" type="number" min="0" step="any" inputmode="decimal" value="${esc(item.qty)}" aria-label="Quantity"></td>
      <td class="rate"><input name="rate" type="number" min="0" step="any" inputmode="decimal" value="${esc(item.rate)}" placeholder="₹" aria-label="Rate"></td>
      <td class="amt num" data-amt>${money(Number(item.qty) * Number(item.rate) || 0)}</td>
      <td class="rm"><button type="button" class="btn btn-danger btn-sm" data-action="remove-item" aria-label="Remove item">✕</button></td>
    </tr>`;
  }

  function viewInvoiceNew(query) {
    if (!store.customers.length) {
      return `<div class="card empty"><h2>Add a customer first</h2><p>Invoices belong to a customer.</p><a class="btn" href="#/customers/new">+ Add customer</a></div>`;
    }
    const pre = query.get('customer');
    const t = todayStr();
    const opts = store.customers
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => `<option value="${esc(c.id)}" ${c.id === pre ? 'selected' : ''}>${esc(c.name)}</option>`)
      .join('');
    const items = window.SampleData && window.SampleData.ITEMS ? Object.values(window.SampleData.ITEMS) : [];
    return `
      <a class="back" href="#/invoices">← Invoices</a>
      <form data-form="invoice" class="card" novalidate>
        <h2>New invoice</h2>
        <div class="form-grid">
          <label class="field">Customer<select name="customerId" required><option value="">Choose customer…</option>${opts}</select></label>
          <label class="field">Invoice number<input name="number" required value="${esc(nextInvoiceNumber())}"></label>
          <label class="field">Issue date<input type="date" name="issueDate" required value="${t}"></label>
          <label class="field">Due date<input type="date" name="dueDate" required value="${L.addDays(t, 15)}"></label>
          <label class="field">Expected payment (optional)<input type="date" name="expectedPaymentDate" title="When you actually expect the money. Used by the cash forecast. Leave empty to use the due date."></label>
        </div>
        <h3 style="margin-top:16px">Items</h3>
        <div class="table-wrap"><table class="line-items">
          <thead><tr><th>Description</th><th>Qty</th><th>Rate</th><th class="num">Amount</th><th></th></tr></thead>
          <tbody data-lines>${lineItemRow()}</tbody>
        </table></div>
        <datalist id="item-list">${items.map(([d, r]) => `<option value="${esc(d)}" data-rate="${r}"></option>`).join('')}</datalist>
        <button type="button" class="btn btn-ghost btn-sm" data-action="add-item">+ Add item</button>
        <div class="total-line"><span class="muted">Total</span><span data-total>${money(0)}</span></div>
        <label class="check" style="margin-top:10px"><input type="checkbox" name="sent"> Already sent / handed to customer</label>
        <div class="error" data-error hidden></div>
        <div class="form-actions">
          <button class="btn" type="submit">Create invoice</button>
          <a class="btn btn-ghost" href="#/invoices">Cancel</a>
        </div>
      </form>`;
  }

  function readLineItems(form) {
    return $$('[data-line]', form).map((tr) => ({
      description: $('[name=desc]', tr).value.trim(),
      qty: Number($('[name=qty]', tr).value),
      rate: Number($('[name=rate]', tr).value),
    }));
  }

  function refreshInvoiceTotals(form) {
    $$('[data-line]', form).forEach((tr) => {
      const qty = Number($('[name=qty]', tr).value) || 0;
      const rate = Number($('[name=rate]', tr).value) || 0;
      $('[data-amt]', tr).textContent = money(L.invoiceTotal({ lineItems: [{ qty, rate }] }));
    });
    $('[data-total]', form).textContent = money(L.invoiceTotal({ lineItems: readLineItems(form) }));
  }

  function viewInvoiceDetail(id) {
    const inv = findInvoice(id);
    if (!inv) return notFound('Invoice', '#/invoices');
    const today = now();
    const c = findCustomer(inv.customerId);
    const total = L.invoiceTotal(inv);
    const paid = L.invoicePaid(inv);
    const balance = L.invoiceBalance(inv);
    const overdueDays = L.daysOverdue(inv, today);

    const items = (inv.lineItems || [])
      .map(
        (li) => `<tr><td>${esc(li.description)}</td><td class="num">${esc(li.qty)}</td><td class="num">${money(li.rate)}</td>
        <td class="num">${money(L.invoiceTotal({ lineItems: [li] }))}</td></tr>`
      )
      .join('');

    const payments = (inv.payments || [])
      .map(
        (p, idx) => `<tr><td class="nowrap">${fdate(p.date)}</td><td>${esc(p.mode || '-')}</td><td class="num">${money(p.amount)}</td>
        <td class="num"><button type="button" class="btn btn-danger btn-sm" data-action="delete-payment" data-index="${idx}" title="Remove this payment">Remove</button></td></tr>`
      )
      .join('');

    let followup = '';
    if (balance > 0 && c) {
      const text = L.reminderText(inv, c, today);
      followup = `<section class="card followup">
        <div class="card-head"><h2>Assisted follow-up</h2><span class="muted small">Draft reminder for ${esc(c.name)}</span></div>
        <textarea readonly rows="4" data-reminder aria-label="Drafted reminder">${esc(text)}</textarea>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" data-action="copy-reminder">Copy message</button>
          <a class="btn btn-wa" href="${esc(L.whatsappUrl(c.phone, text))}" target="_blank" rel="noopener noreferrer">Open in WhatsApp</a>
          <a class="btn btn-ghost" href="tel:+91${esc(c.phone)}">Call ${esc(fmtPhone(c.phone))}</a>
        </div>
        <p class="note">This only opens <strong>your own</strong> WhatsApp with the text filled in. You check it and press send. HisabKitab never sends anything by itself.</p>
      </section>`;
    }

    return `
      <a class="back" href="#/invoices">← Invoices</a>
      <div class="page-head">
        <div><h1>${esc(inv.number)} ${statusChip(inv)}${extraChips(inv)}</h1>
          <p class="muted">${c ? `<a href="#/customers/${esc(c.id)}">${esc(c.name)}</a>` : 'Unknown customer'} · issued ${fdate(inv.issueDate)}</p></div>
        <div class="row">
          ${inv.sent === false ? '<button type="button" class="btn" data-action="mark-sent">Mark sent</button>' : '<span class="chip chip-info">✓ Sent</span>'}
        </div>
      </div>

      <div class="grid-2">
        <section class="card">
          <h2>Summary</h2>
          <dl class="kv">
            <dt>Issue date</dt><dd>${fdate(inv.issueDate)}</dd>
            <dt>Due date</dt><dd>${fdate(inv.dueDate)} <span class="muted small">(${relDays(inv.dueDate)})</span></dd>
            <dt>Expected payment</dt><dd>${inv.expectedPaymentDate ? `${fdate(inv.expectedPaymentDate)} <span class="muted small">(${relDays(inv.expectedPaymentDate)})</span>` : '<span class="muted">same as due date</span>'}</dd>
            <dt>Overdue</dt><dd>${overdueDays > 0 ? `<span class="neg">${overdueDays} days</span>` : 'No'}</dd>
          </dl>
          <div class="money-summary">
            <div><div class="lbl">Total</div><div class="val">${money(total)}</div></div>
            <div><div class="lbl">Paid</div><div class="val pos">${money(paid)}</div></div>
            <div><div class="lbl">Balance</div><div class="val ${balance > 0 ? 'neg' : ''}">${money(balance)}</div></div>
          </div>
        </section>
        ${followup || `<section class="card"><h2>All paid ✓</h2><p class="muted">This invoice is fully settled. Dhanyavaad!</p></section>`}
      </div>

      <section class="card">
        <h2>Items</h2>
        <div class="table-wrap"><table>
          <thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead>
          <tbody>${items}</tbody>
          <tfoot><tr><td colspan="3">Total</td><td class="num">${money(total)}</td></tr></tfoot>
        </table></div>
      </section>

      <div class="grid-2">
        <section class="card">
          <h2>Payments</h2>
          ${payments ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Mode</th><th class="num">Amount</th><th></th></tr></thead><tbody>${payments}</tbody></table></div>` : '<p class="muted">No payments yet.</p>'}
          ${balance > 0 ? `<form data-form="payment" novalidate style="margin-top:12px">
            <h3>Record payment</h3>
            <div class="form-grid">
              <label class="field">Amount (₹)<input name="amount" type="number" min="0" step="any" inputmode="decimal" value="${balance}" required></label>
              <label class="field">Date<input name="date" type="date" value="${todayStr()}" max="${todayStr()}" required></label>
              <label class="field">Mode<select name="mode"><option>Cash</option><option>UPI</option><option>Bank transfer</option><option>Cheque</option></select></label>
            </div>
            <div class="error" data-error hidden></div>
            <div class="form-actions"><button class="btn" type="submit">Record payment</button></div>
            <p class="muted small">Partial payments are fine. Enter whatever they paid today.</p>
          </form>` : ''}
        </section>
        <section class="card">
          ${balance > 0 ? `<form data-form="expected" novalidate>
            <h2>Promised payment date</h2>
            <p class="muted small">Did the customer promise a date? The cash forecast uses it instead of the due date.</p>
            <div class="row">
              <input type="date" name="expectedPaymentDate" value="${esc(inv.expectedPaymentDate || '')}" style="max-width:200px" aria-label="Expected payment date">
              <button class="btn btn-ghost" type="submit">Save</button>
            </div>
          </form>` : '<h2>Promised payment date</h2><p class="muted">Not needed, already paid.</p>'}
          <div style="margin-top:20px"><button type="button" class="btn btn-danger btn-sm" data-action="delete-invoice">Delete invoice</button></div>
        </section>
      </div>`;
  }

  // ----- bills -----

  function viewBills() {
    const t = todayStr();
    const unpaid = store.bills.filter((b) => b.paid === false).sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
    const paid = store.bills.filter((b) => b.paid !== false).sort((a, b) => (a.dueDate < b.dueDate ? 1 : -1));
    const unpaidTotal = unpaid.reduce((s, b) => s + Number(b.amount || 0), 0);
    const next7 = unpaid.filter((b) => L.diffDays(b.dueDate, t) <= 7).reduce((s, b) => s + Number(b.amount || 0), 0);

    const dueTag = (b) => {
      const d = L.diffDays(b.dueDate, t);
      if (d < 0) return `<span class="chip chip-unpaid">${-d} days late</span>`;
      if (d <= 3) return `<span class="chip chip-partial">${relDays(b.dueDate)}</span>`;
      if (d <= 7) return `<span class="chip chip-neutral">${relDays(b.dueDate)}</span>`;
      return `<span class="muted small">${relDays(b.dueDate)}</span>`;
    };

    const unpaidRows = unpaid
      .map(
        (b) => `<tr>
        <td><strong>${esc(b.title)}</strong></td>
        <td class="nowrap">${fdate(b.dueDate)} ${dueTag(b)}</td>
        <td class="num">${money(b.amount)}</td>
        <td class="num nowrap"><button type="button" class="btn btn-sm" data-action="bill-paid" data-id="${esc(b.id)}">Mark paid</button>
          <button type="button" class="btn btn-danger btn-sm" data-action="bill-delete" data-id="${esc(b.id)}" aria-label="Delete bill">✕</button></td>
      </tr>`
      )
      .join('');
    const paidRows = paid
      .map(
        (b) => `<tr>
        <td>${esc(b.title)}</td><td class="nowrap">${fdate(b.dueDate)}${b.paidDate ? ` <span class="muted small">· paid ${fdate(b.paidDate)}</span>` : ''}</td>
        <td class="num">${money(b.amount)}</td>
        <td class="num"><button type="button" class="btn btn-ghost btn-sm" data-action="bill-unpaid" data-id="${esc(b.id)}">Undo</button></td>
      </tr>`
      )
      .join('');

    return `
      <div class="page-head">
        <div><h1>Bills</h1><p class="muted">Rent, suppliers, bijli, salary: what you have to pay</p></div>
      </div>
      <div class="stats">
        ${stat('Unpaid bills', money(unpaidTotal), `${unpaid.length} bill${unpaid.length === 1 ? '' : 's'}`, 'warn')}
        ${stat('Due within 7 days', money(next7), 'including overdue', next7 > 0 ? 'bad' : '')}
      </div>
      <div class="grid-2">
        <section class="card" style="grid-column: 1 / -1">
          <h2>Upcoming</h2>
          ${unpaid.length ? `<div class="table-wrap"><table><thead><tr><th>Bill</th><th>Due</th><th class="num">Amount</th><th></th></tr></thead><tbody>${unpaidRows}</tbody></table></div>` : '<div class="empty">No unpaid bills. 👍</div>'}
        </section>
      </div>
      <form data-form="bill" class="card" novalidate>
        <h2>Add bill</h2>
        <div class="form-grid">
          <label class="field">Title<input name="title" required maxlength="80" placeholder="e.g. Supplier: Agarwal Traders" list="bill-list" autocomplete="off"></label>
          <label class="field">Amount (₹)<input name="amount" type="number" min="0" step="any" inputmode="decimal" required></label>
          <label class="field">Due date<input name="dueDate" type="date" required value="${L.addDays(t, 7)}"></label>
        </div>
        <datalist id="bill-list"><option value="Shop rent"></option><option value="Electricity bill"></option><option value="Helper salary"></option><option value="Supplier payment"></option><option value="GST payment"></option><option value="Shop loan EMI"></option></datalist>
        <div class="error" data-error hidden></div>
        <div class="form-actions"><button class="btn" type="submit">Add bill</button></div>
      </form>
      ${paid.length ? `<section class="card"><details><summary><strong>Paid bills (${paid.length})</strong></summary>
        <div class="table-wrap" style="margin-top:8px"><table><tbody>${paidRows}</tbody></table></div></details></section>` : ''}`;
  }

  // ----- forecast -----

  function itemsDetails(items, kind) {
    if (!items.length) return '';
    const lis = items
      .map((x) =>
        kind === 'in'
          ? `<li>${fdate(x.date)} · <a href="#/invoices/${esc(x.invoiceId)}">${esc(x.number)}</a> ${esc(x.customerName)}: ${money(x.amount)}</li>`
          : `<li>${fdate(x.date)} · ${esc(x.title)}: ${money(x.amount)}</li>`
      )
      .join('');
    return `<details class="items"><summary>${items.length} item${items.length === 1 ? '' : 's'}</summary><ul>${lis}</ul></details>`;
  }

  function cashChart(fc, compare) {
    const values = fc.weeks.map((w) => w.closing).concat(compare ? compare.weeks.map((w) => w.closing) : []);
    const maxPos = Math.max(0, ...values);
    const maxNeg = Math.max(0, ...values.map((v) => -v));
    const span = maxPos + maxNeg || 1;
    const posH = (maxPos / span) * 100;
    const negH = 100 - posH;
    const cols = fc.weeks
      .map((w, i) => {
        const v = w.closing;
        const alt = compare ? compare.weeks[i].closing : null;
        const pos = v > 0 ? (v / (maxPos || 1)) * 100 : 0;
        const neg = v < 0 ? (-v / (maxNeg || 1)) * 100 : 0;
        const altPos = alt != null && alt > 0 ? (alt / (maxPos || 1)) * 100 : 0;
        const altNeg = alt != null && alt < 0 ? (-alt / (maxNeg || 1)) * 100 : 0;
        const title = `${w.label} (${fdate(w.fromDate)}–${fdate(w.toDate)}): ${money(v)}${alt != null ? ` · scenario ${money(alt)}` : ''}`;
        return `<div class="col" title="${esc(title)}">
          <div class="pos-area" style="height:${posH}%">
            <div style="display:flex;gap:2px;align-items:flex-end;height:100%">
              <div class="bar" style="height:${pos}%"></div>
              ${compare ? `<div class="bar ghost" style="height:${altPos}%"></div>` : ''}
            </div>
          </div>
          <div class="neg-area" style="height:${negH}%">
            <div style="display:flex;gap:2px;align-items:flex-start;height:100%">
              <div class="bar neg" style="height:${neg}%"></div>
              ${compare ? `<div class="bar neg ghost" style="height:${altNeg}%"></div>` : ''}
            </div>
          </div>
        </div>`;
      })
      .join('');
    const labels = fc.weeks.map((w) => `<span>${esc(w.label.replace('Week ', 'W'))}</span>`).join('');
    return `<div class="cash-chart" role="img" aria-label="Projected closing cash per week">
        ${maxNeg > 0 ? `<div class="zero" style="top:${posH}%"></div>` : ''}${cols}</div>
      <div class="chart-labels">${labels}</div>
      <div class="legend"><span><i style="background:var(--brand)"></i>Closing cash</span><span><i style="background:var(--bad)"></i>Below zero</span>
        ${compare ? '<span><i style="border:2px dashed var(--accent)"></i>What-if scenario</span>' : ''}</div>`;
  }

  function forecastInputs() {
    return {
      horizonDays: store.settings.horizonDays,
      openingCash: store.settings.openingCash,
      invoices: store.invoices,
      bills: store.bills,
      customers: store.customers,
      today: now(),
    };
  }

  function viewForecast() {
    const input = forecastInputs();
    const fc = L.forecast(input);
    const lowest = fc.weeks.find((w) => w.label === fc.lowestCashWeek);
    const debtors = L.receivablesByCustomer(store.invoices, store.customers, input.today);

    // scenario (recomputed every render so it follows horizon / opening cash changes)
    const sc = ui.scenario;
    if (!sc.customerId || !debtors.some((r) => r.customerId === sc.customerId)) {
      sc.customerId = debtors[0] ? debtors[0].customerId : null;
    }
    const result =
      sc.active && sc.customerId
        ? L.scenarioLateCustomer(Object.assign({}, input, { customerId: sc.customerId, delayDays: sc.delayDays }))
        : null;

    const weekRows = fc.weeks
      .map(
        (w) => `<tr class="${w.closing < 0 ? 'negative' : ''}">
        <td class="nowrap"><strong>${esc(w.label)}</strong><div class="muted small">${fdate(w.fromDate)} – ${fdate(w.toDate)}</div></td>
        <td class="num hide-sm">${money(w.opening)}</td>
        <td class="num"><span class="${w.inflow ? 'pos' : 'muted'}">${w.inflow ? '+' : ''}${money(w.inflow)}</span>${itemsDetails(w.inflowItems, 'in')}</td>
        <td class="num"><span class="${w.outflow ? 'neg' : 'muted'}">${w.outflow ? '−' : ''}${money(w.outflow)}</span>${itemsDetails(w.outflowItems, 'out')}</td>
        <td class="num closing"><strong>${money(w.closing)}</strong></td>
      </tr>`
      )
      .join('');

    const banner = fc.negativeWeeks.length
      ? `<div class="banner banner-bad" role="alert"><strong>⚠ Cash goes negative in ${esc(fc.negativeWeeks.join(', '))}</strong>
          Lowest point ${money(fc.lowestCash)} in ${esc(fc.lowestCashWeek)}${lowest ? ` (${fdate(lowest.fromDate)} – ${fdate(lowest.toDate)})` : ''}. Chase overdue invoices or move a bill date before then.</div>`
      : `<div class="banner banner-ok"><strong>✓ Cash stays positive for the next ${fc.horizonDays} days</strong>Lowest point ${money(fc.lowestCash)} in ${esc(fc.lowestCashWeek)}.</div>`;

    const beyond =
      fc.beyondHorizonInflow || fc.beyondHorizonOutflow
        ? `<div class="banner banner-note"><strong>Beyond ${fc.horizonDays} days</strong>
            ${fc.beyondHorizonInflow ? `${money(fc.beyondHorizonInflow)} of receivables is expected after this window` : ''}${fc.beyondHorizonInflow && fc.beyondHorizonOutflow ? ', and ' : ''}${fc.beyondHorizonOutflow ? `${money(fc.beyondHorizonOutflow)} of bills fall due after it` : ''}. Not counted above.</div>`
        : '';

    const custOpts = debtors
      .map((r) => `<option value="${esc(r.customerId)}" ${r.customerId === sc.customerId ? 'selected' : ''}>${esc(r.name)} · ${esc(money(r.outstanding))}</option>`)
      .join('');

    return `
      <div class="page-head">
        <div><h1>Cash forecast</h1><p class="muted">Galla mein kitna bachega? Week by week, from expected payments and bills.</p></div>
      </div>

      <section class="card">
        <div class="controls">
          <label class="field">Opening cash today (₹)
            <input id="opening-cash" type="number" step="any" inputmode="decimal" value="${esc(store.settings.openingCash)}">
          </label>
          <div>
            <div class="small muted" style="font-weight:600;margin-bottom:4px">Horizon</div>
            <div class="seg" role="group" aria-label="Forecast horizon">
              ${HORIZONS.map((h) => `<button type="button" data-action="horizon" data-days="${h}" class="${h === fc.horizonDays ? 'active' : ''}" aria-pressed="${h === fc.horizonDays}">${h} days</button>`).join('')}
            </div>
          </div>
        </div>
        <p class="muted small" style="margin:10px 0 0">Overdue money is assumed to arrive this week (you will chase it). Set a promised date on an invoice to move it.</p>
      </section>

      <div class="stats">
        ${stat('Total inflow', `<span class="pos">${money(fc.totalInflow)}</span>`, 'from customers')}
        ${stat('Total outflow', `<span class="neg">${money(fc.totalOutflow)}</span>`, 'bills to pay', 'warn')}
        ${stat(`Ending cash (day ${fc.horizonDays})`, `<span class="${fc.endingCash < 0 ? 'neg' : ''}">${money(fc.endingCash)}</span>`, `from ${money(fc.openingCash)} today`, 'info')}
        ${stat('Lowest cash', `<span class="${fc.lowestCash < 0 ? 'neg' : ''}">${money(fc.lowestCash)}</span>`, `${esc(fc.lowestCashWeek)}${lowest ? ` · ${fdate(lowest.fromDate)} – ${fdate(lowest.toDate)}` : ''}`, fc.lowestCash < 0 ? 'bad' : '')}
      </div>

      ${banner}${beyond}

      <section class="card">
        <div class="card-head"><h2>Closing cash by week</h2>${result ? '<span class="small muted">dashed = what-if</span>' : ''}</div>
        ${cashChart(fc, result ? result.scenario : null)}
      </section>

      <section class="card">
        <h2>Weekly breakdown</h2>
        <div class="table-wrap"><table>
          <thead><tr><th>Week</th><th class="num hide-sm">Opening</th><th class="num">Inflow</th><th class="num">Outflow</th><th class="num">Closing</th></tr></thead>
          <tbody>${weekRows}</tbody>
          <tfoot><tr><td>Total</td><td class="hide-sm"></td><td class="num pos">${money(fc.totalInflow)}</td><td class="num neg">${money(fc.totalOutflow)}</td><td class="num">${money(fc.endingCash)}</td></tr></tfoot>
        </table></div>
      </section>

      <section class="card" id="what-if">
        <h2>What if a customer pays late?</h2>
        ${debtors.length ? `<form data-form="scenario" class="controls" novalidate>
          <label class="field" style="max-width:340px">Customer<select name="customerId">${custOpts}</select></label>
          <label class="field" style="max-width:130px">Days late<input name="delayDays" type="number" min="1" max="365" step="1" value="${esc(sc.delayDays)}"></label>
          <div class="row"><button class="btn" type="submit">Run scenario</button>${result ? '<button type="button" class="btn btn-ghost" data-action="clear-scenario">Clear</button>' : ''}</div>
        </form>
        ${result ? scenarioResult(result, sc) : '<p class="muted small" style="margin-top:10px">Pick a customer and see how your cash changes if they pay late.</p>'}`
        : '<div class="empty">No customer has an open balance, so there is nothing to delay.</div>'}
      </section>`;
  }

  function deltaHtml(v) {
    if (v === 0) return '<span class="muted">no change</span>';
    return `<span class="${v < 0 ? 'neg' : 'pos'}">${v > 0 ? '+' : ''}${money(v)}</span>`;
  }

  function scenarioResult(r, sc) {
    const c = findCustomer(sc.customerId);
    const name = c ? c.name : 'This customer';
    const b = r.baseline;
    const s = r.scenario;
    const newNeg = s.negativeWeeks.filter((w) => !b.negativeWeeks.includes(w));

    const weekRows = b.weeks
      .map((w, i) => {
        const sw = s.weeks[i];
        const changed = r.changedWeeks.includes(w.label);
        return `<tr class="${changed ? 'changed' : ''}">
          <td class="nowrap"><strong>${esc(w.label)}</strong> <span class="muted small hide-sm">${fdate(w.fromDate)}</span></td>
          <td class="num">${money(w.inflow)}</td><td class="num">${money(sw.inflow)}</td>
          <td class="num">${money(w.closing)}</td><td class="num ${sw.closing < 0 ? 'neg' : ''}"><strong>${money(sw.closing)}</strong></td>
        </tr>`;
      })
      .join('');

    const shifted = r.shiftedInvoices
      .map(
        (x) => `<tr><td>${esc(x.number)}</td><td>${esc(x.customerName)}</td><td class="nowrap">${fdate(x.from)}</td><td class="nowrap">${fdate(x.to)}</td><td class="num">${money(x.amount)}</td></tr>`
      )
      .join('');

    const verdict = s.negativeWeeks.length
      ? `<div class="banner banner-bad" role="alert"><strong>⚠ If ${esc(name)} pays ${sc.delayDays} days late, cash goes negative in ${esc(s.negativeWeeks.join(', '))}</strong>
          Lowest point would be ${money(s.lowestCash)} in ${esc(s.lowestCashWeek)}.${newNeg.length && !b.negativeWeeks.length ? ' Today’s plan is fine, so this delay alone causes the shortfall. Chase them early.' : ''}</div>`
      : `<div class="banner banner-ok"><strong>✓ You can absorb a ${sc.delayDays}-day delay from ${esc(name)}</strong>Cash stays positive; lowest point ${money(s.lowestCash)}.</div>`;

    return `
      <div style="margin-top:14px">${verdict}</div>
      <div class="compare">
        <div class="box"><div class="lbl">Ending cash</div>
          <div class="vals"><span>Plan ${money(b.endingCash)}</span><span>What-if ${money(s.endingCash)}</span></div>
          <div class="delta">${deltaHtml(r.deltaEndingCash)}</div></div>
        <div class="box"><div class="lbl">Lowest cash</div>
          <div class="vals"><span>Plan ${money(b.lowestCash)} <span class="muted small">${esc(b.lowestCashWeek)}</span></span><span>What-if ${money(s.lowestCash)} <span class="muted small">${esc(s.lowestCashWeek)}</span></span></div>
          <div class="delta">${deltaHtml(r.deltaLowestCash)}</div></div>
        <div class="box"><div class="lbl">Weeks that change</div>
          <div style="margin-top:6px">${r.changedWeeks.length ? r.changedWeeks.map((w) => `<span class="chip chip-partial" style="margin:0 4px 4px 0">${esc(w)}</span>`).join('') : '<span class="muted">None inside this horizon</span>'}</div></div>
      </div>
      ${r.deltaEndingCash < 0 ? `<p class="muted small">${money(-r.deltaEndingCash)} slips past day ${b.horizonDays}, so it is missing from the ending cash.</p>` : ''}
      <h3>Week by week</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>Week</th><th class="num">Inflow (plan)</th><th class="num">Inflow (what-if)</th><th class="num">Closing (plan)</th><th class="num">Closing (what-if)</th></tr></thead>
        <tbody>${weekRows}</tbody></table></div>
      <h3 style="margin-top:16px">Shifted invoices</h3>
      ${shifted ? `<div class="table-wrap"><table><thead><tr><th>Invoice</th><th>Customer</th><th>Expected</th><th>Now</th><th class="num">Amount</th></tr></thead><tbody>${shifted}</tbody></table></div>` : '<p class="muted">No invoices move.</p>'}`;
  }

  // ----- alerts -----

  function viewAlerts() {
    const list = currentAlerts();
    const seen = new Set(store.seenAlertIds);
    const html = list.map((a) => alertItem(a, !seen.has(a.id))).join('');
    // Visiting the page marks everything as read.
    store.seenAlertIds = list.map((a) => a.id);
    save();
    const counts = list.reduce((m, a) => Object.assign(m, { [a.severity]: (m[a.severity] || 0) + 1 }), {});
    return `
      <div class="page-head">
        <div><h1>Alerts</h1><p class="muted">${list.length} things need attention · ${counts.high || 0} urgent, ${counts.medium || 0} soon, ${counts.info || 0} FYI</p></div>
      </div>
      ${list.length ? html : '<div class="card empty"><h2>Sab theek hai 🙏</h2><p>No overdue invoices, no bills due this week, cash looks fine.</p></div>'}`;
  }

  // ---------- router ----------

  function parseRoute() {
    const raw = (location.hash || '').replace(/^#\/?/, '');
    const [pathPart, queryPart = ''] = raw.split('?');
    const parts = pathPart.split('/').filter(Boolean).map(decodeURIComponent);
    return { parts, query: new URLSearchParams(queryPart) };
  }

  const TITLES = { dashboard: 'Dashboard', customers: 'Customers', invoices: 'Invoices', bills: 'Bills', forecast: 'Forecast', alerts: 'Alerts' };

  function render() {
    const { parts, query } = parseRoute();
    const tab = TITLES[parts[0]] ? parts[0] : 'dashboard';
    let html;
    switch (tab) {
      case 'customers':
        if (parts[1] === 'new') html = viewCustomerNew();
        else if (parts[1]) html = viewCustomerDetail(parts[1], parts[2] === 'edit');
        else html = viewCustomers();
        break;
      case 'invoices':
        if (parts[1] === 'new') html = viewInvoiceNew(query);
        else if (parts[1]) html = viewInvoiceDetail(parts[1]);
        else html = viewInvoices();
        break;
      case 'bills':
        html = viewBills();
        break;
      case 'forecast':
        html = viewForecast();
        break;
      case 'alerts':
        html = viewAlerts();
        break;
      default:
        html = viewDashboard();
    }
    const app = $('#app');
    app.innerHTML = html;

    $$('.tabs a').forEach((a) => {
      const on = a.dataset.tab === tab;
      a.classList.toggle('active', on);
      if (on) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    updateBadge();
    document.title = `${TITLES[tab]} · HisabKitab`;

    const routeKey = parts.join('/');
    if (ui.lastRoute !== routeKey) {
      window.scrollTo(0, 0);
      ui.lastRoute = routeKey;
    }
  }

  function updateBadge() {
    const seen = new Set(store.seenAlertIds);
    const unread = currentAlerts().filter((a) => !seen.has(a.id)).length;
    const badge = $('#alerts-badge');
    badge.textContent = unread > 99 ? '99+' : String(unread);
    badge.hidden = unread === 0;
    badge.setAttribute('aria-label', `${unread} new alerts`);
  }

  // ---------- events ----------

  function showError(form, msg) {
    const el = $('[data-error]', form);
    if (!el) return;
    el.textContent = msg;
    el.hidden = !msg;
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch (_) {
        ok = false;
      }
      ta.remove();
      return ok;
    }
  }

  function currentInvoice() {
    const { parts } = parseRoute();
    return parts[0] === 'invoices' ? findInvoice(parts[1]) : null;
  }

  const actions = {
    filter(el) {
      ui.invoiceFilter = el.dataset.filter;
      render();
    },
    horizon(el) {
      store.settings.horizonDays = Number(el.dataset.days);
      save();
      render();
    },
    'clear-scenario'() {
      ui.scenario.active = false;
      render();
    },
    'add-item'(el) {
      const form = el.closest('form');
      const tbody = $('[data-lines]', form);
      tbody.insertAdjacentHTML('beforeend', lineItemRow());
      $('[data-line]:last-child [name=desc]', tbody).focus();
    },
    'remove-item'(el) {
      const form = el.closest('form');
      const rows = $$('[data-line]', form);
      if (rows.length > 1) el.closest('[data-line]').remove();
      else $$('input', rows[0]).forEach((i) => (i.value = i.name === 'qty' ? '1' : ''));
      refreshInvoiceTotals(form);
    },
    'mark-sent'() {
      const inv = currentInvoice();
      if (!inv) return;
      inv.sent = true;
      commit();
      toast(`${inv.number} marked as sent`);
      render();
    },
    'delete-payment'(el) {
      const inv = currentInvoice();
      if (!inv) return;
      const idx = Number(el.dataset.index);
      const p = inv.payments[idx];
      if (!p || !confirm(`Remove payment of ${money(p.amount)} on ${fdate(p.date)}?`)) return;
      inv.payments.splice(idx, 1);
      commit();
      render();
    },
    'delete-invoice'() {
      const inv = currentInvoice();
      if (!inv || !confirm(`Delete invoice ${inv.number}? This cannot be undone.`)) return;
      store.invoices = store.invoices.filter((i) => i.id !== inv.id);
      commit();
      toast(`${inv.number} deleted`);
      location.hash = '#/invoices';
    },
    async 'copy-reminder'() {
      const ta = $('[data-reminder]');
      if (!ta) return;
      const ok = await copyText(ta.value);
      if (!ok) ta.select();
      toast(ok ? 'Reminder copied. Paste it in WhatsApp or SMS.' : 'Select the text and copy it manually');
    },
    'bill-paid'(el) {
      const b = findBill(el.dataset.id);
      if (!b) return;
      b.paid = true;
      b.paidDate = todayStr();
      commit();
      toast(`${b.title} marked paid`);
      render();
    },
    'bill-unpaid'(el) {
      const b = findBill(el.dataset.id);
      if (!b) return;
      b.paid = false;
      delete b.paidDate;
      commit();
      render();
    },
    'bill-delete'(el) {
      const b = findBill(el.dataset.id);
      if (!b || !confirm(`Delete bill "${b.title}"?`)) return;
      store.bills = store.bills.filter((x) => x.id !== b.id);
      commit();
      render();
    },
  };

  const forms = {
    customer(form, fd) {
      const name = String(fd.get('name') || '').trim();
      const phone = normalisePhone(fd.get('phone'));
      if (!name) return showError(form, 'Please enter a name.');
      if (!phone) return showError(form, 'Please enter a valid 10-digit Indian mobile number.');
      const id = fd.get('id');
      const clash = store.customers.find((c) => c.phone === phone && c.id !== id);
      if (clash) return showError(form, `${clash.name} already uses this number.`);
      if (id) {
        const c = findCustomer(id);
        if (!c) return;
        c.name = name;
        c.phone = phone;
        commit();
        toast('Customer saved');
        location.hash = `#/customers/${c.id}`;
      } else {
        const c = { id: uid('c'), name, phone };
        store.customers.push(c);
        commit();
        toast(`${name} added`);
        location.hash = `#/customers/${c.id}`;
      }
    },
    invoice(form, fd) {
      const customerId = fd.get('customerId');
      const number = String(fd.get('number') || '').trim();
      const issueDate = fd.get('issueDate');
      const dueDate = fd.get('dueDate');
      const expected = fd.get('expectedPaymentDate') || null;
      const lineItems = readLineItems(form).filter((li) => li.description || li.rate);
      if (!findCustomer(customerId)) return showError(form, 'Choose a customer.');
      if (!number) return showError(form, 'Invoice number is required.');
      if (store.invoices.some((i) => i.number === number)) return showError(form, `Invoice number ${number} already exists.`);
      if (!issueDate || !dueDate) return showError(form, 'Issue and due dates are required.');
      if (dueDate < issueDate) return showError(form, 'Due date cannot be before the issue date.');
      if (!lineItems.length) return showError(form, 'Add at least one item.');
      const bad = lineItems.find((li) => !li.description || !(li.qty > 0) || !(li.rate >= 0) || !Number.isFinite(li.rate));
      if (bad) return showError(form, 'Every item needs a description, a quantity above 0 and a rate.');
      const inv = {
        id: uid('i'),
        number,
        customerId,
        issueDate,
        dueDate,
        expectedPaymentDate: expected,
        sent: fd.get('sent') === 'on',
        lineItems,
        payments: [],
      };
      if (L.invoiceTotal(inv) <= 0) return showError(form, 'Invoice total must be more than ₹0.');
      store.invoices.push(inv);
      commit();
      toast(`${inv.number} created · ${money(L.invoiceTotal(inv))}`);
      location.hash = `#/invoices/${inv.id}`;
    },
    payment(form, fd) {
      const inv = currentInvoice();
      if (!inv) return;
      const amount = Math.round(Number(fd.get('amount')) * 100) / 100;
      const date = fd.get('date');
      const balance = L.invoiceBalance(inv);
      if (!(amount > 0)) return showError(form, 'Enter an amount above ₹0.');
      if (amount > balance) return showError(form, `That is more than the balance of ${money(balance)}.`);
      if (!date) return showError(form, 'Pick the payment date.');
      if (date > todayStr()) return showError(form, 'Payment date cannot be in the future.');
      inv.payments = inv.payments || [];
      inv.payments.push({ date, amount, mode: fd.get('mode') || 'Cash' });
      commit();
      const left = L.invoiceBalance(inv);
      toast(left > 0 ? `${money(amount)} recorded · ${money(left)} still due` : `${money(amount)} recorded · fully paid ✓`);
      render();
    },
    expected(form, fd) {
      const inv = currentInvoice();
      if (!inv) return;
      inv.expectedPaymentDate = fd.get('expectedPaymentDate') || null;
      commit();
      toast(inv.expectedPaymentDate ? `Expected on ${fdate(inv.expectedPaymentDate)}` : 'Using the due date for the forecast');
      render();
    },
    bill(form, fd) {
      const title = String(fd.get('title') || '').trim();
      const amount = Math.round(Number(fd.get('amount')) * 100) / 100;
      const dueDate = fd.get('dueDate');
      if (!title) return showError(form, 'Give the bill a title.');
      if (!(amount > 0)) return showError(form, 'Enter an amount above ₹0.');
      if (!dueDate) return showError(form, 'Pick a due date.');
      store.bills.push({ id: uid('b'), title, amount, dueDate, paid: false });
      commit();
      toast(`${title} added`);
      render();
    },
    scenario(form, fd) {
      const delay = Math.round(Number(fd.get('delayDays')));
      if (!(delay >= 1 && delay <= 365)) {
        toast('Days late must be between 1 and 365');
        return;
      }
      ui.scenario = { customerId: fd.get('customerId'), delayDays: delay, active: true };
      render();
      const el = $('#what-if');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
  };

  document.addEventListener('click', (e) => {
    const actionEl = e.target.closest('[data-action]');
    if (actionEl && actions[actionEl.dataset.action]) {
      e.preventDefault();
      actions[actionEl.dataset.action](actionEl);
      return;
    }
    const row = e.target.closest('tr[data-href]');
    if (row && !e.target.closest('a, button, input, select, textarea, details')) {
      location.hash = row.dataset.href;
    }
  });

  document.addEventListener('submit', (e) => {
    const form = e.target.closest('form[data-form]');
    if (!form || !forms[form.dataset.form]) return;
    e.preventDefault();
    showError(form, '');
    forms[form.dataset.form](form, new FormData(form));
  });

  document.addEventListener('input', (e) => {
    const form = e.target.closest('form[data-form="invoice"]');
    if (!form) return;
    // Picking a known item from the list fills in its usual rate.
    if (e.target.name === 'desc') {
      const opt = $$('#item-list option').find((o) => o.value === e.target.value);
      const rate = $('[name=rate]', e.target.closest('[data-line]'));
      if (opt && rate && !rate.value) rate.value = opt.dataset.rate;
    }
    refreshInvoiceTotals(form);
  });

  document.addEventListener('change', (e) => {
    if (e.target.id === 'opening-cash') {
      const v = Number(e.target.value);
      store.settings.openingCash = Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
      save();
      toast(`Opening cash set to ${money(store.settings.openingCash)}`);
      render();
    }
  });

  $('#reset-btn').addEventListener('click', () => {
    if (!confirm('Reset to the sample data? All your customers, invoices and bills will be replaced.')) return;
    store = freshStore();
    save();
    ui.invoiceFilter = 'open';
    ui.scenario = { customerId: null, delayDays: 15, active: false };
    toast('Sample data restored');
    if (location.hash === '#/dashboard') render();
    else location.hash = '#/dashboard';
  });

  window.addEventListener('hashchange', render);
  window.addEventListener('storage', (e) => {
    if (e.key === STORE_KEY) {
      store = loadStore();
      render();
    }
  });

  if (!location.hash) history.replaceState(null, '', '#/dashboard');
  save();
  render();
})();
