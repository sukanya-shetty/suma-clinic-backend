const pool = require('../config/db');

// Helper to generate unique bill numbers
const generateBillNumber = () => {
  const prefix = 'BILL';
  const timestamp = Date.now();
  const random = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}-${timestamp}-${random}`;
};

// ===== FUNCTION 1: dispensePrescription() =====
// Action: Confirm dispensing, deduct stock, log transaction, record sale, and create invoice/bill
// Input: { visit_id, items: [ { prescription_id, dispensed_quantity } ], signature_ref }
const dispensePrescription = async (req, res) => {
  if (!req.user || req.user.role !== 'Pharmacist') {
    return res.status(403).json({ error: 'Access denied. Only Pharmacists can dispense prescriptions.' });
  }

  const { visit_id, items, signature_ref } = req.body;

  if (!visit_id || !items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'visit_id and items array are required' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // 1. Fetch patient ID and details from the visit
    const [visitData] = await connection.query(
      `SELECT v.visit_id, v.patient_id, p.patient_name 
       FROM visits v 
       JOIN patients p ON v.patient_id = p.patient_id 
       WHERE v.visit_id = ?`,
      [visit_id]
    );

    if (visitData.length === 0) {
      connection.release();
      return res.status(404).json({ error: 'Visit not found' });
    }

    const { patient_id, patient_name } = visitData[0];
    let totalBillAmount = 0;
    const dispensedItems = [];

    // 2. Process each medicine line item
    for (const item of items) {
      const { prescription_id, dispensed_quantity } = item;

      if (!prescription_id || dispensed_quantity === undefined || dispensed_quantity < 0) {
        throw new Error('Invalid item fields: prescription_id and positive dispensed_quantity are required.');
      }

      // Get prescription details
      const [presCheck] = await connection.query(
        `SELECT p.*, m.medicine_name 
         FROM prescriptions p 
         LEFT JOIN medicines m ON p.medicine_id = m.medicine_id 
         WHERE p.prescription_id = ? AND p.visit_id = ?`,
        [prescription_id, visit_id]
      );

      if (presCheck.length === 0) {
        throw new Error(`Prescription line item ${prescription_id} not found for this visit.`);
      }

      const prescription = presCheck[0];

      if (prescription.dispensed_at) {
        throw new Error(`Medicine "${prescription.medicine_name}" has already been dispensed.`);
      }

      // Check medicine inventory
      const [medCheck] = await connection.query(
        'SELECT quantity, price, medicine_name FROM medicines WHERE medicine_id = ?',
        [prescription.medicine_id]
      );

      if (medCheck.length === 0) {
        throw new Error(`Medicine "${prescription.medicine_name}" not found in inventory.`);
      }

      const medicine = medCheck[0];

      if (medicine.quantity < dispensed_quantity) {
        throw new Error(`Insufficient stock for "${medicine.medicine_name}". Available: ${medicine.quantity}, Dispensing: ${dispensed_quantity}`);
      }

      // Deduct stock from medicines
      const newQty = medicine.quantity - dispensed_quantity;
      await connection.query(
        'UPDATE medicines SET quantity = ? WHERE medicine_id = ?',
        [newQty, prescription.medicine_id]
      );

      // Log to inventory_transactions
      await connection.query(
        'INSERT INTO inventory_transactions (medicine_id, type, quantity, performed_by) VALUES (?, ?, ?, ?)',
        [prescription.medicine_id, 'dispense', dispensed_quantity, req.user.id]
      );

      // Create a sale record
      const lineTotal = medicine.price * dispensed_quantity;
      totalBillAmount += lineTotal;

      await connection.query(
        `INSERT INTO sales (patient_id, medicine_name, quantity_sold, price_per_unit, total_amount, sale_type, created_by) 
         VALUES (?, ?, ?, ?, ?, 'Consultation', ?)`,
        [patient_id, medicine.medicine_name, dispensed_quantity, medicine.price, lineTotal, req.user.id]
      );

      // Update prescription table record
      await connection.query(
        `UPDATE prescriptions 
         SET dispensed_quantity = ?, dispensed_by = ?, dispensed_at = CURRENT_TIMESTAMP, quantity = ?
         WHERE prescription_id = ?`,
        [dispensed_quantity, req.user.id, dispensed_quantity, prescription_id]
      );

      // Low stock warnings
      if (newQty < 10) {
        await connection.query(
          'INSERT INTO alerts (medicine_id, alert_type, message) VALUES (?, ?, ?)',
          [prescription.medicine_id, 'LOW_STOCK', `${medicine.medicine_name} stock low: ${newQty} units remaining.`]
        );
      }

      dispensedItems.push({
        medicine_name: medicine.medicine_name,
        quantity: dispensed_quantity,
        price_per_unit: medicine.price,
        total: lineTotal
      });
    }

    // 3. Create unique bill record
    const billNumber = generateBillNumber();
    const [billResult] = await connection.query(
      `INSERT INTO bills (bill_number, patient_id, visit_id, total_amount, signature_ref) 
       VALUES (?, ?, ?, ?, ?)`,
      [billNumber, patient_id, visit_id, totalBillAmount, signature_ref || null]
    );

    await connection.commit();
    connection.release();

    return res.status(201).json({
      success: true,
      message: 'Prescription dispensed and bill generated successfully',
      bill: {
        bill_id: billResult.insertId,
        bill_number: billNumber,
        patient_name,
        patient_id,
        visit_id,
        total_amount: totalBillAmount,
        signature_ref: signature_ref || null,
        created_at: new Date(),
        items: dispensedItems
      }
    });

  } catch (error) {
    await connection.rollback();
    connection.release();
    console.error('Dispensing error:', error);
    return res.status(500).json({ error: error.message || 'Database error during dispensing action' });
  }
};

// ===== FUNCTION 2: createSale() (Direct Walk-in / Over the Counter) =====
const createSale = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const { patient_id, medicine_id, quantity_sold, sale_type } = req.body;
    const created_by = req.user ? req.user.id : null;

    if (!medicine_id || !quantity_sold) {
      connection.release();
      return res.status(400).json({ error: 'medicine_id and quantity_sold are required' });
    }

    if (quantity_sold <= 0) {
      connection.release();
      return res.status(400).json({ error: 'Quantity sold must be positive' });
    }

    const [meds] = await connection.query(
      'SELECT medicine_name, quantity, price FROM medicines WHERE medicine_id = ?',
      [medicine_id]
    );

    if (meds.length === 0) {
      connection.release();
      return res.status(404).json({ error: 'Medicine not found' });
    }

    const { medicine_name, quantity: currentStock, price } = meds[0];

    if (currentStock < quantity_sold) {
      connection.release();
      return res.status(400).json({ 
        error: `Insufficient stock for ${medicine_name}. Available: ${currentStock}, Requested: ${quantity_sold}` 
      });
    }

    const newStock = currentStock - quantity_sold;
    await connection.query(
      'UPDATE medicines SET quantity = ? WHERE medicine_id = ?',
      [newStock, medicine_id]
    );

    // Log transaction
    await connection.query(
      'INSERT INTO inventory_transactions (medicine_id, type, quantity, performed_by) VALUES (?, ?, ?, ?)',
      [medicine_id, 'dispense', quantity_sold, created_by]
    );

    const total_amount = price * quantity_sold;
    const [saleResult] = await connection.query(
      `INSERT INTO sales (patient_id, medicine_name, quantity_sold, price_per_unit, total_amount, sale_type, created_by) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        patient_id || null, 
        medicine_name, 
        quantity_sold, 
        price, 
        total_amount, 
        sale_type || 'Direct Walk-in', 
        created_by
      ]
    );

    if (newStock < 10) {
      await connection.query(
        'INSERT INTO alerts (medicine_id, alert_type, message) VALUES (?, ?, ?)',
        [medicine_id, 'LOW_STOCK', `${medicine_name} stock low: ${newStock} units remaining.`]
      );
    }

    await connection.commit();
    connection.release();

    return res.status(201).json({
      message: 'Sale transaction processed successfully',
      sale: {
        sale_id: saleResult.insertId,
        medicine_name,
        quantity_sold,
        price,
        total_amount,
        sale_type: sale_type || 'Direct Walk-in'
      }
    });

  } catch (error) {
    await connection.rollback();
    connection.release();
    console.error('Error in createSale:', error);
    return res.status(500).json({ error: 'Database transaction error during sale registration' });
  }
};

