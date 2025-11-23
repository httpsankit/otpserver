const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const AdmZip = require('adm-zip');

const app = express();
app.use(cors());
app.use(express.json()); // for application/json

// ✅ PostgreSQL connection
const pool = new Pool({
  host: 'aws-1-ap-south-1.pooler.supabase.com',
  port: 6543,
  user: 'postgres.wtdmypdozbkclvlbguzf',
  password: 'A@anand123',
  database: 'postgres',
});

// ✅ Additional PostgreSQL connection for VLEHUB (kanak_kanak DB)
const vlehubPool = new Pool({
  host: 'osk.domcloud.co',
  user: 'kanak',
  password: 'dY+rNW4e2(Vz41Ch2+',
  database: 'kanak_kanak',
  port: 5432, // default PostgreSQL port
});


// ✅ Ensure images folder exists
const imagesDir = path.join(__dirname, 'images');
if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir);

// ✅ Multer config for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, imagesDir);
  },
  filename: function (req, file, cb) {
      const userid = req.body.userid || "user";
      const aadharno = req.body.aadharno || "aadhar";
      const ext = path.extname(file.originalname);

      const finalName = `${userid}_${aadharno}_${file.fieldname}${ext}`;
      cb(null, finalName);
  }
});
const upload = multer({ storage });

// ===================== OTP Endpoints =====================

// Save OTP
app.post('/save-otp', async (req, res) => {
  const { username, otp, sender, isUsed } = req.body;
  if (!username || !otp) return res.status(400).json({ error: 'Missing username or otp' });

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
    console.error('❌ DB error:', err);
    res.status(500).json({ error: 'DB error' });
  }
});

// Get latest unused OTP
app.post('/getMsg', async (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'Missing username' });

  try {
    const query = `
      SELECT otp 
      FROM otp
      WHERE username = $1 AND "isUsed" = false
      ORDER BY "createdat" DESC
      LIMIT 1;
    `;
    const result = await pool.query(query, [username]);
    if (result.rows.length === 0) return res.status(404).json({ message: 'No unused OTP found' });

    console.log(`📩 Latest OTP fetched for user: ${username}`);
    res.json(result.rows[0].otp);
  } catch (err) {
    console.error('❌ DB error:', err);
    res.status(500).json({ error: 'DB error' });
  }
});

// Mark OTP as used
app.post('/setTrue', async (req, res) => {
  const { username, otp } = req.body;
  if (!username || !otp) return res.status(400).json({ error: 'Missing username or otp' });

  try {
    const query = `
      UPDATE otp
      SET "isUsed" = true
      WHERE username = $1 AND otp = $2
      RETURNING *;
    `;
    const result = await pool.query(query, [username, otp]);
    if (result.rows.length === 0) return res.status(404).json({ message: 'No matching OTP found' });

    console.log(`✅ OTP marked as used for user: ${username}, otp: ${otp}`);
    res.json({ message: 'OTP marked as used', data: result.rows[0] });
  } catch (err) {
    console.error('❌ DB error:', err);
    res.status(500).json({ error: 'DB error' });
  }
});

// ===================== Live Amount Endpoint =====================
app.post('/aadhar/liveamount', async (req, res) => {
  const { amount, utrno, txndate } = req.body;
  if (!amount || !utrno || !txndate) return res.status(400).json({ error: 'Missing fields' });

  try {
    const query = `
      INSERT INTO liveamount (amount, utrno, txndate)
      VALUES ($1, $2, $3)
      RETURNING *;
    `;
    const result = await pool.query(query, [amount, utrno, txndate]);
    console.log(`💸 Live amount added: ₹${amount}, UTR: ${utrno}`);
    res.json({ message: 'Live amount saved', data: result.rows[0] });
  } catch (err) {
    console.error('❌ DB error:', err);
    res.status(500).json({ error: 'DB error' });
  }
});

