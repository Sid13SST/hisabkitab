#!/usr/bin/env node
/* Dependency-free tests for js/logic.js (and the sample dataset).
 * Run: node tests/logic.test.js */
'use strict';

const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/logic.js'), 'utf8'), ctx, { filename: 'js/logic.js' });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/sample-data.js'), 'utf8'), ctx, { filename: 'js/sample-data.js' });
const L = ctx.Logic;
const SampleData = ctx.SampleData;

// vm results come from another realm; normalise them before deepEqual.
const plain = (v) => JSON.parse(JSON.stringify(v));

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL ${name}\n       ${err.message.split('\n').join('\n       ')}`);
  }
}

// Fixed "today" so every assertion is deterministic: Sat 14 Mar 2026.
const TODAY = new Date(2026, 2, 14, 15, 30);
const T = '2026-03-14';
const d = (n) => L.addDays(T, n);

const customers = [
  { id: 'a', name: 'Asha', phone: '9876543210' },
  { id: 'b', name: 'Bharat', phone: '98123 45678' },
  { id: 'c', name: 'Chitra', phone: '9000000000' },
];

const mkInv = (id, customerId, issue, due, items, payments = [], extra = {}) =>
  Object.assign(
    {
      id,
      number: `INV-${id}`,
      customerId,
      issueDate: d(issue),
      dueDate: d(due),
      expectedPaymentDate: null,
      sent: true,
      lineItems: items.map(([qty, rate]) => ({ description: 'item', qty, rate })),
      payments: payments.map(([day, amount]) => ({ date: d(day), amount })),
    },
    extra
  );

const invoices = [
  mkInv('1', 'a', -30, -20, [[2, 500]]), // 1000, 20 days overdue
  mkInv('2', 'a', -10, 5, [[1, 300], [3, 100]], [[-5, 200]]), // 600, paid 200 -> partial, current
  mkInv('3', 'b', -80, -70, [[1, 2000]], [[-60, 500]]), // 2000, paid 500, 70 overdue
  mkInv('4', 'b', -130, -100, [[4, 250]]), // 1000, 100 overdue
  mkInv('5', 'c', -40, -35, [[1, 750]], [[-34, 750]]), // paid
  mkInv('6', 'c', -45, -45, [[1, 400]]), // 400, 45 overdue
  mkInv('7', 'a', -1, 20, [[1, 1500]], [], { expectedPaymentDate: d(40) }), // expected beyond 30
];

const bills = [
  { id: 'x', title: 'Rent', amount: 3000, dueDate: d(3), paid: false },
  { id: 'y', title: 'Supplier', amount: 4000, dueDate: d(12), paid: false },
  { id: 'z', title: 'Old bill', amount: 999, dueDate: d(-2), paid: false },
  { id: 'w', title: 'Paid bill', amount: 5000, dueDate: d(1), paid: true },
  { id: 'v', title: 'Far bill', amount: 700, dueDate: d(50), paid: false },
];

console.log('HisabKitab logic tests');

// ---------- INR formatting ----------
test('formatINR uses Indian digit grouping', () => {
  assert.equal(L.formatINR(0), '₹0');
  assert.equal(L.formatINR(999), '₹999');
  assert.equal(L.formatINR(1000), '₹1,000');
  assert.equal(L.formatINR(18500), '₹18,500');
  assert.equal(L.formatINR(123456), '₹1,23,456');
  assert.equal(L.formatINR(12345678), '₹1,23,45,678');
});
test('formatINR handles decimals, negatives and junk', () => {
  assert.equal(L.formatINR(1234.5), '₹1,234.5');
  assert.equal(L.formatINR(1234.567), '₹1,234.57');
  assert.equal(L.formatINR(-2500), '-₹2,500');
  assert.equal(L.formatINR('abc'), '₹0');
  assert.equal(L.formatINR(undefined), '₹0');
});

// ---------- dates ----------
test('date helpers', () => {
  assert.equal(L.todayYmd(TODAY), T);
  assert.equal(L.addDays('2026-02-27', 2), '2026-03-01');
  assert.equal(L.diffDays('2026-03-14', '2026-02-14'), 28);
  assert.equal(L.formatDate('2026-03-14'), '14 Mar');
  assert.equal(L.formatDate('2026-12-01'), '1 Dec');
});

// ---------- invoice totals / balances / status ----------
test('invoice total, paid, balance', () => {
  const inv = invoices[1];
  assert.equal(L.invoiceTotal(inv), 600);
  assert.equal(L.invoicePaid(inv), 200);
  assert.equal(L.invoiceBalance(inv), 400);
  assert.equal(L.invoiceTotal({ lineItems: [{ qty: 3, rate: 33.333 }] }), 100);
  assert.equal(L.invoiceTotal({}), 0);
});
test('invoice status unpaid / partial / paid', () => {
  assert.equal(L.invoiceStatus(invoices[0]), 'unpaid');
  assert.equal(L.invoiceStatus(invoices[1]), 'partial');
  assert.equal(L.invoiceStatus(invoices[4]), 'paid');
  const over = mkInv('o', 'a', 0, 0, [[1, 100]], [[0, 150]]);
  assert.equal(L.invoiceStatus(over), 'paid');
});
test('daysOverdue and isOverdue', () => {
  assert.equal(L.daysOverdue(invoices[0], TODAY), 20);
  assert.equal(L.isOverdue(invoices[0], TODAY), true);
  assert.equal(L.daysOverdue(invoices[1], TODAY), 0);
  assert.equal(L.isOverdue(invoices[1], TODAY), false);
  assert.equal(L.daysOverdue(invoices[4], TODAY), 0); // paid
  assert.equal(L.isOverdue(invoices[4], TODAY), false);
  const dueToday = mkInv('t', 'a', -5, 0, [[1, 10]]);
  assert.equal(L.isOverdue(dueToday, TODAY), false);
});

// ---------- aging ----------
test('aging buckets', () => {
  assert.equal(L.agingBucket(invoices[1], TODAY), 'current');
  assert.equal(L.agingBucket(invoices[0], TODAY), '1-30');
  assert.equal(L.agingBucket(invoices[5], TODAY), '31-60');
  assert.equal(L.agingBucket(invoices[2], TODAY), '61-90');
  assert.equal(L.agingBucket(invoices[3], TODAY), '90+');
  assert.equal(L.agingBucket(invoices[4], TODAY), null);
  assert.equal(L.agingBucket(mkInv('e', 'a', -40, -30, [[1, 1]]), TODAY), '1-30');
  assert.equal(L.agingBucket(mkInv('e', 'a', -40, -31, [[1, 1]]), TODAY), '31-60');
  assert.equal(L.agingBucket(mkInv('e', 'a', -100, -90, [[1, 1]]), TODAY), '61-90');
  assert.equal(L.agingBucket(mkInv('e', 'a', -100, -91, [[1, 1]]), TODAY), '90+');
});
test('agingSummary amounts, counts, customers', () => {
  const { buckets } = plain(L.agingSummary(invoices, customers, TODAY));
  assert.deepEqual(Object.keys(buckets), ['current', '1-30', '31-60', '61-90', '90+']);
  assert.equal(buckets.current.amount, 1900); // 400 + 1500
  assert.equal(buckets.current.count, 2);
  assert.deepEqual(buckets.current.customers, [{ customerId: 'a', name: 'Asha', amount: 1900, count: 2 }]);
  assert.equal(buckets['1-30'].amount, 1000);
  assert.equal(buckets['31-60'].amount, 400);
  assert.equal(buckets['31-60'].customers[0].name, 'Chitra');
  assert.equal(buckets['61-90'].amount, 1500);
  assert.equal(buckets['90+'].amount, 1000);
  assert.equal(buckets['90+'].customers[0].name, 'Bharat');
});

// ---------- receivables ----------
test('receivablesByCustomer: who owes me, how much, since when', () => {
  const rows = plain(L.receivablesByCustomer(invoices, customers, TODAY));
  assert.deepEqual(
    rows.map((r) => r.name),
    ['Asha', 'Bharat', 'Chitra'] // 3900, 2500, 400
  );
  const asha = rows[0];
  assert.equal(asha.outstanding, 1000 + 400 + 1500);
  assert.equal(asha.overdue, 1000);
  assert.equal(asha.openInvoiceCount, 3);
  assert.equal(asha.oldestUnpaidDate, d(-30));
  assert.equal(asha.oldestDays, 30);
  assert.equal(asha.lastPaymentDate, d(-5));
  assert.equal(asha.phone, '9876543210');
  const bharat = rows[1];
  assert.equal(bharat.outstanding, 2500);
  assert.equal(bharat.overdue, 2500);
  assert.equal(bharat.oldestDays, 130);
  const chitra = rows[2];
  assert.equal(chitra.outstanding, 400);
  assert.equal(chitra.lastPaymentDate, d(-34)); // includes payments on paid invoices
});
test('receivablesByCustomer omits fully paid customers', () => {
  const rows = L.receivablesByCustomer([invoices[4]], customers, TODAY);
  assert.equal(rows.length, 0);
});

// ---------- dashboard ----------
test('dashboardTotals', () => {
  const tot = plain(L.dashboardTotals(invoices, bills, TODAY));
  assert.equal(tot.receivable, 1000 + 400 + 1500 + 1000 + 400 + 1500);
  assert.equal(tot.overdue, 1000 + 1500 + 1000 + 400);
  assert.equal(tot.dueNext30, tot.receivable - 1500); // invoice 7 expected in 40 days
  assert.equal(tot.billsNext30, 3000 + 4000); // excludes paid, past-due and far bills
});

// ---------- reminders ----------
test('reminderText and whatsappUrl', () => {
  const text = L.reminderText(invoices[0], customers[0], TODAY);
  assert.match(text, /^Namaste Asha ji/);
  assert.ok(text.includes('INV-1'));
  assert.ok(text.includes('₹1,000'));
  assert.ok(text.includes('due 20 din pehle'));
  assert.ok(L.reminderText(invoices[1], customers[0], TODAY).includes('due aaj'));
  const url = L.whatsappUrl('98123 45678', 'Hi ji 🙏');
  assert.equal(url, `https://wa.me/919812345678?text=${encodeURIComponent('Hi ji 🙏')}`);
});

