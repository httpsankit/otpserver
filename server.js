const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json()); // express has body parser built-in

// Postgres connection
const pool = new Pool({
  host: 'aws-1-ap-south-1.pooler.supabase.com',
  port: 6543,
  user: 'postgres.wtdmypdozbkclvlbguzf',
  password: 'A@anand123',
  database: 'postgres',
});

// ✅ Endpoint to save OTP
app.post('/save-otp', async (req, res) => {
  const { username, otp, sender, isUsed } = req.body;

  if (!username || !otp) {
    return res.status(400).json({ error: 'Missing username or otp' });
  }

  try {
    const query = `
      INSERT INTO otp (username, otp, sender, "isUsed")
      VALUES ($1, $2, $3, $4)
      RETURNING *;
    `;

    const values = [username, otp, sender || null, isUsed || false];

    const result = await pool.query(query, values);
    console.log(`✅ Saved OTP for user: ${username}, otp: ${otp}`);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('❌ Database error:', err);
    res.status(500).json({ error: 'DB error' });
  }
});


// ✅ Endpoint to get latest unused OTP
app.post('/getMsg', async (req, res) => {
  const { username } = req.body;

  if (!username) {
    return res.status(400).json({ error: 'Missing username' });
  }

  try {
    const query = `
      SELECT otp 
      FROM otp
      WHERE username = $1 AND "isUsed" = false
      ORDER BY "createdat" DESC
      LIMIT 1;
    `;

    const result = await pool.query(query, [username]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'No unused OTP found for this user' });
    }

    console.log(`📩 Latest OTP fetched for user: ${username}`);
    res.json(result.rows[0].otp);
  } catch (err) {
    console.error('❌ Database error:', err);
    res.status(500).json({ error: 'DB error' });
  }
});

// ✅ Endpoint to mark OTP as used
app.post('/setTrue', async (req, res) => {
  const { username, otp } = req.body;

  if (!username || !otp) {
    return res.status(400).json({ error: 'Missing username or otp' });
  }

  try {
    const query = `
      UPDATE otp
      SET "isUsed" = true
      WHERE username = $1 AND otp = $2
      RETURNING *;
    `;

    const result = await pool.query(query, [username, otp]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'No matching OTP found for this user' });
    }

    console.log(`✅ OTP marked as used for user: ${username}, otp: ${otp}`);
    res.json({ message: 'OTP marked as used', data: result.rows[0] });
  } catch (err) {
    console.error('❌ Database error:', err);
    res.status(500).json({ error: 'DB error' });
  }
});



// ✅ Health check
app.get('/', (req, res) => res.send('OTP backend running 🚀'));

// ✅ Start server
app.listen(3000, () => console.log('🚀 Server running on port 3000'));