// ===================== Aadhar Save Data (with balance check + image upload) =====================
app.post('/aadhar/saveData', upload.fields([
  { name: 'pic1', maxCount: 1 },
  { name: 'pic2', maxCount: 1 },
  { name: 'pic3', maxCount: 1 },
  { name: 'pic4', maxCount: 1 },
  { name: 'pic5', maxCount: 1 }
]), async (req, res) => {
  const client = await pool.connect(); // ✅ To use transaction
  try {
    const { userid, username, aadharno, name, mobile, state, distributorid } = req.body;

    if (!userid || !username || !aadharno || !name || !mobile || !state || !distributorid) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // ✅ Extract file paths
    const pic1path = req.files.pic1 ? req.files.pic1[0].filename : null;
    const pic2path = req.files.pic2 ? req.files.pic2[0].filename : null;
    const pic3path = req.files.pic3 ? req.files.pic3[0].filename : null;
    const pic4path = req.files.pic4 ? req.files.pic4[0].filename : null;
    const pic5path = req.files.pic5 ? req.files.pic5[0].filename : null;

    // ✅ Begin transaction
    await client.query('BEGIN');

    // 1️⃣ Get user balance from aadhar_users
    const userRes = await client.query(
      'SELECT balance FROM aadhar_users WHERE id = $1 AND username = $2',
      [userid, username]
    );

    if (userRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User not found' });
    }

    const userBalance = parseFloat(userRes.rows[0].balance) || 0;

    // 2️⃣ Get aadharamount from msg table (assume latest record)
    const msgRes = await client.query('SELECT aadharamount FROM msg ORDER BY currentversion DESC LIMIT 1');
    const aadharAmount = parseFloat(msgRes.rows[0]?.aadharamount) || 0;

    // 3️⃣ Check balance
    const newBalance = userBalance - aadharAmount;
    if (newBalance < 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Insufficient balance. Please recharge your account.' });
    }

    // 4️⃣ Save Aadhar data
    const insertQuery = `
      INSERT INTO aadhardata (
        userid, username, aadharno, "name", mobile, state, distributorid,
        pic1path, pic2path, pic3path, pic4path, pic5path
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING *;
    `;
    const insertValues = [userid, username, aadharno, name, mobile, state, distributorid,
      pic1path, pic2path, pic3path, pic4path, pic5path];
    const aadharRes = await client.query(insertQuery, insertValues);

    // 5️⃣ Update user balance
    await client.query(
      'UPDATE aadhar_users SET balance = $1 WHERE id = $2 AND username = $3',
      [newBalance, userid, username]
    );

    // ✅ Commit transaction
    await client.query('COMMIT');

    console.log(`✅ Aadhar data saved for user: ${username} | Amount deducted: ${aadharAmount}`);
    res.json({
      message: 'Aadhar data saved successfully',
      deducted: aadharAmount,
      remaining_balance: newBalance,
      data: aadharRes.rows[0]
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error saving Aadhar data:', err);
    res.status(500).json({ error: 'Database error' });
  } finally {
    client.release();
  }
});

// ✅ Aadhar: loginCheck
app.post('/aadhar/loginCheck', async (req, res) => {
  const { username, password, processorid } = req.body;

  // ✅ Check all required fields
  if (!username || !password || !processorid) {
    return res.status(400).json({
      error: 'Missing required fields: username, password, processorid'
    });
  }

  try {
    // Step 1️⃣: Check if user exists with given username & password
    const userCheckQuery = `
      SELECT * 
      FROM aadhar_users
      WHERE username = $1 AND password = $2
      LIMIT 1;
    `;
    const userResult = await pool.query(userCheckQuery, [username, password]);

    if (userResult.rows.length === 0) {
      return res.status(401).json({
        message: 'Invalid username or password'
      });
    }

    const user = userResult.rows[0];

    // Step 2️⃣: If processorid is NULL → bind it (first login)
    if (!user.processorid || user.processorid === null) {
      const updateQuery = `
        UPDATE aadhar_users
        SET processorid = $1
        WHERE username = $2 AND password = $3
        RETURNING *;
      `;
      const updateResult = await pool.query(updateQuery, [processorid, username, password]);

      console.log(`✅ First login — ProcessorID bound for user: ${username}`);
      return res.json({
        message: 'First login successful — processor ID linked successfully',
        user: updateResult.rows[0]
      });
    }

    // Step 3️⃣: If already has processorid → verify match
    if (user.processorid !== processorid) {
      return res.status(401).json({
        message: 'Processor ID mismatch — access denied'
      });
    }

    // Step 4️⃣: Valid user and matching processor ID
    console.log(`✅ Login success for ${username} (ProcessorID: ${processorid})`);
    res.json({
      message: 'Login successful',
      user
    });

  } catch (err) {
    console.error('❌ Database error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// getmsg
app.get('/aadhar/getmsgaadhar', async (req, res) => {
  try {
    const query = `
      SELECT *
      FROM msg
      ORDER BY currentversion ASC
      LIMIT 1
    `;
    const { rows } = await pool.query(query);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'No message found' });
    }

    res.json(rows[0]);
  } catch (error) {
    console.error('Error fetching message:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ===================== Get Aadhar Data (by userid and username) =====================
app.post('/aadhar/getDataAadhar', async (req, res) => {
  try {
    const { userid, username } = req.body;

    // ✅ Validate required fields
    if (!userid || !username) {
      return res.status(400).json({ error: 'Missing required fields: userid or username' });
    }

    // ✅ Fetch data from aadhardata table
    const query = `
      SELECT 
        userid, username, aadharno, name, mobile, state, distributorid,
        createdat, status, remarks, updatedat
      FROM aadhardata
      WHERE userid = $1 AND username = $2
      ORDER BY createdat DESC;
    `;
    const values = [userid, username];
    const result = await pool.query(query, values);

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'No Aadhar data found for this user' });
    }

    // ✅ Return all records
    res.json({
      message: 'Aadhar data fetched successfully',
      count: result.rowCount,
      data: result.rows
    });

  } catch (err) {
    console.error('❌ Error fetching Aadhar data:', err);
    res.status(500).json({ error: 'Database error while fetching Aadhar data' });
  }
});


// ===================== Aadhar Recharge API =====================
app.post('/aadhar/recharge', async (req, res) => {
  const client = await pool.connect();
  try {
    const { amount, utr, id, username, processorid } = req.body;

    // ✅ 1. Validate input
    if (!amount || !utr || !id || !username || !processorid) {
      return res.status(400).json({ error: 'Missing required fields: amount, utr, id, username, processorid' });
    }

    await client.query('BEGIN'); // Start transaction

    // ✅ 2. Fetch user (to get distributorid)
    const userQuery = `
      SELECT * FROM aadhar_users
      WHERE id = $1 AND username = $2
      LIMIT 1
    `;
    const userResult = await client.query(userQuery, [id, username]);

    if (userResult.rowCount === 0) {
      return res.status(404).json({ error: 'User not found in aadhar_users' });
    }

    const { createdby } = userResult.rows[0];
    const distributorid = createdby;

    // ✅ 3. Insert record in amounttxnsdata immediately (remarks = pending)
    const insertTxn = `
      INSERT INTO amounttxnsdata (userid, username, distributorid, amount, utrno, remarks)
      VALUES ($1, $2, $3, $4, $5, 'pending')
    `;
    await client.query(insertTxn, [id, username, distributorid, amount, utr]);

    // ✅ 4. Check liveamount record
    const checkLive = `
      SELECT * FROM liveamount
      WHERE amount = $1 AND utrno = $2 AND isused = false
      LIMIT 1
    `;
    const liveResult = await client.query(checkLive, [amount, utr]);

    if (liveResult.rowCount === 0) {
      // ❌ Invalid or already used UTR
      await client.query(
        `UPDATE amounttxnsdata SET remarks = 'failed - invalid or used UTR' WHERE utrno = $1`,
        [utr]
      );
      await client.query('COMMIT');
      return res.status(400).json({ error: 'Invalid UTR or amount not found in liveamount / already used' });
    }

    // ✅ 5. Update aadhar_users balance
    const updateBalance = `
      UPDATE aadhar_users
      SET balance = balance + $1
      WHERE id = $2 AND username = $3 AND processorid = $4
      RETURNING balance
    `;
    const balanceResult = await client.query(updateBalance, [amount, id, username, processorid]);

    if (balanceResult.rowCount === 0) {
      await client.query(
        `UPDATE amounttxnsdata SET remarks = 'failed - user not found while updating balance' WHERE utrno = $1`,
        [utr]
      );
      await client.query('COMMIT');
      return res.status(404).json({ error: 'User not found while updating balance' });
    }

    const newBalance = balanceResult.rows[0].balance;

    // ✅ 6. Mark liveamount as used
    await client.query(
      `UPDATE liveamount SET isused = true, updatedat = now() WHERE utrno = $1 AND amount = $2`,
      [utr, amount]
    );

    // ✅ 7. Update remarks to success
    await client.query(
      `UPDATE amounttxnsdata SET remarks = 'success' WHERE utrno = $1`,
      [utr]
    );

    await client.query('COMMIT');

    res.json({
      message: 'Recharge successful',
      credited_amount: amount,
      new_balance: newBalance
    });

  } catch (err) {
    console.error('❌ Recharge Error:', err);

    // 🩶 Update remarks to error message
    if (req.body?.utr) {
      await pool.query(
        `UPDATE amounttxnsdata SET remarks = $1 WHERE utrno = $2`,
        ['failed - ' + err.message, req.body.utr]
      );
    }

    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Internal server error during recharge' });
  } finally {
    client.release();
  }
});


// ✅ POST API: /aadhar/getAvailableBalance
app.post('/aadhar/getAvailableBalance', async (req, res) => {
  try {
    const { id, username, processorid } = req.body;

    // ✅ Validate input
    if (!id || !username || !processorid) {
      return res.status(400).json({ error: 'Missing required fields: id, username, processorid' });
    }

    // ✅ Query the aadhar_users table
    const query = `
      SELECT balance
      FROM aadhar_users
      WHERE id = $1 AND username = $2 AND processorid = $3
      LIMIT 1
    `;
    const values = [id, username, processorid];

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json({ amount: result.rows[0].balance });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/aadhar/amounttxnsdata', async (req, res) => {
  try {
    const { id, username } = req.body;

    // ✅ Validate input
    if (!id || !username) {
      return res.status(400).json({ error: 'Missing required fields: id, username' });
    }

    // ✅ Fetch all transactions for the given user
    const query = `
      SELECT userid, username, distributorid, amount, utrno, createdat, remarks
      FROM amounttxnsdata
      WHERE userid = $1 AND username = $2
      ORDER BY createdat DESC
    `;
    const result = await pool.query(query, [id, username]);

    // ✅ If no records found
    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'No transaction records found for this user.' });
    }

    // ✅ Return all rows
    res.json({
      total_records: result.rowCount,
      transactions: result.rows
    });

  } catch (err) {
    console.error('❌ Error fetching amounttxnsdata:', err);
    res.status(500).json({ error: 'Internal server error while fetching transaction data' });
  }
});


app.post('/aadhar/getDataWithImages', async (req, res) => {
  try {
    const { sl_no } = req.body;

    // ✅ Validate input
    if (!sl_no) {
      return res.status(400).json({ error: 'Missing required fields:serial no' });
    }

    // ✅ Query only processing records
    const query = `
      SELECT *
      FROM aadhardata
      WHERE sl_no = $1 and status = 'processing'
    `;
    const result = await pool.query(query, [sl_no]);

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'No processing Aadhar data found for this user.' });
    }

    // ✅ Convert image files to base64 and attach them to response
    const dataWithImages = result.rows.map((row) => {
      const imageFields = ['pic1path', 'pic2path', 'pic3path', 'pic4path', 'pic5path'];
      const images = {};

      imageFields.forEach((field) => {
        if (row[field]) {
          const imagePath = path.join(__dirname, 'modified_images', row[field]);
          try {
            if (fs.existsSync(imagePath)) {
              const imageData = fs.readFileSync(imagePath, { encoding: 'base64' });
              images[field.replace('path', '')] = `data:image/jpeg;base64,${imageData}`;
            } else {
              images[field.replace('path', '')] = null;
            }
          } catch (err) {
            console.error(`❌ Error reading image ${field}:`, err);
            images[field.replace('path', '')] = null;
          }
        } else {
          images[field.replace('path', '')] = null;
        }
      });

      return {
        sl_no: row.sl_no,
        userid: row.userid,
        username: row.username,
        aadharno: row.aadharno,
        name: row.name,
        mobile: row.mobile,
        state: row.state,
        distributorid: row.distributorid,
        status: row.status,
        remarks: row.remarks,
        createdat: row.createdat,
        updatedat: row.updatedat,
        images // ✅ all images as base64 strings
      };
    });

    // ✅ Return result
    res.json({
      message: 'Processing Aadhar data with images fetched successfully',
      count: dataWithImages.length,
      data: dataWithImages
    });
  } catch (err) {
    console.error('❌ Error fetching Aadhar data with images:', err);
    res.status(500).json({ error: 'Internal server error while fetching data with images' });
  }
});


