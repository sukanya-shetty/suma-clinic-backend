const pool = require('../src/config/db');

async function updateDoctor() {
  try {
    const [result] = await pool.query("UPDATE doctors SET name = 'Dr. Abhinava Shetty', email = 'dr.shetty@clinic.com' WHERE doctor_id = 1");
    console.log("Updated doctor ID 1 success:", result.affectedRows);
    
    const [rows] = await pool.query("SELECT * FROM doctors WHERE doctor_id = 1");
    console.log("Current doctor details:", rows[0]);
  } catch (error) {
    console.error("Error updating doctor:", error);
  } finally {
    await pool.end();
  }
}

updateDoctor();