// ---------- forecast ----------
const fcBase = { openingCash: 10000, invoices, bills, customers, today: TODAY };

test('forecast 90-day week structure', () => {
  const f = L.forecast(Object.assign({ horizonDays: 90 }, fcBase));
  assert.equal(f.weeks.length, 13);
  assert.equal(f.weeks[0].fromDate, T);
  assert.equal(f.weeks[0].toDate, d(6));
  assert.equal(f.weeks[12].fromDate, d(84));
  assert.equal(f.weeks[12].toDate, d(89)); // clipped to horizon
  assert.equal(f.weeks[0].label, 'Week 1');
});
test('forecast 90-day math (exact)', () => {
  const f = plain(L.forecast(Object.assign({ horizonDays: 90 }, fcBase)));
  const w = f.weeks;
  // overdue (1,3,4,6) land today and invoice 2 on d5 -> week 1; invoice 7 on d40 -> week 6
  assert.deepEqual(w[0].inflowItems.map((x) => x.number).sort(), ['INV-1', 'INV-2', 'INV-3', 'INV-4', 'INV-6']);
  const totalIn = 1000 + 400 + 1500 + 1000 + 400 + 1500;
  assert.equal(f.totalInflow, totalIn);
  assert.equal(f.totalOutflow, 999 + 3000 + 4000 + 700);
  assert.equal(f.endingCash, 10000 + totalIn - (999 + 3000 + 4000 + 700));
  assert.equal(w[1].outflow, 4000); // supplier d12 -> week 2
  assert.equal(w[5].inflow, 1500); // d40 -> week 6
  assert.equal(w[7].outflow, 700); // d50 -> week 8
  for (let i = 0; i < w.length; i++) {
    const opening = i === 0 ? 10000 : w[i - 1].closing;
    assert.equal(w[i].opening, opening);
    assert.equal(w[i].closing, opening + w[i].inflow - w[i].outflow);
  }
  assert.equal(f.beyondHorizonInflow, 0);
  assert.equal(f.beyondHorizonOutflow, 0);
  assert.deepEqual(f.negativeWeeks, []);
});
test('forecast week 1 contents', () => {
  const f = plain(L.forecast(Object.assign({ horizonDays: 90 }, fcBase)));
  assert.equal(f.weeks[0].inflow, 1000 + 400 + 1500 + 1000 + 400);
  assert.equal(f.weeks[0].outflow, 999 + 3000);
  assert.equal(f.weeks[0].inflowItems.find((x) => x.number === 'INV-1').date, T);
  assert.equal(f.weeks[0].inflowItems.find((x) => x.number === 'INV-2').date, d(5));
});
test('forecast 30-day horizon puts later items beyond horizon', () => {
  const f = plain(L.forecast(Object.assign({ horizonDays: 30 }, fcBase)));
  assert.equal(f.weeks.length, 5);
  assert.equal(f.weeks[4].toDate, d(29));
  assert.equal(f.beyondHorizonInflow, 1500);
  assert.equal(f.beyondHorizonOutflow, 700);
});
test('forecast flags negative weeks and lowest cash', () => {
  const f = plain(L.forecast(Object.assign({}, fcBase, { horizonDays: 30, openingCash: 0 })));
  // week1: 0 + 4300 - 3999 = 301; week2: 301 - 4000 = -3699
  assert.equal(f.weeks[0].closing, 301);
  assert.equal(f.weeks[1].closing, -3699);
  assert.deepEqual(f.negativeWeeks, ['Week 2', 'Week 3', 'Week 4', 'Week 5']);
  assert.equal(f.lowestCash, -3699);
  assert.equal(f.lowestCashWeek, 'Week 2');
});