// get all data ////

app.post('/aadhar/getAllPendingData', async (req, res) => {
  try {
    const { distributorid } = req.body;

    // ✅ Validate input
    if (!distributorid) {
      return res.status(400).json({ error: 'Missing required field: distributorid' });
    }

    // ✅ Query all 'processing' records for given distributor
    const query = `
      SELECT *
      FROM aadhardata
      WHERE distributorid = $1 AND status = 'processing'
      ORDER BY createdat ASC;
    `;

    const result = await pool.query(query, [distributorid]);

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'No pending Aadhar data found for this distributor.' });
    }

    // ✅ Return the fetched data
    res.json({
      message: 'Pending Aadhar data fetched successfully.',
      count: result.rowCount,
      data: result.rows
    });

  } catch (err) {
    console.error('❌ Error fetching pending Aadhar data:', err);
    res.status(500).json({ error: 'Internal server error while fetching pending data.' });
  }
});



app.post('/aadhar/getDataWithImages', async (req, res) => {
  try {
    const { sl_no } = req.body;

    // ✅ Validate input
    if (!sl_no) {
      return res.status(400).json({ error: 'Missing required fields: id, username' });
    }

    // ✅ Query only processing records
    const query = `
      SELECT *
      FROM aadhardata
      WHERE sl_no = $1 and status = 'processing' 
    `;
    const result = await pool.query(query, [sl_no]);

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'No processing Aadhar data found for this user.' });
    }

    // ✅ Convert image files to base64 and attach them to response
    const dataWithImages = result.rows.map((row) => {
      const imageFields = ['pic1path', 'pic2path', 'pic3path', 'pic4path', 'pic5path'];
      const images = {};

      imageFields.forEach((field) => {
        if (row[field]) {
          const imagePath = path.join(__dirname, 'modified_images', row[field]);
          try {
            if (fs.existsSync(imagePath)) {
              const imageData = fs.readFileSync(imagePath, { encoding: 'base64' });
              images[field.replace('path', '')] = `data:image/jpeg;base64,${imageData}`;
            } else {
              images[field.replace('path', '')] = null;
            }
          } catch (err) {
            console.error(`❌ Error reading image ${field}:`, err);
            images[field.replace('path', '')] = null;
          }
        } else {
          images[field.replace('path', '')] = null;
        }
      });

      return {
        userid: row.userid,
        username: row.username,
        aadharno: row.aadharno,
        name: row.name,
        mobile: row.mobile,
        state: row.state,
        distributorid: row.distributorid,
        status: row.status,
        remarks: row.remarks,
        createdat: row.createdat,
        updatedat: row.updatedat,
        images // ✅ all images as base64 strings
      };
    });

    // ✅ Return result
    res.json({
      message: 'Processing Aadhar data with images fetched successfully',
      count: dataWithImages.length,
      data: dataWithImages
    });
  } catch (err) {
    console.error('❌ Error fetching Aadhar data with images:', err);
    res.status(500).json({ error: 'Internal server error while fetching data with images' });
  }
});

