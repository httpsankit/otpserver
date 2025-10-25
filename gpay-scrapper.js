require('dotenv').config();
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const TARGET_URL = 'https://pay.google.com/gp/w/u/0/home/activity';
const USER_DATA_DIR = path.resolve('./chrome_user_data');  // persistent profile
const INTERVAL_MS = 5000; // 5 seconds (same as C# version)
const API_ENDPOINT = 'https://otp.instadl.in/aadhar/liveamount';

// Track processed UTRs to avoid duplicates (same as C# HashSet)
const processedUTRs = new Set();

// === Find Chrome path (Windows/Linux/Mac autodetect) ===
function getChromePath() {
  const platform = process.platform;
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  if (platform === 'win32') {
    return (
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' ||
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
    );
  } else if (platform === 'darwin') {
    return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  } else {
    return '/usr/bin/google-chrome';
  }
}

async function scrapeOnce(page) {
  try {
    console.log('Scraping transactions...');
    await page.waitForSelector('.dhoGqc', { timeout: 10000 });

    // Enhanced scraping to match C# version - extract amount, date, time, UTR
    const transactions = await page.evaluate(() => {
      const results = [];
      document.querySelectorAll('.dhoGqc').forEach(txn => {
        const amount = txn.querySelector('.Du06we')?.innerText || '';
        const date = txn.querySelector('.e8L7Bd')?.innerText || '';
        const time = txn.querySelector('.cSKHad')?.innerText || '';
        const utr = txn.querySelector('.TLJ5vc.gX9y7c')?.innerText || '';
        
        // Only process today's transactions (same as C# version)
        if (date.includes('Today')) {
          results.push({
            amount: amount,
            utr: utr,
            txndate: date + ' ' + time
          });
        }
      });
      return results.slice(0, 5); // Return only last 5 (same as C# version)
    });

    console.log(`Found ${transactions.length} transactions:`, transactions);
    return transactions;
  } catch (e) {
    console.warn('Scraping failed:', e.message);
    return [];
  }
}

// API posting function (equivalent to C# PostTxn method)
async function postTxn(txn) {
  try {
    const payload = {
      amount: txn.amount.replace('₹', '').trim(),
      utrno: txn.utr,
      txndate: txn.txndate
    };

    console.log('Posting transaction:', payload);
    
    const response = await axios.post(API_ENDPOINT, payload, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log(`Posted txn ${txn.utr} → ${response.status} | ${JSON.stringify(response.data)}`);
    return response.data;
  } catch (error) {
    console.error('POST failed:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
    throw error;
  }
}

// Process transactions with UTR tracking (equivalent to C# Timer_Tick logic)
async function processTransactions(page) {
  try {
    const txns = await scrapeOnce(page);
    
    if (txns && txns.length > 0) {
      for (const txn of txns) {
        // Check if UTR is not already processed and not empty (same as C# logic)
        if (!processedUTRs.has(txn.utr) && txn.utr && txn.utr.trim() !== '') {
          processedUTRs.add(txn.utr);
          await postTxn(txn);
        }
      }
    }
  } catch (error) {
    console.error('Error processing transactions:', error.message);
  }
}

(async () => {
  console.log('Starting Google Pay scraper using real Chrome...');
  console.log('API Endpoint:', API_ENDPOINT);
  console.log('Processing interval:', INTERVAL_MS + 'ms');

  const chromePath = getChromePath();
  console.log('Using Chrome from:', chromePath);

  const browser = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    executablePath: chromePath, // 👈 use real Chrome
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--start-maximized'
    ],
  });

  const page = await browser.newPage();
  console.log('Navigating to Google Pay...');
  await page.goto(TARGET_URL, { waitUntil: 'networkidle' });

  // Wait for login or transaction list
  try {
    console.log('Waiting for transactions or login...');
    await page.waitForSelector('.dhoGqc, [aria-label*="Sign in"], input[type="email"]', { timeout: 30000 });
  } catch (e) {
    console.warn('Login or transaction elements not detected yet. Please check manually.');
  }

  console.log('Please sign in manually if not logged in. The script will remember your session.');
  
  // Manual trigger function (equivalent to C# button1_Click)
  const manualTrigger = async () => {
    console.log('Manual trigger activated...');
    await processTransactions(page);
  };

  // Add keyboard shortcut for manual trigger (Ctrl+M)
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', async (key) => {
    if (key.toString() === '\u000D') { // Enter key
      await manualTrigger();
    }
  });

  console.log('Press Enter to manually trigger transaction processing...');

  // Scrape loop (equivalent to C# Timer_Tick)
  setInterval(async () => {
    try {
      if (!page.url().includes('pay.google.com')) {
        console.log('Redirected away, navigating back...');
        await page.goto(TARGET_URL, { waitUntil: 'networkidle' });
      }
      await processTransactions(page);
    } catch (e) {
      console.warn('Loop error:', e.message);
    }
  }, INTERVAL_MS);

  // Handle exit cleanly
  process.on('SIGINT', async () => {
    console.log('\nReceived SIGINT. Closing...');
    await browser.close();
    process.exit(0);
  });
})();
