const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config();

async function run() {
  console.log('Connecting to database using environment config...');
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: parseInt(process.env.DB_PORT || 3306),
    multipleStatements: true
  });

  try {
    const migrationPath = path.join(__dirname, '../../database/migration_part2.sql');
    console.log('Reading migration file from:', migrationPath);
    const sql = fs.readFileSync(migrationPath, 'utf8');
    
    console.log('Executing migration SQL statements...');
    await connection.query(sql);
    
    console.log('Migration completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    await connection.end();
  }
}

run();