app.get('/aadhar/allImages', async (req, res) => {
  try {
    const imagesDir = path.join(__dirname, 'images');

    // ✅ Check if the folder exists
    if (!fs.existsSync(imagesDir)) {
      return res.status(404).json({ error: 'Images folder not found.' });
    }

    // ✅ Create a zip filename (optional: include timestamp)
    const zipFileName = `aadhar_images_${Date.now()}.zip`;
    const zipFilePath = path.join(__dirname, zipFileName);

    // ✅ Create zip archive
    const output = fs.createWriteStream(zipFilePath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
      console.log(`✅ Created ZIP: ${zipFileName} (${archive.pointer()} total bytes)`);

      // ✅ Send the zip file for download
      res.download(zipFilePath, zipFileName, (err) => {
        // Delete the temporary zip file after sending
        fs.unlink(zipFilePath, () => {});
        if (err) {
          console.error('❌ Error sending zip:', err);
        }
      });
    });

    archive.on('error', (err) => {
      throw err;
    });

    // ✅ Pipe archive data to the file
    archive.pipe(output);

    // ✅ Append all files in the images folder
    archive.directory(imagesDir, false);

    // ✅ Finalize the archive
    await archive.finalize();
  } catch (err) {
    console.error('❌ Error creating ZIP:', err);
    res.status(500).json({ error: 'Internal server error while creating zip.' });
  }
});