// ===== FUNCTION 3: getAllSales() =====
const getAllSales = async (req, res) => {
  try {
    const { startDate, endDate, sale_type } = req.query;
    let query = `
      SELECT s.sale_id, s.patient_id, p.patient_name, s.medicine_name, 
             s.quantity_sold, s.price_per_unit, s.total_amount, s.sale_type, s.sale_date
      FROM sales s
      LEFT JOIN patients p ON s.patient_id = p.patient_id
      WHERE 1=1
    `;
    const params = [];

    if (startDate) {
      query += ' AND DATE(s.sale_date) >= ?';
      params.push(startDate);
    }

    if (endDate) {
      query += ' AND DATE(s.sale_date) <= ?';
      params.push(endDate);
    }

    if (sale_type) {
      query += ' AND s.sale_type = ?';
      params.push(sale_type);
    }

    query += ' ORDER BY s.sale_date DESC';

    const [sales] = await pool.query(query, params);

    return res.status(200).json({
      success: true,
      sales
    });

  } catch (error) {
    console.error('Error in getAllSales:', error);
    return res.status(500).json({ error: 'Database error fetching sales list' });
  }
};

// ===== FUNCTION 4: getDailySalesSummary() =====
const getDailySalesSummary = async (req, res) => {
  try {
    const [summary] = await pool.query(
      `SELECT COALESCE(SUM(total_amount), 0) as totalSales, COUNT(*) as count 
       FROM sales 
       WHERE DATE(sale_date) = CURRENT_DATE`
    );

    return res.status(200).json({
      success: true,
      summary: summary[0]
    });
  } catch (error) {
    console.error('Error in getDailySalesSummary:', error);
    return res.status(500).json({ error: 'Database error fetching daily sales summary' });
  }
};

