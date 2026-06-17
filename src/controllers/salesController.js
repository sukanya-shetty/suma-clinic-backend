const pool = require('../config/db');

// ===== FUNCTION 1: createSale() =====
// Purpose: Record a walk-in sale or consultation sale, reducing stock accordingly
// Body: { patient_id (optional), medicine_id, quantity_sold, sale_type }
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

    // 1. Fetch medicine details (name, stock price)
    const [meds] = await connection.query(
      'SELECT medicine_name, quantity, price FROM medicines WHERE medicine_id = ?',
      [medicine_id]
    );

    if (meds.length === 0) {
      connection.release();
      return res.status(404).json({ error: 'Medicine not found' });
    }

    const { medicine_name, quantity: currentStock, price } = meds[0];

    // 2. Check stock limit
    if (currentStock < quantity_sold) {
      connection.release();
      return res.status(400).json({ 
        error: `Insufficient stock for ${medicine_name}. Available: ${currentStock}, Requested: ${quantity_sold}` 
      });
    }

    // 3. Update stock
    const newStock = currentStock - quantity_sold;
    await connection.query(
      'UPDATE medicines SET quantity = ? WHERE medicine_id = ?',
      [newStock, medicine_id]
    );

    // 4. Create sale record
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

    // 5. Low stock alerts check
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

// ===== FUNCTION 2: getAllSales() =====
// Purpose: Fetch all recorded sales, optionally filter by date range and type
// Query: startDate, endDate, sale_type
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

// ===== FUNCTION 3: getDailySalesSummary() =====
// Purpose: Fetch daily sales statistics (Total amount and count for today)
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

module.exports = {
  createSale,
  getAllSales,
  getDailySalesSummary
};