app.get('/aadhar/allImagesFiltered', async (req, res) => {
  try {
    // ✅ Query to get all image paths from DB for 'processing' status
    const query = `
      SELECT pic1path, pic2path, pic3path, pic4path, pic5path
      FROM aadhardata
      WHERE status = 'processing'
    `;

    const result = await pool.query(query);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No records with "processing" status found.' });
    }

    const imagePaths = [];
    result.rows.forEach(row => {
      for (let i = 1; i <= 5; i++) {
        if (row[`pic${i}path`]) {
          // Assuming pic paths are relative to a known directory, e.g., 'images'
          imagePaths.push(path.join(__dirname, 'images', row[`pic${i}path`]));
        }
      }
    });

    if (imagePaths.length === 0) {
      return res.status(404).json({ error: 'No images found for "processing" records.' });
    }

    // Create a temporary folder
    const tempDir = fs.mkdtempSync(path.join(__dirname, 'temp-'));

    // Copy images to the temporary folder
    imagePaths.forEach(imagePath => {
      if (fs.existsSync(imagePath)) {
        const fileName = path.basename(imagePath);
        fs.copyFileSync(imagePath, path.join(tempDir, fileName));
      }
    });

    // ✅ Create a zip filename
    const zipFileName = `aadhar_images_processing_${Date.now()}.zip`;
    const zipFilePath = path.join(__dirname, zipFileName);

    // ✅ Create zip archive
    const output = fs.createWriteStream(zipFilePath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
      console.log(`✅ Created ZIP: ${zipFileName} (${archive.pointer()} total bytes)`);

      // ✅ Send the zip file for download
      res.download(zipFilePath, zipFileName, (err) => {
        // Delete the temporary zip file and folder after sending
        fs.unlink(zipFilePath, () => {});
        fs.rm(tempDir, { recursive: true, force: true }, () => {});
        if (err) {
          console.error('❌ Error sending zip:', err);
        }
      });
    });

    archive.on('error', (err) => {
      throw err;
    });

    // ✅ Pipe archive data to the file
    archive.pipe(output);

    // ✅ Append each image to the archive
    imagePaths.forEach(imagePath => {
      if (fs.existsSync(imagePath)) {
        archive.file(imagePath, { name: path.basename(imagePath) });
      }
    });

    // ✅ Finalize the archive
    await archive.finalize();
  } catch (err) {
    console.error('❌ Error creating filtered ZIP:', err);
    res.status(500).json({ error: 'Internal server error while creating filtered zip.' });
  }
});


app.get('/aadhar/allImages/:id', async (req, res) => {
  try {
    const id = req.params.id;

    if (!id) {
      return res.status(400).json({ error: 'ID param is required.' });
    }

    // ✅ Query to get all image paths from DB for the given ID
    const query = `
      SELECT pic1path, pic2path, pic3path, pic4path, pic5path
      FROM aadhardata
      WHERE sl_no = $1
      LIMIT 1
    `;

    const result = await pool.query(query, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Record not found for this ID.' });
    }

    const row = result.rows[0];
    const imagePaths = [];
    for (let i = 1; i <= 5; i++) {
      if (row[`pic${i}path`]) {
        imagePaths.push(path.join(__dirname, 'images', row[`pic${i}path`]));
      }
    }

    if (imagePaths.length === 0) {
      return res.status(404).json({ error: 'No images found for this record.' });
    }

    // Create a temporary folder
    const tempDir = fs.mkdtempSync(path.join(__dirname, 'temp-'));

    // Copy images to the temporary folder
    imagePaths.forEach(imagePath => {
      if (fs.existsSync(imagePath)) {
        const fileName = path.basename(imagePath);
        fs.copyFileSync(imagePath, path.join(tempDir, fileName));
      }
    });

    // ✅ Create a zip filename
    const zipFileName = `aadhar_images_${id}_${Date.now()}.zip`;
    const zipFilePath = path.join(__dirname, zipFileName);

    // ✅ Create zip archive
    const output = fs.createWriteStream(zipFilePath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
      console.log(`✅ Created ZIP: ${zipFileName} (${archive.pointer()} total bytes)`);

      // ✅ Send the zip file for download
      res.download(zipFilePath, zipFileName, (err) => {
        // Delete the temporary zip file and folder after sending
        fs.unlink(zipFilePath, () => {});
        fs.rm(tempDir, { recursive: true, force: true }, () => {});
        if (err) {
          console.error('❌ Error sending zip:', err);
        }
      });
    });

    archive.on('error', (err) => {
      throw err;
    });

    // ✅ Pipe archive data to the file
    archive.pipe(output);

    // ✅ Append all files in the temp folder
    archive.directory(tempDir, false);

    // ✅ Finalize the archive
    await archive.finalize();
  } catch (err) {
    console.error('❌ Error creating ZIP for ID:', err);
    res.status(500).json({ error: 'Internal server error while creating zip.' });
  }
});



