/* HisabKitab pure business logic. No DOM access. Works as a classic browser
 * script (window.Logic) and under Node vm (globalThis.Logic). */
(function () {
  'use strict';

  const root = typeof window !== 'undefined' ? window : globalThis;

  const MS_PER_DAY = 86400000;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // ---------- small helpers ----------

  const toNum = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  const round2 = (n) => Math.round(n * 100) / 100;

  const sumBy = (list, fn) => list.reduce((s, x) => s + fn(x), 0);

  const customerName = (customers, id) => {
    const c = customers.find((x) => x.id === id);
    return c ? c.name : 'Unknown';
  };

  // ---------- dates (all 'YYYY-MM-DD' strings are LOCAL calendar dates) ----------

  function parseDate(ymd) {
    const [y, m, d] = ymd.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function formatYmd(date) {
    const y = String(date.getFullYear()).padStart(4, '0');
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function addDays(ymd, n) {
    const dt = parseDate(ymd);
    dt.setDate(dt.getDate() + n);
    return formatYmd(dt);
  }

  // Whole days between two calendar dates, computed on UTC day numbers so DST never skews it.
  function diffDays(ymdA, ymdB) {
    const utcDay = (ymd) => {
      const [y, m, d] = ymd.split('-').map(Number);
      return Date.UTC(y, m - 1, d) / MS_PER_DAY;
    };
    return Math.round(utcDay(ymdA) - utcDay(ymdB));
  }

  function todayYmd(today = new Date()) {
    return formatYmd(today);
  }

  function todayStart(today = new Date()) {
    return new Date(today.getFullYear(), today.getMonth(), today.getDate());
  }

  // Short display date, e.g. '14 Mar'.
  function formatDate(ymd) {
    const dt = parseDate(ymd);
    return `${dt.getDate()} ${MONTHS[dt.getMonth()]}`;
  }

  // ---------- money ----------

  // Indian grouping: last 3 digits, then groups of 2. Decimals only when non-integer.
  function formatINR(amount) {
    const rounded = round2(toNum(amount));
    const negative = rounded < 0;
    const [intPart, decPart] = Math.abs(rounded).toFixed(2).split('.');

    const last3 = intPart.slice(-3);
    let rest = intPart.slice(0, -3);
    const groups = [];
    while (rest.length > 2) {
      groups.unshift(rest.slice(-2));
      rest = rest.slice(0, -2);
    }
    if (rest) groups.unshift(rest);
    const grouped = groups.length ? `${groups.join(',')},${last3}` : last3;

    const dec = decPart.replace(/0+$/, '');
    return `${negative ? '-' : ''}₹${grouped}${dec ? `.${dec}` : ''}`;
  }

  // ---------- invoices ----------

  function invoiceTotal(invoice) {
    const total = sumBy(invoice.lineItems || [], (li) => toNum(li.qty) * toNum(li.rate));
    return round2(total);
  }

  function invoicePaid(invoice) {
    return round2(sumBy(invoice.payments || [], (p) => toNum(p.amount)));
  }

  function invoiceBalance(invoice) {
    return round2(invoiceTotal(invoice) - invoicePaid(invoice));
  }

  function invoiceStatus(invoice) {
    if (invoiceBalance(invoice) <= 0) return 'paid';
    return invoicePaid(invoice) > 0 ? 'partial' : 'unpaid';
  }

  function daysOverdue(invoice, today = new Date()) {
    if (invoiceBalance(invoice) <= 0) return 0;
    return Math.max(0, diffDays(todayYmd(today), invoice.dueDate));
  }

  function isOverdue(invoice, today = new Date()) {
    return invoiceBalance(invoice) > 0 && invoice.dueDate < todayYmd(today);
  }

  const AGING_BUCKETS = [
    { key: 'current', label: 'Not yet due' },
    { key: '1-30', label: '1-30 days overdue' },
    { key: '31-60', label: '31-60 days overdue' },
    { key: '61-90', label: '61-90 days overdue' },
    { key: '90+', label: '90+ days overdue' },
  ];

  function agingBucket(invoice, today = new Date()) {
    if (invoiceBalance(invoice) <= 0) return null;
    const days = daysOverdue(invoice, today);
    if (days <= 0) return 'current';
    if (days <= 30) return '1-30';
    if (days <= 60) return '31-60';
    if (days <= 90) return '61-90';
    return '90+';
  }

  function agingSummary(invoices, customers, today = new Date()) {
    const buckets = {};
    AGING_BUCKETS.forEach(({ key }) => {
      buckets[key] = { amount: 0, count: 0, customers: [] };
    });

    invoices.forEach((inv) => {
      const balance = invoiceBalance(inv);
      if (balance <= 0) return;
      const bucket = buckets[agingBucket(inv, today)];
      bucket.amount += balance;
      bucket.count += 1;
      let entry = bucket.customers.find((c) => c.customerId === inv.customerId);
      if (!entry) {
        entry = { customerId: inv.customerId, name: customerName(customers, inv.customerId), amount: 0, count: 0 };
        bucket.customers.push(entry);
      }
      entry.amount += balance;
      entry.count += 1;
    });

    Object.values(buckets).forEach((bucket) => {
      bucket.amount = round2(bucket.amount);
      bucket.customers.forEach((c) => {
        c.amount = round2(c.amount);
      });
      bucket.customers.sort((a, b) => b.amount - a.amount);
    });
    return { buckets };
  }

  // Only customers with open balance are listed ("who owes me").
  function receivablesByCustomer(invoices, customers, today = new Date()) {
    const t = todayYmd(today);
    const byCustomer = new Map();
    invoices.forEach((inv) => {
      if (!byCustomer.has(inv.customerId)) byCustomer.set(inv.customerId, []);
      byCustomer.get(inv.customerId).push(inv);
    });

    const rows = [];
    byCustomer.forEach((list, customerId) => {
      const open = list.filter((inv) => invoiceBalance(inv) > 0);
      if (open.length === 0) return;

      const customer = customers.find((c) => c.id === customerId);
      const oldestUnpaidDate = open.map((inv) => inv.issueDate).sort()[0];
      const paymentDates = list
        .flatMap((inv) => (inv.payments || []).map((p) => p.date))
        .filter(Boolean)
        .sort();

      rows.push({
        customerId,
        name: customerName(customers, customerId),
        phone: customer ? customer.phone : null,
        outstanding: round2(sumBy(open, invoiceBalance)),
        overdue: round2(sumBy(open.filter((inv) => isOverdue(inv, today)), invoiceBalance)),
        oldestUnpaidDate,
        oldestDays: diffDays(t, oldestUnpaidDate),
        openInvoiceCount: open.length,
        lastPaymentDate: paymentDates.length ? paymentDates[paymentDates.length - 1] : null,
      });
    });
    return rows.sort((a, b) => b.outstanding - a.outstanding);
  }

  // EXPECTED-DATE RULE: an expected date already in the past is treated as today,
  // so overdue money lands in the first forecast week.
  function effectiveExpectedDate(invoice, today = new Date()) {
    const t = todayYmd(today);
    const expected = invoice.expectedPaymentDate || invoice.dueDate;
    return expected > t ? expected : t;
  }

  // Dashboard totals. dueNext30 uses the EXPECTED-DATE RULE (past dates count as today,
  // which is always inside the window). billsNext30 counts unpaid bills due in [today, today+30].
  function dashboardTotals(invoices, bills, today = new Date()) {
    const t = todayYmd(today);
    const end = addDays(t, 30);
    const open = invoices.filter((inv) => invoiceBalance(inv) > 0);
    const unpaidBillsInWindow = bills.filter((b) => b.paid === false && b.dueDate >= t && b.dueDate <= end);

    return {
      receivable: round2(sumBy(open, invoiceBalance)),
      overdue: round2(sumBy(open.filter((inv) => isOverdue(inv, today)), invoiceBalance)),
      dueNext30: round2(sumBy(open.filter((inv) => effectiveExpectedDate(inv, today) <= end), invoiceBalance)),
      billsNext30: round2(sumBy(unpaidBillsInWindow, (b) => toNum(b.amount))),
    };
  }

  // ---------- reminders ----------

  function reminderText(invoice, customer, today = new Date()) {
    const balance = formatINR(invoiceBalance(invoice));
    const days = daysOverdue(invoice, today);
    const dueText = days > 0 ? `due ${days} din pehle` : 'due aaj';
    return `Namaste ${customer.name} ji 🙏 Aapke Kirana Store ka invoice ${invoice.number} (${balance}, ${dueText}) abhi baaki hai. Kripya aaj ya kal tak bhugtaan kar dein. Dhanyavaad! — HisabKitab Store`;
  }

  function whatsappUrl(phone10, text) {
    const digits = String(phone10 || '').replace(/\D/g, '');
    return `https://wa.me/91${digits}?text=${encodeURIComponent(text)}`;
  }

  // ---------- forecast ----------

  // Inflow date for an open invoice: expected date, optionally delayed for one customer,
  // never earlier than today.
  function inflowDate(invoice, today, delayDays, delayCustomerId) {
    let date = effectiveExpectedDate(invoice, today);
    if (delayDays && (!delayCustomerId || invoice.customerId === delayCustomerId)) {
      date = addDays(date, delayDays);
    }
    const t = todayYmd(today);
    return date < t ? t : date;
  }

  // Week k covers day offsets [7(k-1), 7k-1], clipped to horizonDays-1.
  function forecast({
    horizonDays,
    openingCash = 0,
    invoices = [],
    bills = [],
    customers = [],
    today = new Date(),
    delayDays = 0,
    delayCustomerId = null,
  }) {
    const t = todayYmd(today);
    const weekCount = Math.ceil(horizonDays / 7);
    const weeks = [];
    for (let k = 1; k <= weekCount; k++) {
      weeks.push({
        label: `Week ${k}`,
        fromDate: addDays(t, 7 * (k - 1)),
        toDate: addDays(t, Math.min(7 * k - 1, horizonDays - 1)),
        inflow: 0,
        outflow: 0,
        opening: 0,
        closing: 0,
        inflowItems: [],
        outflowItems: [],
      });
    }
    const weekFor = (date) => weeks[Math.floor(diffDays(date, t) / 7)];
    const beyond = (date) => diffDays(date, t) > horizonDays - 1;

    let beyondHorizonInflow = 0;
    let beyondHorizonOutflow = 0;

    invoices
      .filter((inv) => invoiceBalance(inv) > 0)
      .forEach((inv) => {
        const amount = invoiceBalance(inv);
        const date = inflowDate(inv, today, delayDays, delayCustomerId);
        if (beyond(date)) {
          beyondHorizonInflow += amount;
          return;
        }
        const week = weekFor(date);
        week.inflow += amount;
        week.inflowItems.push({
          invoiceId: inv.id,
          number: inv.number,
          customerName: customerName(customers, inv.customerId),
          amount,
          date,
        });
      });

    bills
      .filter((b) => b.paid === false)
      .forEach((bill) => {
        const amount = toNum(bill.amount);
        const date = bill.dueDate < t ? t : bill.dueDate;
        if (beyond(date)) {
          beyondHorizonOutflow += amount;
          return;
        }
        const week = weekFor(date);
        week.outflow += amount;
        week.outflowItems.push({ billId: bill.id, title: bill.title, amount, date });
      });

    let opening = openingCash;
    weeks.forEach((w) => {
      w.inflow = round2(w.inflow);
      w.outflow = round2(w.outflow);
      w.opening = opening;
      w.closing = round2(opening + w.inflow - w.outflow);
      opening = w.closing;
    });

    const lowestWeek = weeks.reduce((min, w) => (w.closing < min.closing ? w : min), weeks[0]);

    return {
      horizonDays,
      openingCash,
      weeks,
      totalInflow: round2(sumBy(weeks, (w) => w.inflow)),
      totalOutflow: round2(sumBy(weeks, (w) => w.outflow)),
      endingCash: weeks[weeks.length - 1].closing,
      lowestCash: lowestWeek.closing,
      lowestCashWeek: lowestWeek.label,
      negativeWeeks: weeks.filter((w) => w.closing < 0).map((w) => w.label),
      beyondHorizonInflow: round2(beyondHorizonInflow),
      beyondHorizonOutflow: round2(beyondHorizonOutflow),
    };
  }

  // Baseline vs "customer pays delayDays late" scenario. Never mutates inputs.
  function scenarioLateCustomer(opts) {
    const delayDays = opts.delayDays === undefined ? 15 : opts.delayDays;
    const input = Object.assign({}, opts, { today: opts.today || new Date() });

    const baseline = forecast(Object.assign({}, input, { delayDays: 0, delayCustomerId: null }));
    const scenario = forecast(Object.assign({}, input, { delayDays, delayCustomerId: opts.customerId }));

    const changedWeeks = baseline.weeks
      .filter((w, i) => w.inflow !== scenario.weeks[i].inflow)
      .map((w) => w.label);

    const shiftedInvoices = (input.invoices || [])
      .filter((inv) => invoiceBalance(inv) > 0)
      .map((inv) => ({
        inv,
        from: inflowDate(inv, input.today, 0, null),
        to: inflowDate(inv, input.today, delayDays, opts.customerId),
      }))
      .filter((x) => x.from !== x.to)
      .map(({ inv, from, to }) => ({
        number: inv.number,
        customerName: customerName(input.customers || [], inv.customerId),
        from,
        to,
        amount: invoiceBalance(inv),
      }));

    return {
      baseline,
      scenario,
      deltaEndingCash: round2(scenario.endingCash - baseline.endingCash),
      deltaLowestCash: round2(scenario.lowestCash - baseline.lowestCash),
      changedWeeks,
      shiftedInvoices,
    };
  }

  // ---------- alerts ----------

  const SEVERITY_RANK = { high: 0, medium: 1, info: 2 };

  function alerts(invoices, bills, customers, opts = {}) {
    const today = opts.today || new Date();
    const openingCash = opts.openingCash || 0;
    const horizonDays = opts.forecastHorizonDays || 90;
    const t = todayYmd(today);
    const out = [];

    // a) Overdue invoices
    invoices.forEach((inv) => {
      if (!isOverdue(inv, today)) return;
      const days = daysOverdue(inv, today);
      out.push({
        id: `overdue-${inv.id}`,
        severity: days > 90 ? 'high' : 'medium',
        kind: 'overdue',
        title: `Chase invoice ${inv.number} today - ${formatINR(invoiceBalance(inv))}, ${days} days overdue`,
        detail: `${customerName(customers, inv.customerId)} · due ${formatDate(inv.dueDate)}`,
        actionLabel: 'Draft reminder',
        route: `#/invoices/${inv.id}`,
        urgency: -days,
      });
    });

    // b) Unpaid bills due within 7 days, or already overdue
    bills.forEach((bill) => {
      if (bill.paid !== false) return;
      const d = diffDays(bill.dueDate, t);
      if (d > 7) return;
      const when = d === 0 ? 'today' : d > 0 ? `in ${d} days` : `${-d} days ago`;
      out.push({
        id: `bill-${bill.id}`,
        severity: d < 0 ? 'high' : 'medium',
        kind: 'bill',
        title: `${bill.title} due ${when} - ${formatINR(toNum(bill.amount))}`,
        actionLabel: 'Mark paid',
        route: '#/bills',
        urgency: d,
      });
    });

    // c) Projected negative cash
    const fc = forecast({ horizonDays, openingCash, invoices, bills, customers, today });
    const firstNegative = fc.weeks.find((w) => w.closing < 0);
    if (firstNegative) {
      out.push({
        id: 'cash-negative',
        severity: 'high',
        kind: 'cash',
        title: `Cash may go negative by ${formatDate(firstNegative.fromDate)} - projected shortfall ${formatINR(fc.lowestCash)}`,
        actionLabel: 'Open forecast',
        route: '#/forecast',
        urgency: -1000,
      });
    }

    // d) Open invoices not yet marked sent after 2 days
    invoices.forEach((inv) => {
      if (inv.sent !== false || invoiceBalance(inv) <= 0) return;
      const days = diffDays(t, inv.issueDate);
      if (days <= 2) return;
      out.push({
        id: `unsent-${inv.id}`,
        severity: 'medium',
        kind: 'unsent',
        title: `Invoice ${inv.number} is not marked sent yet (${formatINR(invoiceTotal(inv))})`,
        actionLabel: 'Mark sent',
        route: `#/invoices/${inv.id}`,
        urgency: -days,
      });
    });

    // e) Customers with open balance and no payment for 45+ days
    receivablesByCustomer(invoices, customers, today).forEach((row) => {
      const idle = row.lastPaymentDate ? diffDays(t, row.lastPaymentDate) : row.oldestDays;
      if (idle < 45) return;
      out.push({
        id: `dormant-${row.customerId}`,
        severity: 'info',
        kind: 'dormant',
        title: `${row.name} owes ${formatINR(row.outstanding)} and has not paid in ${idle} days`,
        actionLabel: 'Open customer',
        route: `#/customers/${row.customerId}`,
        urgency: -idle,
      });
    });

    return out.sort(
      (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.urgency - b.urgency
    );
  }

  root.Logic = {
    parseDate,
    formatYmd,
    addDays,
    diffDays,
    todayYmd,
    todayStart,
    formatINR,
    formatDate,
    invoiceTotal,
    invoicePaid,
    invoiceBalance,
    invoiceStatus,
    daysOverdue,
    isOverdue,
    AGING_BUCKETS,
    agingBucket,
    agingSummary,
    receivablesByCustomer,
    effectiveExpectedDate,
    dashboardTotals,
    reminderText,
    whatsappUrl,
    forecast,
    scenarioLateCustomer,
    alerts,
  };
})();