// ---------- what-if: customer pays 15 days late ----------
test('scenarioLateCustomer: Asha pays 15 days late (default delay)', () => {
  const r = plain(
    L.scenarioLateCustomer(Object.assign({ horizonDays: 30, customerId: 'a' }, fcBase, { openingCash: 0 }))
  );
  // Asha: INV-1 1000 today -> d15 (week 3), INV-2 400 d5 -> d20 (week 3), INV-7 1500 d40 -> d55 (beyond either way)
  assert.deepEqual(r.changedWeeks, ['Week 1', 'Week 3']);
  assert.equal(r.baseline.weeks[0].inflow, 4300);
  assert.equal(r.scenario.weeks[0].inflow, 2900);
  assert.equal(r.scenario.weeks[2].inflow, 1400);
  assert.equal(r.deltaEndingCash, 0); // money still arrives inside 30 days
  assert.equal(r.deltaLowestCash, -1400);
  assert.deepEqual(
    r.shiftedInvoices.map((x) => [x.number, x.from, x.to, x.amount]),
    [
      ['INV-1', T, d(15), 1000],
      ['INV-2', d(5), d(20), 400],
      ['INV-7', d(40), d(55), 1500],
    ]
  );
});
test('scenarioLateCustomer: delay pushes money past horizon -> ending cash drops', () => {
  const r = plain(L.scenarioLateCustomer(Object.assign({ horizonDays: 30, customerId: 'a', delayDays: 30 }, fcBase)));
  // INV-1 moves today -> d30 and INV-2 d5 -> d35: both fall outside the 30-day window (last day d29)
  assert.equal(r.deltaEndingCash, -1400);
  assert.equal(r.scenario.beyondHorizonInflow, 1500 + 1000 + 400);
});
test('scenarioLateCustomer does not mutate inputs and leaves others alone', () => {
  const before = JSON.stringify(invoices);
  const r = plain(L.scenarioLateCustomer(Object.assign({ horizonDays: 90, customerId: 'c' }, fcBase)));
  assert.equal(JSON.stringify(invoices), before);
  assert.deepEqual(r.shiftedInvoices.map((x) => x.number), ['INV-6']);
});

