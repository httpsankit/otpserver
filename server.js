const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Postgres connection
const pool = new Pool({
  host: 'aws-1-ap-south-1.pooler.supabase.com',       // अपने DB host/IP डालो
  port: 6543,
  user: 'postgres.wtdmypdozbkclvlbguzf',        // DB username
  password: 'A@anand123', // DB password
  database: 'postgres',    // DB name
});

// Endpoint to save OTP
app.post('/save-otp', async (req, res) => {
  const { username, otp, sender, timestamp, isUsed } = req.body;

  if (!username || !otp) {
    return res.status(400).json({ error: 'Missing username or otp' });
  }

  try {
    const query = `
      INSERT INTO otp (username, otp, sender, "createdAt", "isUsed")
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *;
    `;

    const createdAt = timestamp || new Date().toISOString();
    const values = [username, otp, sender || null, createdAt, isUsed || false];

    const result = await pool.query(query, values);
    console.log(`Saved OTP for user: ${username}, otp: ${otp}`);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: 'DB error' });
  }
});

// Health check
app.get('/', (req, res) => res.send('OTP backend running'));

app.listen(3000, () => console.log('Server running on port 3000'));
