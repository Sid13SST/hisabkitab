/* HisabKitab sample dataset for a small kirana store.
 * Every date is generated RELATIVE TO TODAY so the demo never goes stale.
 * Depends on js/logic.js (Logic.addDays / Logic.todayYmd). Works in the browser
 * (window.SampleData) and under Node vm (globalThis.SampleData). */
(function () {
  'use strict';

  const root = typeof window !== 'undefined' ? window : globalThis;

  // Common wholesale items with believable rates (₹ per unit).
  const ITEMS = {
    rice: ['Basmati rice, 25 kg bag', 1850],
    sonaMasoori: ['Sona Masoori rice, 25 kg bag', 1350],
    atta: ['Aashirvaad atta, 10 kg bag', 455],
    sugar: ['Sugar, 50 kg bag', 2150],
    mustardOil: ['Mustard oil, 15 L tin', 2350],
    refinedOil: ['Refined sunflower oil, 15 L tin', 2080],
    toorDal: ['Toor dal, 30 kg bag', 3900],
    chanaDal: ['Chana dal, 25 kg bag', 2250],
    besan: ['Besan, 10 kg bag', 880],
    tea: ['Tata Tea Premium, 1 kg pack', 520],
    parleG: ['Parle-G biscuits, carton (48 pkts)', 480],
    goodDay: ['Good Day biscuits, carton (24 pkts)', 620],
    maggi: ['Maggi noodles, carton (96 pkts)', 1150],
    salt: ['Tata salt, 1 kg (bundle of 25)', 550],
    detergent: ['Surf Excel, 5 kg bag', 690],
    soap: ['Lifebuoy soap, carton (72 pcs)', 1580],
    ghee: ['Amul ghee, 1 L tin', 640],
    poha: ['Poha, 25 kg bag', 1300],
    milkPowder: ['Milk powder, 1 kg pack', 410],
  };

  const li = (key, qty) => ({ description: ITEMS[key][0], qty, rate: ITEMS[key][1] });

  function generate(today = new Date()) {
    const t = root.Logic.todayYmd(today);
    const d = (n) => root.Logic.addDays(t, n);

    const customers = [
      { id: 'c1', name: 'Ramesh Gupta (Gupta Tea Stall)', phone: '9876543210' },
      { id: 'c2', name: 'Sunita Sharma', phone: '9812345678' },
      { id: 'c3', name: 'Mohammed Irfan (Irfan Dhaba)', phone: '9830012345' },
      { id: 'c4', name: 'Priya Nair', phone: '9845098450' },
      { id: 'c5', name: 'Rajesh Yadav (Yadav Sweets)', phone: '9935512340' },
      { id: 'c6', name: 'Anita Deshmukh', phone: '9822045671' },
      { id: 'c7', name: 'Harpreet Singh (Singh Canteen)', phone: '9815566778' },
      { id: 'c8', name: 'Lakshmi Iyer', phone: '9884123456' },
      { id: 'c9', name: 'Vikram Patel (Patel Hostel Mess)', phone: '9824098765' },
    ].map((c) => Object.assign(c, { isSample: true })); // demo records: contact buttons stay disabled

    // issue/due offsets are days from today; negative = in the past.
    const inv = (id, number, customerId, issue, due, lineItems, extra = {}) =>
      Object.assign(
        {
          id,
          number,
          customerId,
          issueDate: d(issue),
          dueDate: d(due),
          expectedPaymentDate: null,
          sent: true,
          lineItems,
          payments: [],
        },
        extra
      );

    const invoices = [
      // --- fully paid history ---
      inv('i01', 'HK-0101', 'c1', -155, -140, [li('tea', 4), li('sugar', 1), li('parleG', 3)], {
        payments: [{ date: d(-140), amount: 5670 }],
      }),
      inv('i02', 'HK-0102', 'c9', -60, -45, [li('sonaMasoori', 4), li('toorDal', 1), li('refinedOil', 2)], {
        payments: [{ date: d(-50), amount: 10000 }, { date: d(-38), amount: 3460 }],
      }),
      inv('i03', 'HK-0103', 'c4', -50, -35, [li('atta', 3), li('ghee', 2), li('milkPowder', 2)], {
        payments: [{ date: d(-36), amount: 3465 }],
      }),
      inv('i04', 'HK-0104', 'c6', -30, -15, [li('rice', 1), li('detergent', 2), li('soap', 1)], {
        payments: [{ date: d(-16), amount: 4810 }],
      }),
      inv('i05', 'HK-0105', 'c8', -15, 0, [li('poha', 1), li('tea', 2), li('salt', 1)], {
        payments: [{ date: d(-9), amount: 2890 }],
      }),

      // --- overdue: 100, 70, 40, 25, 12, 5 days ---
      inv('i06', 'HK-0106', 'c1', -115, -100, [li('sugar', 1), li('tea', 3), li('parleG', 2), li('goodDay', 1)], {
        expectedPaymentDate: d(20),
      }),
      inv('i07', 'HK-0107', 'c3', -85, -70, [li('refinedOil', 2), li('chanaDal', 1), li('besan', 2), li('atta', 4)], {
        payments: [{ date: d(-60), amount: 2000 }],
      }),
      inv('i08', 'HK-0108', 'c5', -55, -40, [li('sugar', 2), li('ghee', 4), li('besan', 3)], {
        expectedPaymentDate: d(10),
      }),
      inv('i09', 'HK-0109', 'c7', -40, -25, [li('maggi', 2), li('tea', 2), li('refinedOil', 1), li('parleG', 2)], {
        payments: [{ date: d(-20), amount: 2500 }],
      }),
      inv('i10', 'HK-0110', 'c9', -27, -12, [li('sonaMasoori', 5), li('toorDal', 1), li('atta', 6), li('refinedOil', 1)], {
        expectedPaymentDate: d(5),
      }),
      inv('i11', 'HK-0111', 'c2', -20, -5, [li('atta', 2), li('mustardOil', 1), li('detergent', 1)]),

      // --- not yet due ---
      inv('i12', 'HK-0112', 'c9', -8, 7, [li('sonaMasoori', 4), li('sugar', 1), li('chanaDal', 1), li('mustardOil', 1)], {
        expectedPaymentDate: d(7),
      }),
      inv('i13', 'HK-0113', 'c2', -6, 9, [li('rice', 1), li('goodDay', 1), li('tea', 1)], {
        payments: [{ date: d(-6), amount: 1000 }],
      }),
      inv('i14', 'HK-0114', 'c5', -4, 11, [li('sugar', 1), li('ghee', 2), li('milkPowder', 3)], {
        sent: false,
      }),
      inv('i15', 'HK-0115', 'c4', -3, 12, [li('atta', 2), li('salt', 1), li('soap', 1)]),
      inv('i16', 'HK-0116', 'c6', -10, 20, [li('poha', 1), li('besan', 1), li('detergent', 2)], {
        expectedPaymentDate: d(25),
      }),
      inv('i17', 'HK-0117', 'c7', -1, 14, [li('maggi', 1), li('parleG', 3), li('tea', 2)], {
        sent: false,
      }),
      inv('i18', 'HK-0118', 'c3', -2, 28, [li('refinedOil', 2), li('chanaDal', 1), li('atta', 3)], {
        expectedPaymentDate: d(40),
      }),
      inv('i19', 'HK-0119', 'c8', -5, 25, [li('rice', 1), li('toorDal', 1), li('ghee', 1)], {
        expectedPaymentDate: d(70),
      }),
    ];

    const bills = [
      { id: 'b1', title: 'Shop rent', amount: 12000, dueDate: d(2), paid: false },
      { id: 'b2', title: 'Electricity bill (MSEB)', amount: 3240, dueDate: d(6), paid: false },
      { id: 'b3', title: 'Supplier: Agarwal Traders (rice, dal)', amount: 38500, dueDate: d(10), paid: false },
      { id: 'b4', title: 'Helper salary (Raju)', amount: 9000, dueDate: d(18), paid: false },
      { id: 'b5', title: 'Supplier: Shree Oil Depot', amount: 18750, dueDate: d(33), paid: false },
      { id: 'b6', title: 'Shop rent', amount: 12000, dueDate: d(-28), paid: true },
    ];

    return {
      version: 1,
      customers,
      invoices,
      bills,
      settings: { openingCash: 18500, horizonDays: 90 },
      seenAlertIds: [],
    };
  }

  // Sample customer ids + phones, used to re-flag demo records saved before isSample existed.
  const SAMPLE_PHONES = {
    c1: '9876543210', c2: '9812345678', c3: '9830012345', c4: '9845098450', c5: '9935512340',
    c6: '9822045671', c7: '9815566778', c8: '9884123456', c9: '9824098765',
  };

  // True only for customers that came from this sample dataset.
  function isDemoCustomer(c) {
    return !!c && c.isSample === true;
  }

  // The one place a user-entered customer record is built. It never carries isSample,
  // so WhatsApp / Call actions always work for customers the owner adds.
  function createCustomer(id, name, phone) {
    return { id, name, phone };
  }

  // Older saved stores (before the flag existed): re-flag untouched sample customers.
  function restoreSampleFlags(customers) {
    (customers || []).forEach((c) => {
      if (c && c.isSample === undefined && SAMPLE_PHONES[c.id] === c.phone) c.isSample = true;
    });
    return customers;
  }

  root.SampleData = { generate, ITEMS, isDemoCustomer, createCustomer, restoreSampleFlags };
})();