// ---------- alerts ----------
test('alerts: kinds, severities, ordering', () => {
  const list = plain(L.alerts(invoices, bills, customers, { today: TODAY, openingCash: 0, forecastHorizonDays: 30 }));
  const ids = list.map((a) => a.id);
  // overdue invoices
  ['overdue-1', 'overdue-3', 'overdue-4', 'overdue-6'].forEach((id) => assert.ok(ids.includes(id), id));
  assert.equal(list.find((a) => a.id === 'overdue-4').severity, 'high'); // 100 days
  assert.equal(list.find((a) => a.id === 'overdue-3').severity, 'medium');
  assert.equal(list.find((a) => a.id === 'overdue-1').route, '#/invoices/1');
  assert.equal(list.find((a) => a.id === 'overdue-1').actionLabel, 'Draft reminder');
  // bills: rent in 3 days (medium), old bill 2 days ago (high); supplier d12 & paid excluded
  assert.equal(list.find((a) => a.id === 'bill-x').severity, 'medium');
  assert.equal(list.find((a) => a.id === 'bill-x').title, 'Rent due in 3 days - ₹3,000');
  assert.equal(list.find((a) => a.id === 'bill-z').severity, 'high');
  assert.ok(!ids.includes('bill-y'));
  assert.ok(!ids.includes('bill-w'));
  // projected negative cash
  const cash = list.find((a) => a.id === 'cash-negative');
  assert.ok(cash);
  assert.equal(cash.route, '#/forecast');
  assert.ok(cash.title.includes('-₹3,699'));
  // dormant: Bharat paid 60 days ago -> yes; Asha paid 5 days ago -> no; Chitra paid 34 days ago -> no
  assert.ok(ids.includes('dormant-b'));
  assert.ok(!ids.includes('dormant-a'));
  assert.ok(!ids.includes('dormant-c'));
  // ordering: high first, then medium, then info
  const rank = { high: 0, medium: 1, info: 2 };
  for (let i = 1; i < list.length; i++) assert.ok(rank[list[i - 1].severity] <= rank[list[i].severity]);
  assert.equal(list[0].id, 'cash-negative');
});
test('alerts: unsent invoices after 2 days', () => {
  const inv = [
    mkInv('u1', 'a', -3, 10, [[1, 100]], [], { sent: false }),
    mkInv('u2', 'a', -2, 10, [[1, 100]], [], { sent: false }),
    mkInv('u3', 'a', -9, 10, [[1, 100]], [[-1, 100]], { sent: false }),
  ];
  const ids = L.alerts(inv, [], customers, { today: TODAY, openingCash: 1000 }).map((a) => a.id);
  assert.deepEqual(Array.from(ids), ['unsent-u1']);
});
test('alerts: no negative-cash alert when cash stays positive', () => {
  const list = L.alerts(invoices, bills, customers, { today: TODAY, openingCash: 50000 });
  assert.ok(!list.some((a) => a.kind === 'cash'));
});