// ✅ Configure multer for file uploads
const uploadx = multer({ dest: 'uploads/' }); // Temporary upload folder

app.post('/aadhar/uploadZip', uploadx.single('zipfile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No zip file uploaded.' });
    }

    const zipPath = req.file.path; // Path of uploaded zip
    const modifiedImagesDir = path.join(__dirname, 'modified_images');

    // ✅ Ensure target folder exists
    if (!fs.existsSync(modifiedImagesDir)) {
      fs.mkdirSync(modifiedImagesDir, { recursive: true });
    }

    // ✅ Extract ZIP
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(modifiedImagesDir, true); // overwrite = true

    // ✅ Delete the uploaded ZIP after extraction
    fs.unlinkSync(zipPath);

    // ✅ Get list of extracted files
    const extractedFiles = fs.readdirSync(modifiedImagesDir);

    res.json({
      message: 'ZIP extracted successfully!',
      extractedCount: extractedFiles.length,
      files: extractedFiles
    });
  } catch (err) {
    console.error('❌ Error extracting ZIP:', err);
    res.status(500).json({ error: 'Internal server error while extracting ZIP.' });
  }
});

//aadhar reject // 


app.post('/aadhar/reject', async (req, res) => {
  const { sl_no,msg } = req.body;

  if (!sl_no) {
    return res.status(400).json({ error: 'sl_no is required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1️⃣ Get the record from aadhardata
    const recordRes = await client.query(
      `SELECT username FROM aadhardata WHERE sl_no = $1`,
      [sl_no]
    );

    if (recordRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Record not found' });
    }

    const username = recordRes.rows[0].username;

    // 2️⃣ Get aadharamount from msg table (latest row)
    const msgRes = await client.query(
      `SELECT aadharamount FROM msg ORDER BY currentversion DESC LIMIT 1`
    );

    if (msgRes.rowCount === 0 || msgRes.rows[0].aadharamount == null) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'No aadharamount found in msg table' });
    }

    const aadharAmount = Number(msgRes.rows[0].aadharamount);

    // 3️⃣ Update aadhardata -> status = 'Reject'
    await client.query(
      `UPDATE aadhardata 
       SET status = 'Reject', remarks = $1 
       WHERE sl_no = $2`,
      [msg, sl_no]
    );

    // 4️⃣ Refund balance to user
    await client.query(
      `UPDATE aadhar_users SET balance = balance + $1 WHERE username = $2`,
      [aadharAmount, username]
    );

    await client.query('COMMIT');

    res.json({
      message: 'Status updated to Reject and balance refunded',
      sl_no,
      username,
      refunded_amount: aadharAmount,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error in /aadhar/reject:', error);
    res.status(500).json({ error: 'Database error' });
  } finally {
    client.release();
  }
});


// 🔹 API: Mark Aadhar as Success
app.post('/aadhar/markSuccess', async (req, res) => {
  const { sl_no } = req.body;

  if (!sl_no) {
    return res.status(400).json({ error: 'sl_no is required' });
  }

  try {
    const query = `UPDATE aadhardata SET status = 'Success' WHERE sl_no = $1`;
    const result = await pool.query(query, [sl_no]);

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Record not found' });
    }

    res.json({ message: 'Status updated to Success', sl_no });
  } catch (error) {
    console.error('Error updating record:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

///////////////////////////////////////////
//=======VLEHUB RECHARGE=================//
///////////////////////////////////////////

// vlehub reacherge api =====================
app.post('/vlehub/recharge', async (req, res) => {
  const clientSupabase = await pool.connect();      // Supabase
  const clientVlehub = await vlehubPool.connect();  // kanak_kanak DB

  try {
    const { username, processorid, utr, amount } = req.body;

    // ✅ Validate input
    if (!username || !processorid || !utr || !amount) {
      return res.status(400).json({ error: 'Missing required fields: username, processorid, utr, amount' });
    }

    // ✅ 1️⃣ Check if user exists in kanak_kanak.users
    const userQuery = `
      SELECT * FROM users 
      WHERE username = $1 AND processor_id = $2 AND activate = true
      LIMIT 1;
    `;
    const userResult = await clientVlehub.query(userQuery, [username, processorid]);

    if (userResult.rowCount === 0) {
      return res.status(404).json({ error: 'User not found in kanak_kanak database' });
    }

    const user = userResult.rows[0];

    // ✅ Begin transaction in both DBs
    await clientSupabase.query('BEGIN');
    await clientVlehub.query('BEGIN');

    // ✅ 2️⃣ Check if UTR and amount exist in Supabase liveamount
    const liveQuery = `
      SELECT * FROM liveamount 
      WHERE amount = $1 AND utrno = $2 AND isused = false
      LIMIT 1;
    `;
    const liveResult = await clientSupabase.query(liveQuery, [amount, utr]);

    if (liveResult.rowCount === 0) {
      await clientSupabase.query('ROLLBACK');
      await clientVlehub.query('ROLLBACK');
      return res.status(400).json({ error: 'Invalid or already used UTR' });
    }

    // ✅ 3️⃣ Mark liveamount as used
    await clientSupabase.query(
      `UPDATE liveamount SET isused = true, updatedat = now() WHERE utrno = $1`,
      [utr]
    );

    // ✅ 4️⃣ Update user’s total_amount in kanak_kanak.users
    const newTotalAmount = (user.total_amount || 0) + parseInt(amount);
    const updateUserQuery = `
      UPDATE users 
      SET total_amount = $1, updated_at = now()
      WHERE username = $2 AND processor_id = $3
      RETURNING total_amount;
    `;
    const updateResult = await clientVlehub.query(updateUserQuery, [newTotalAmount, username, processorid]);

    // ✅ Commit both transactions
    await clientSupabase.query('COMMIT');
    await clientVlehub.query('COMMIT');

    console.log(`✅ Recharge successful for ${username}, Amount: ₹${amount}`);

    res.json({
      message: 'Recharge successful',
      username,
      utr,
      credited_amount: amount,
      new_total_amount: updateResult.rows[0].total_amount
    });

  } catch (err) {
    console.error('❌ VLEHUB Recharge Error:', err);

    try {
      await clientSupabase.query('ROLLBACK');
      await clientVlehub.query('ROLLBACK');
    } catch (_) {}

    res.status(500).json({ error: 'Internal server error during VLEHUB recharge' });
  } finally {
    clientSupabase.release();
    clientVlehub.release();
  }
});
app.get('/bios/upi/qrcode', (req, res) => {
  try {
    // Path to qr.png in root folder
    const imagePath = path.join(__dirname, 'qr.png');

    // Check file exists
    if (!fs.existsSync(imagePath)) {
      return res.status(404).json({ error: 'qr.png not found in root directory' });
    }

    // Read file → Base64
    const imageData = fs.readFileSync(imagePath, { encoding: 'base64' });

    // Prepare final Base64 data URL
    const base64Image = `data:image/png;base64,${imageData}`;

    // Send response
    res.json({
      message: "QR loaded successfully",
      base64_qr: base64Image
    });

  } catch (err) {
    console.error("❌ Error reading QR:", err);
    res.status(500).json({ error: "Internal server error while reading QR image" });
  }
});

app.post('/bios/bios_device_info', async (req, res) => {
  const client = await pool.connect();

  try {
    const {
      whatsapp,
      smbiosbiosversion,
      manufacturer,
      name,
      serialnumber,
      version,
      hddid,
      username,
      o_smbiosbiosversion,
      o_manufacturer,
      o_name,
      o_serialnumber,
      o_version,
      utr
    } = req.body;

    if (
      !whatsapp || !smbiosbiosversion || !manufacturer || !name || !serialnumber ||
      !version || !hddid || !username || !o_smbiosbiosversion || !o_manufacturer ||
      !o_name || !o_serialnumber || !o_version || !utr
    ) {
      return res.status(400).json({ error: "Missing required fields", message: "Missing required fields" });
    }

    // 🔥 IMPORTANT: use client.query(), not pool.query()
    await client.query("BEGIN");

    // Check UTR
    const checkUTR = `
      SELECT amount, utrno, isused 
      FROM liveamount
      WHERE utrno = $1 AND isused = false AND amount = '100'
      LIMIT 1;
    `;
    const utrResult = await client.query(checkUTR, [utr]);

    if (utrResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Invalid or used UTR", message: "Invalid or used UTR" });
    }

    const txnAmount = utrResult.rows[0].amount;

    // Insert BIOS info
    const insertQuery = `
      INSERT INTO bios_device_info (
        whatsapp, smbiosbiosversion, manufacturer, "name", serialnumber, "version",
        hddid, username, o_smbiosbiosversion, o_manufacturer, o_name,
        o_serialnumber, o_version, utr
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      RETURNING sl_no, createdat;
    `;
    const insertRes = await client.query(insertQuery, [
      whatsapp, smbiosbiosversion, manufacturer, name,
      serialnumber, version, hddid, username,
      o_smbiosbiosversion, o_manufacturer, o_name,
      o_serialnumber, o_version, utr
    ]);

    // Mark UTR as used
    await client.query(
      `UPDATE liveamount SET isused = true, updatedat = now() WHERE utrno = $1`,
      [utr]
    );

    await client.query("COMMIT");

    const finalResp =
      `#pragma namespace("\\\\\\\\.\\\\root\\\\CIMV2") ` +
      `class Win32_BIOS { [key] string SMBIOSBIOSVersion; string Manufacturer; string Name; string SerialNumber; string Version; }; ` +
      `instance of Win32_BIOS { ` +
      `SMBIOSBIOSVersion = "${smbiosbiosversion}"; ` +
      `Manufacturer = "${manufacturer}"; ` +
      `Name = "${name}"; ` +
      `SerialNumber = "${serialnumber}"; ` +
      `Version = "${version}"; };`;

    res.json({
      message: "BIOS Updated Successfully !!!",
      sl_no: insertRes.rows[0].sl_no,
      utr_amount: txnAmount,
      finalResp
    });

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ BIOS Error:", err);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release(); // ✅ Correct now
  }
});



// app.post('/vlehub/createUser', async (req, res) => {
//   const clientVlehub = await vlehubPool.connect();

//   try {
//     const { name, email, mobile, password, processor_id } = req.body;

//     // ✅ Validate input
//     if (!name || !email || !mobile || !password || !processor_id) {
//       return res.status(400).json({
//         error: 'Missing required fields: name, email, mobile, password, processor_id'
//       });
//     }

//     const username = mobile; // username same as mobile

//     await clientVlehub.query('BEGIN');

//     // ✅ 1️⃣ Check if any of processor_id, username, mobile, or email already exist
//     const checkQuery = `
//       SELECT user_id FROM users
//       WHERE processor_id = $1 OR username = $2 OR mobile = $3 OR email = $4
//       LIMIT 1;
//     `;
//     const checkResult = await clientVlehub.query(checkQuery, [
//       processor_id,
//       username,
//       mobile,
//       email
//     ]);

//     if (checkResult.rowCount > 0) {
//       await clientVlehub.query('ROLLBACK');
//       return res.status(400).json({
//         error: 'User already exists (duplicate processor_id, username, mobile, or email)'
//       });
//     }

//     // ✅ 2️⃣ Insert new user
//     const insertQuery = `
//       INSERT INTO users (
//         username, name, password, email, mobile, processor_id,
//         total_amount, used_amount, activate, distroy, created_at, updated_at
//       )
//       VALUES ($1, $2, $3, $4, $5, $6, 0, 0, true, false, now(), now())
//       RETURNING user_id, username, name, email, mobile, processor_id, created_at;
//     `;

//     const insertResult = await clientVlehub.query(insertQuery, [
//       username,
//       name,
//       password,
//       email,
//       mobile,
//       processor_id
//     ]);

//     await clientVlehub.query('COMMIT');

//     const newUser = insertResult.rows[0];
//     console.log(`✅ New VLEHUB User Created: ${newUser.username}`);

//     res.json({
//       message: 'User created successfully',
//       user: newUser
//     });

//   } catch (err) {
//     console.error('❌ Error creating VLEHUB user:', err);
//     try {
//       await clientVlehub.query('ROLLBACK');
//     } catch (_) {}
//     res.status(500).json({ error: 'Internal server error while creating user' });
//   } finally {
//     clientVlehub.release();
//   }
// });

app.post('/vlehub/createUser', async (req, res) => {
  const client = await vlehubPool.connect();

  try {
    const { name, email, mobile, password, processor_id } = req.body;

    if (!name || !email || !mobile || !password || !processor_id) {
      return res.status(400).json({
        error: 'Missing required fields: name, email, mobile, password, processor_id'
      });
    }

    const username = mobile;

    await client.query('BEGIN');

    const dupCheck = `
      SELECT user_id FROM users
      WHERE processor_id = $1 OR username = $2 OR mobile = $3 OR email = $4
      LIMIT 1;
    `;
    const dupRes = await client.query(dupCheck, [
      processor_id,
      username,
      mobile,
      email
    ]);

    if (dupRes.rowCount > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'User already exists'
      });
    }

    const insertQuery = `
      INSERT INTO users (
        username, name, password, email, mobile, processor_id,
        total_amount, used_amount, activate, distroy,
        created_at, updated_at,distributor_name,distributor_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, 0, 0, true, false, now(), now(), 'ankit', 1)
      RETURNING user_id, username, name, email, mobile, processor_id, created_at;
    `;

    const insertRes = await client.query(insertQuery, [
      username,
      name,
      password,   // consider hashing
      email,
      mobile,
      processor_id
    ]);

    await client.query('COMMIT');

    res.json({
      message: 'User created successfully'+` ${insertRes.rows[0]}`,
      user: insertRes.rows[0]
    });

  } catch (err) {
    console.error('❌ Error creating VLEHUB user:', err);
    try { await client.query('ROLLBACK'); } catch(_) {}
    res.status(500).json({ error: 'Internal server error while creating user' });
  } finally {
    client.release();
  }
});

// ===================== Health Check =====================
app.get('/', (req, res) => res.send('OTP backend running 🚀'));

// ===================== Start Server =====================
app.listen(4000, () => console.log('🚀 Server running on port 4000'));