// ===== FUNCTION 5: getAllBills() =====
const getAllBills = async (req, res) => {
  try {
    const [bills] = await pool.query(
      `SELECT b.bill_id, b.bill_number, b.patient_id, p.patient_name, b.visit_id, b.total_amount, b.created_at 
       FROM bills b 
       JOIN patients p ON b.patient_id = p.patient_id 
       ORDER BY b.created_at DESC`
    );

    return res.status(200).json({
      success: true,
      bills
    });
  } catch (error) {
    console.error('Error in getAllBills:', error);
    return res.status(500).json({ error: 'Database error fetching bills list' });
  }
};

// ===== FUNCTION 6: getBillDetails() =====
const getBillDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const [billData] = await pool.query(
      `SELECT b.bill_id, b.bill_number, b.patient_id, p.patient_name, b.visit_id, b.total_amount, b.signature_ref, b.created_at 
       FROM bills b 
       JOIN patients p ON b.patient_id = p.patient_id 
       WHERE b.bill_id = ? OR b.bill_number = ?`,
      [id, id]
    );

    if (billData.length === 0) {
      return res.status(404).json({ error: 'Bill not found' });
    }

    const bill = billData[0];

    // Fetch items dispensed for this visit
    const [items] = await pool.query(
      `SELECT medicine_name, quantity, price as price_per_unit, (quantity * price) as total 
       FROM prescriptions 
       WHERE visit_id = ? AND dispensed_at IS NOT NULL`,
      [bill.visit_id]
    );

    return res.status(200).json({
      success: true,
      bill: {
        ...bill,
        items
      }
    });
  } catch (error) {
    console.error('Error in getBillDetails:', error);
    return res.status(500).json({ error: 'Database error fetching bill details' });
  }
};

module.exports = {
  dispensePrescription,
  createSale,
  getAllSales,
  getDailySalesSummary,
  getAllBills,
  getBillDetails
};