// ---------- sample dataset ----------
test('sample data is generated relative to today and has the promised shape', () => {
  const s = plain(SampleData.generate(TODAY));
  assert.ok(s.customers.length >= 8 && s.customers.length <= 10);
  s.customers.forEach((c) => assert.match(c.phone, /^\d{10}$/));
  assert.ok(s.invoices.length >= 15 && s.invoices.length <= 20);
  assert.equal(s.settings.openingCash, 18500);
  const statuses = new Set(s.invoices.map((i) => L.invoiceStatus(i)));
  ['paid', 'partial', 'unpaid'].forEach((st) => assert.ok(statuses.has(st), st));
  const overdueDays = s.invoices.filter((i) => L.isOverdue(i, TODAY)).map((i) => L.daysOverdue(i, TODAY));
  [5, 12, 25, 40, 70, 100].forEach((n) => assert.ok(overdueDays.includes(n), `overdue ${n}`));
  assert.ok(s.invoices.some((i) => i.sent === false));
  assert.ok(s.invoices.some((i) => i.dueDate > T && L.invoiceBalance(i) > 0));
  const upcoming = s.bills.filter((b) => !b.paid);
  assert.ok(upcoming.length >= 4 && upcoming.length <= 5);
  assert.ok(upcoming.some((b) => L.diffDays(b.dueDate, T) >= 0 && L.diffDays(b.dueDate, T) <= 3));
  // fully paid invoices really are fully paid
  s.invoices.forEach((i) => assert.ok(L.invoiceBalance(i) >= 0, i.number));
});
test('sample data: Patel 15 days late pushes cash negative (demo scenario)', () => {
  const s = SampleData.generate(TODAY);
  const r = L.scenarioLateCustomer({
    horizonDays: 30,
    openingCash: s.settings.openingCash,
    invoices: s.invoices,
    bills: s.bills,
    customers: s.customers,
    customerId: 'c9',
    today: TODAY,
  });
  assert.equal(r.baseline.negativeWeeks.length, 0);
  assert.ok(r.scenario.negativeWeeks.length > 0);
  assert.ok(r.deltaLowestCash < 0);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
