const mysql = require('mysql2/promise');
require('dotenv').config();

async function checkLocalData() {
  let connection;
  try {
    connection = await mysql.createConnection({
      host: process.env.DB_HOST || '127.0.0.1',
      port: process.env.DB_PORT || 3306,
      user: process.env.DB_USER || 'clinic_user',
      password: process.env.DB_PASSWORD || 'clinic@Secure123',
      database: process.env.DB_NAME || 'clinic_management_db'
    });

    console.log('Connected to MySQL successfully!');
    
    const tables = [
      'doctors',
      'staff',
      'patients',
      'visits',
      'medicines',
      'prescriptions',
      'sales',
      'alerts',
      'audit_log'
    ];

    for (const table of tables) {
      try {
        const [rows] = await connection.query(`SELECT COUNT(*) as count FROM ${table}`);
        console.log(`Table: ${table} - Count: ${rows[0].count}`);
      } catch (err) {
        console.log(`Table: ${table} - Check failed: ${err.message}`);
      }
    }
  } catch (error) {
    console.error('Failed to connect to local MySQL:', error.message);
  } finally {
    if (connection) await connection.end();
  }
}

checkLocalData();
