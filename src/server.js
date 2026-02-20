require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');

// Stripe setup (handle missing keys gracefully)
const stripe = process.env.STRIPE_SECRET_KEY ? require('stripe')(process.env.STRIPE_SECRET_KEY) : null;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

console.log('🚀 Starting MatchReel server...');
console.log('📦 Stripe configured:', !!stripe);
console.log('🔑 Webhook secret:', !!STRIPE_WEBHOOK_SECRET);

const app = express();
const PORT = process.env.PORT || 3000;

// Data storage - use persistent volume on Railway, local paths otherwise
// Railway volume should be mounted at /data
const PERSIST_ROOT = process.env.RAILWAY_ENVIRONMENT ? '/data' : path.join(__dirname, '..');
const DATA_FILE = path.join(PERSIST_ROOT, 'matches.json');
const VOUCHERS_FILE = path.join(PERSIST_ROOT, 'vouchers.json');
const UPLOADS_DIR = path.join(PERSIST_ROOT, 'uploads');
const OUTPUT_DIR = path.join(PERSIST_ROOT, 'output');

console.log('💾 Storage root:', PERSIST_ROOT);
console.log('📁 Data file:', DATA_FILE);

// Ensure directories exist
[PERSIST_ROOT, UPLOADS_DIR, OUTPUT_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Initialize data file
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify({ matches: {} }));
}

// Initialize vouchers file with some default codes
if (!fs.existsSync(VOUCHERS_FILE)) {
  fs.writeFileSync(VOUCHERS_FILE, JSON.stringify({
    vouchers: {
      'FIRSTFREE': { discount: 100, maxUses: 100, uses: 0, description: 'First match free' },
      'TRYME': { discount: 100, maxUses: 50, uses: 0, description: 'Trial voucher' },
      'HALF50': { discount: 50, maxUses: 100, uses: 0, description: '50% off' },
      'MARCH26': { discount: 100, maxUses: 500, uses: 0, description: 'Free until April 2026' }
    }
  }, null, 2));
}

// Ensure MARCH26 voucher exists (migration)
try {
  const voucherData = JSON.parse(fs.readFileSync(VOUCHERS_FILE, 'utf8'));
  if (!voucherData.vouchers['MARCH26']) {
    voucherData.vouchers['MARCH26'] = { discount: 100, maxUses: 500, uses: 0, description: 'Free until April 2026' };
    fs.writeFileSync(VOUCHERS_FILE, JSON.stringify(voucherData, null, 2));
    console.log('✅ Added MARCH26 voucher');
  }
} catch (e) { console.log('Voucher migration skipped:', e.message); }

// Voucher helpers
function loadVouchers() {
  return JSON.parse(fs.readFileSync(VOUCHERS_FILE, 'utf8'));
}

function saveVouchers(data) {
  fs.writeFileSync(VOUCHERS_FILE, JSON.stringify(data, null, 2));
}

// Helpers
function loadData() {
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// Configure multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const matchDir = path.join(UPLOADS_DIR, req.params.matchId);
    if (!fs.existsSync(matchDir)) fs.mkdirSync(matchDir, { recursive: true });
    cb(null, matchDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${uuidv4().slice(0, 8)}${ext}`);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowed = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  },
  limits: { fileSize: 500 * 1024 * 1024 }
});

// Stripe webhook (needs raw body - MUST be before express.json())
app.post('/api/stripe-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  
  // Handle the checkout.session.completed event
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const matchId = session.metadata?.matchId;
    
    if (matchId) {
      console.log(`💳 Payment received for match ${matchId}`);
      
      try {
        const data = loadData();
        const match = data.matches[matchId];
        
        if (match) {
          match.unlocked = true;
          match.unlockedAt = new Date().toISOString();
          match.unlockedBy = session.customer_details?.name || 'A supporter';
          match.stripePaymentId = session.payment_intent;
          match.stripeSessionId = session.id;
          saveData(data);
          
          console.log(`✅ Match ${matchId} unlocked via Stripe`);
        }
      } catch (err) {
        console.error('Failed to unlock match after payment:', err);
      }
    }
  }
  
  res.json({ received: true });
});

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));
app.use('/uploads', express.static(UPLOADS_DIR));  // Serve uploaded files

// ============ ROUTES ============

// Landing page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Create match page
app.get('/create', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/create.html'));
});

// Upload page (for parents)
app.get('/match/:matchId', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/upload.html'));
});

// Admin page
app.get('/admin/:matchId', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin.html'));
});

// Client-side generate page (no server processing!)
app.get('/generate/:matchId', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/generate.html'));
});

// Reel share page (for WhatsApp group)
app.get('/reel/:matchId', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/reel.html'));
});

// Clips gallery (public - linked from WhatsApp)
app.get('/clips/:matchId', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/clips.html'));
});

// WhatsApp poster generator
app.get('/poster/:matchId', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/poster.html'));
});

// ============ API ============

// Logo upload config
const logoUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const logoDir = path.join(UPLOADS_DIR, 'logos');
      if (!fs.existsSync(logoDir)) fs.mkdirSync(logoDir, { recursive: true });
      cb(null, logoDir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      const prefix = file.fieldname === 'opponentLogo' ? 'opp-' : '';
      cb(null, `${prefix}${Date.now()}-${uuidv4().slice(0, 8)}${ext}`);
    }
  }),
  fileFilter: (req, file, cb) => {
    cb(null, file.mimetype.startsWith('image/'));
  },
  limits: { fileSize: 10 * 1024 * 1024 }
});

// Create new match
app.post('/api/matches', logoUpload.fields([{ name: 'logo', maxCount: 1 }, { name: 'opponentLogo', maxCount: 1 }]), (req, res) => {
  try {
    const { teamName, opponent, matchDate, matchTime, competition, manager, venue, adminEmail } = req.body;
    const squad = JSON.parse(req.body.squad || '[]');
    const colors = JSON.parse(req.body.colors || '{"primary":"#0099cc","secondary":"#00ccff"}');
    
    if (!teamName || !opponent || !matchDate || !squad?.length) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }
    
    const matchId = uuidv4().slice(0, 8);
    const adminToken = uuidv4().slice(0, 12);
    
    const match = {
      id: matchId,
      adminToken,
      teamName,
      opponent,
      matchDate,
      matchTime,
      competition,
      manager,
      venue,
      adminEmail,
      squad,
      colors,
      clips: [],
      status: 'collecting', // collecting | processing | complete
      score: null,
      playerOfMatch: null,
      teamLogo: req.files?.logo?.[0]?.filename || null,
      opponentLogo: req.files?.opponentLogo?.[0]?.filename || null,
      createdAt: new Date().toISOString()
    };
    
    const data = loadData();
    data.matches[matchId] = match;
    saveData(data);
    
    // Create upload directory
    const matchDir = path.join(UPLOADS_DIR, matchId);
    if (!fs.existsSync(matchDir)) fs.mkdirSync(matchDir, { recursive: true });
    
    res.json({
      success: true,
      matchId,
      adminToken,
      shareUrl: `/match/${matchId}`,
      adminUrl: `/admin/${matchId}?token=${adminToken}`
    });
    
  } catch (err) {
    console.error('Create match error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get match details
app.get('/api/matches/:matchId', (req, res) => {
  try {
    const data = loadData();
    const match = data.matches[req.params.matchId];
    
    if (!match) {
      return res.status(404).json({ success: false, error: 'Match not found' });
    }
    
    // Don't expose admin token or raw nominations to public
    const { adminToken, potmNominations, ...publicMatch } = match;
    
    res.json({ success: true, match: publicMatch });
    
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get match with admin details (including POTM nominations)
app.get('/api/matches/:matchId/admin', (req, res) => {
  try {
    const { token } = req.query;
    const data = loadData();
    const match = data.matches[req.params.matchId];
    
    if (!match) {
      return res.status(404).json({ success: false, error: 'Match not found' });
    }
    
    if (match.adminToken !== token) {
      return res.status(403).json({ success: false, error: 'Invalid admin token' });
    }
    
    // Count POTM nominations
    const nominations = match.potmNominations || [];
    const voteCounts = {};
    nominations.forEach(n => {
      const name = n.name.toLowerCase().trim();
      voteCounts[name] = (voteCounts[name] || 0) + 1;
    });
    
    // Sort by votes
    const sortedVotes = Object.entries(voteCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));
    
    res.json({ 
      success: true, 
      match,
      potmVotes: sortedVotes,
      totalVotes: nominations.length
    });
    
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Upload clip to match
app.post('/api/matches/:matchId/clips', upload.single('video'), (req, res) => {
  try {
    const { matchId } = req.params;
    const { type, scorer, minute } = req.body;
    
    const data = loadData();
    const match = data.matches[matchId];
    
    if (!match) {
      return res.status(404).json({ success: false, error: 'Match not found' });
    }
    
    if (match.status !== 'collecting') {
      return res.status(400).json({ success: false, error: 'Match is no longer accepting clips' });
    }
    
    const clip = {
      id: uuidv4().slice(0, 8),
      filename: req.file.filename,
      originalName: req.file.originalname,
      type, // goal | chance | save
      scorer: type === 'goal' ? scorer : null,
      minute: type === 'goal' && minute ? parseInt(minute) : null,
      uploadedAt: new Date().toISOString()
    };
    
    match.clips.push(clip);
    saveData(data);
    
    res.json({ success: true, clip });
    
  } catch (err) {
    console.error('Upload clip error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Add player to squad
app.post('/api/matches/:matchId/squad', (req, res) => {
  try {
    const { matchId } = req.params;
    const { player } = req.body;
    
    if (!player?.trim()) {
      return res.status(400).json({ success: false, error: 'Player name required' });
    }
    
    const data = loadData();
    const match = data.matches[matchId];
    
    if (!match) {
      return res.status(404).json({ success: false, error: 'Match not found' });
    }
    
    const playerName = player.trim();
    if (!match.squad.includes(playerName)) {
      match.squad.push(playerName);
      saveData(data);
    }
    
    res.json({ success: true, squad: match.squad });
    
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Admin: Update match details (score, POTM, Team of Day, etc)
app.put('/api/matches/:matchId', (req, res) => {
  try {
    const { matchId } = req.params;
    const { adminToken, score, playerOfMatch, teamOfDay, status, musicUrl, musicTitle, commentarySounds } = req.body;
    
    const data = loadData();
    const match = data.matches[matchId];
    
    if (!match) {
      return res.status(404).json({ success: false, error: 'Match not found' });
    }
    
    if (match.adminToken !== adminToken) {
      return res.status(403).json({ success: false, error: 'Invalid admin token' });
    }
    
    if (score) match.score = score;
    if (playerOfMatch) match.playerOfMatch = playerOfMatch;
    if (teamOfDay) match.teamOfDay = teamOfDay;
    if (status) match.status = status;
    if (commentarySounds !== undefined) match.commentarySounds = commentarySounds;
    if (musicUrl !== undefined) match.musicUrl = musicUrl;
    if (musicTitle !== undefined) match.musicTitle = musicTitle;
    
    saveData(data);
    
    res.json({ success: true, match });
    
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Admin: Generate reel
app.post('/api/matches/:matchId/generate', async (req, res) => {
  const { matchId } = req.params;
  const { adminToken } = req.body;
  
  try {
    const data = loadData();
    const match = data.matches[matchId];
    
    if (!match) {
      return res.status(404).json({ success: false, error: 'Match not found' });
    }
    
    if (match.adminToken !== adminToken) {
      return res.status(403).json({ success: false, error: 'Invalid admin token' });
    }
    
    if (match.clips.length === 0) {
      return res.status(400).json({ success: false, error: 'No clips to process' });
    }
    
    // Update status
    match.status = 'processing';
    saveData(data);
    
    // Send immediate response FIRST
    res.json({
      success: true,
      message: 'Reel generation started',
      estimatedTime: '2-5 minutes'
    });
    
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
  
  // Process video in background (AFTER response sent)
  // Use setImmediate to ensure this runs after response is fully sent
  setImmediate(async () => {
    try {
      const VideoProcessor = require('./videoProcessor');
      const processor = new VideoProcessor(UPLOADS_DIR, OUTPUT_DIR);
      const data = loadData();
      const match = data.matches[matchId];
      
      const result = await processor.createReel(matchId, match);
      
      const freshData = loadData();
      freshData.matches[matchId].status = 'complete';
      freshData.matches[matchId].reelFilename = result.filename;
      freshData.matches[matchId].reelPath = result.outputPath;
      saveData(freshData);
      console.log(`✅ Reel complete for match ${matchId}`);
    } catch (err) {
      console.error(`❌ Reel failed for match ${matchId}:`, err);
      try {
        const freshData = loadData();
        freshData.matches[matchId].status = 'failed';
        freshData.matches[matchId].error = err.message;
        saveData(freshData);
      } catch (e) {
        console.error('Failed to save error status:', e);
      }
    }
  });
});

// Public: Generate reel (called after payment from reel page)
app.post('/api/matches/:matchId/generate-public', async (req, res) => {
  const { matchId } = req.params;
  
  try {
    const data = loadData();
    const match = data.matches[matchId];
    
    if (!match) {
      return res.status(404).json({ success: false, error: 'Match not found' });
    }
    
    // Must be unlocked (paid) to generate
    if (!match.unlocked) {
      return res.status(403).json({ success: false, error: 'Payment required' });
    }
    
    // Already complete?
    if (match.status === 'complete' && match.reelFilename) {
      return res.json({ success: true, message: 'Already generated' });
    }
    
    // Already processing?
    if (match.status === 'processing') {
      return res.json({ success: true, message: 'Already processing' });
    }
    
    if (match.clips.length === 0) {
      return res.status(400).json({ success: false, error: 'No clips to process' });
    }
    
    // Update status
    match.status = 'processing';
    saveData(data);
    
    // Send response
    res.json({ success: true, message: 'Generation started' });
    
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
  
  // Process video in background
  setImmediate(async () => {
    try {
      const VideoProcessor = require('./videoProcessor');
      const processor = new VideoProcessor(UPLOADS_DIR, OUTPUT_DIR);
      const data = loadData();
      const match = data.matches[matchId];
      
      const result = await processor.createReel(matchId, match);
      
      const freshData = loadData();
      freshData.matches[matchId].status = 'complete';
      freshData.matches[matchId].reelFilename = result.filename;
      freshData.matches[matchId].reelPath = result.outputPath;
      saveData(freshData);
      console.log(`✅ Reel complete for match ${matchId}`);
    } catch (err) {
      console.error(`❌ Reel failed for match ${matchId}:`, err);
      try {
        const freshData = loadData();
        freshData.matches[matchId].status = 'failed';
        freshData.matches[matchId].error = err.message;
        saveData(freshData);
      } catch (e) {
        console.error('Failed to save error status:', e);
      }
    }
  });
});

// Upload POTM photo
const photoUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const matchDir = path.join(UPLOADS_DIR, req.params.matchId);
      if (!fs.existsSync(matchDir)) fs.mkdirSync(matchDir, { recursive: true });
      cb(null, matchDir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `potm-photo${ext}`);
    }
  }),
  fileFilter: (req, file, cb) => {
    cb(null, file.mimetype.startsWith('image/'));
  },
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB max
});

// Upload team photo (separate config with different filename)
const teamPhotoUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const matchDir = path.join(UPLOADS_DIR, req.params.matchId);
      if (!fs.existsSync(matchDir)) fs.mkdirSync(matchDir, { recursive: true });
      cb(null, matchDir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `team-photo${ext}`);
    }
  }),
  fileFilter: (req, file, cb) => {
    cb(null, file.mimetype.startsWith('image/'));
  },
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB max
});

app.post('/api/matches/:matchId/potm-photo', photoUpload.single('photo'), (req, res) => {
  try {
    const { matchId } = req.params;
    const { adminToken } = req.body;
    
    const data = loadData();
    const match = data.matches[matchId];
    
    if (!match) {
      return res.status(404).json({ success: false, error: 'Match not found' });
    }
    
    if (match.adminToken !== adminToken) {
      return res.status(403).json({ success: false, error: 'Invalid admin token' });
    }
    
    match.potmPhotoFilename = req.file.filename;
    saveData(data);
    
    res.json({ success: true, filename: req.file.filename });
    
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Upload team photo (admin)
app.post('/api/matches/:matchId/team-photo', teamPhotoUpload.single('photo'), (req, res) => {
  try {
    const { matchId } = req.params;
    const { adminToken } = req.body;
    
    const data = loadData();
    const match = data.matches[matchId];
    
    if (!match) {
      return res.status(404).json({ success: false, error: 'Match not found' });
    }
    
    if (match.adminToken !== adminToken) {
      return res.status(403).json({ success: false, error: 'Invalid admin token' });
    }
    
    match.teamPhotoFilename = req.file.filename;
    saveData(data);
    
    res.json({ success: true, filename: req.file.filename });
    
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Upload team photo (public - from parent upload page)
app.post('/api/matches/:matchId/team-photo-public', teamPhotoUpload.single('photo'), (req, res) => {
  try {
    const { matchId } = req.params;
    
    const data = loadData();
    const match = data.matches[matchId];
    
    if (!match) {
      return res.status(404).json({ success: false, error: 'Match not found' });
    }
    
    // Only accept if no team photo yet
    if (!match.teamPhotoFilename) {
      match.teamPhotoFilename = req.file.filename;
      saveData(data);
    }
    
    res.json({ success: true, filename: req.file.filename });
    
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POTM nomination (public - from parent upload page)
app.post('/api/matches/:matchId/potm-nomination', express.json(), (req, res) => {
  try {
    const { matchId } = req.params;
    const { nomination } = req.body;
    
    if (!nomination?.trim()) {
      return res.status(400).json({ success: false, error: 'Nomination required' });
    }
    
    const data = loadData();
    const match = data.matches[matchId];
    
    if (!match) {
      return res.status(404).json({ success: false, error: 'Match not found' });
    }
    
    // Initialize nominations array if needed
    if (!match.potmNominations) {
      match.potmNominations = [];
    }
    
    // Add nomination
    match.potmNominations.push({
      name: nomination.trim(),
      nominatedAt: new Date().toISOString()
    });
    
    saveData(data);
    
    res.json({ success: true, message: 'Nomination recorded' });
    
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Unlock reel (after Stripe payment or voucher)
app.post('/api/matches/:matchId/unlock', (req, res) => {
  try {
    const { matchId } = req.params;
    const { paymentId, unlockedBy, voucherCode } = req.body;
    
    const data = loadData();
    const match = data.matches[matchId];
    
    if (!match) {
      return res.status(404).json({ success: false, error: 'Match not found' });
    }
    
    // If voucher code provided, validate and use it
    if (voucherCode) {
      const upperCode = voucherCode.toUpperCase().trim();
      const voucherData = loadVouchers();
      const voucher = voucherData.vouchers[upperCode];
      
      if (!voucher) {
        return res.status(400).json({ success: false, error: 'Invalid voucher code' });
      }
      
      if (voucher.maxUses && voucher.uses >= voucher.maxUses) {
        return res.status(400).json({ success: false, error: 'Voucher has expired' });
      }
      
      // Mark voucher as used
      voucher.uses = (voucher.uses || 0) + 1;
      if (!voucher.usedOn) voucher.usedOn = [];
      voucher.usedOn.push({ matchId, usedAt: new Date().toISOString() });
      saveVouchers(voucherData);
      
      match.voucherUsed = upperCode;
    } else {
      // TODO: Verify payment with Stripe
      match.paymentId = paymentId;
    }
    
    match.unlocked = true;
    match.unlockedAt = new Date().toISOString();
    match.unlockedBy = unlockedBy || 'A supporter';
    
    saveData(data);
    
    res.json({ success: true, message: 'Reel unlocked!' });
    
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get reel status
app.get('/api/matches/:matchId/status', (req, res) => {
  try {
    const data = loadData();
    const match = data.matches[req.params.matchId];
    
    if (!match) {
      return res.status(404).json({ success: false, error: 'Match not found' });
    }
    
    res.json({
      success: true,
      status: match.status,
      reelFilename: match.reelFilename || null,
      error: match.error || null
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Download completed reel
app.get('/api/matches/:matchId/download', (req, res) => {
  try {
    const data = loadData();
    const match = data.matches[req.params.matchId];
    
    if (!match) {
      return res.status(404).json({ success: false, error: 'Match not found' });
    }
    
    if (match.status !== 'complete' || !match.reelPath) {
      return res.status(400).json({ success: false, error: 'Reel not ready yet' });
    }
    
    if (!fs.existsSync(match.reelPath)) {
      return res.status(404).json({ success: false, error: 'Reel file not found' });
    }
    
    res.download(match.reelPath, `${match.teamName}-vs-${match.opponent}-highlights.mp4`);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Generate match poster
app.post('/api/matches/:matchId/poster', async (req, res) => {
  try {
    const { matchId } = req.params;
    const { adminToken } = req.body;
    
    const data = loadData();
    const match = data.matches[matchId];
    
    if (!match || match.adminToken !== adminToken) {
      return res.status(403).json({ success: false, error: 'Invalid' });
    }
    
    const TemplateRenderer = require('./templateRenderer');
    const renderer = new TemplateRenderer();
    await renderer.init();
    
    const posterPath = path.join(OUTPUT_DIR, `${matchId}-poster.png`);
    const logoPath = match.teamLogo ? path.join(UPLOADS_DIR, 'logos', match.teamLogo) : null;
    const oppLogoPath = match.opponentLogo ? path.join(UPLOADS_DIR, 'logos', match.opponentLogo) : null;
    
    await renderer.renderIntro(match, posterPath, logoPath, oppLogoPath);
    await renderer.close();
    
    match.posterPath = posterPath;
    saveData(data);
    
    res.json({ success: true, posterPath });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Download poster
app.get('/api/matches/:matchId/poster/download', (req, res) => {
  try {
    const data = loadData();
    const match = data.matches[req.params.matchId];
    
    if (!match?.posterPath || !fs.existsSync(match.posterPath)) {
      return res.status(404).json({ success: false, error: 'Poster not found' });
    }
    
    res.download(match.posterPath, `${match.teamName}-vs-${match.opponent}-poster.png`);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Generate vertical (Instagram/TikTok) version
app.post('/api/matches/:matchId/generate-vertical', async (req, res) => {
  try {
    const { matchId } = req.params;
    const { adminToken } = req.body;
    
    const data = loadData();
    const match = data.matches[matchId];
    
    if (!match || match.adminToken !== adminToken) {
      return res.status(403).json({ success: false, error: 'Invalid' });
    }
    
    res.json({ success: true, message: 'Vertical video generation started' });
    
    // Process in background
    const VideoProcessor = require('./videoProcessor');
    const processor = new VideoProcessor(UPLOADS_DIR, OUTPUT_DIR);
    
    processor.createVerticalReel(matchId, match)
      .then((result) => {
        const data = loadData();
        data.matches[matchId].verticalReelFilename = result.filename;
        data.matches[matchId].verticalReelPath = result.outputPath;
        saveData(data);
        console.log(`✅ Vertical reel complete for match ${matchId}`);
      })
      .catch((err) => {
        console.error(`❌ Vertical reel failed:`, err);
      });
      
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Upload music file
const musicUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const matchDir = path.join(UPLOADS_DIR, req.params.matchId);
      if (!fs.existsSync(matchDir)) fs.mkdirSync(matchDir, { recursive: true });
      cb(null, matchDir);
    },
    filename: (req, file, cb) => {
      cb(null, 'background-music.mp3');
    }
  }),
  fileFilter: (req, file, cb) => {
    cb(null, file.mimetype.startsWith('audio/'));
  },
  limits: { fileSize: 20 * 1024 * 1024 } // 20MB max
});

app.post('/api/matches/:matchId/music', musicUpload.single('music'), (req, res) => {
  try {
    const { matchId } = req.params;
    const { adminToken } = req.body;
    
    const data = loadData();
    const match = data.matches[matchId];
    
    if (!match || match.adminToken !== adminToken) {
      return res.status(403).json({ success: false, error: 'Invalid' });
    }
    
    match.musicFilename = req.file.filename;
    saveData(data);
    
    res.json({ success: true, filename: req.file.filename });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============ VOUCHER SYSTEM ============

// Validate voucher code
app.post('/api/vouchers/validate', (req, res) => {
  try {
    const { code, matchId } = req.body;
    const upperCode = (code || '').toUpperCase().trim();
    
    const voucherData = loadVouchers();
    const voucher = voucherData.vouchers[upperCode];
    
    if (!voucher) {
      return res.json({ valid: false, error: 'Invalid voucher code' });
    }
    
    if (voucher.maxUses && voucher.uses >= voucher.maxUses) {
      return res.json({ valid: false, error: 'Voucher has expired' });
    }
    
    if (voucher.expiresAt && new Date(voucher.expiresAt) < new Date()) {
      return res.json({ valid: false, error: 'Voucher has expired' });
    }
    
    const basePrice = 3;
    const newPrice = voucher.discount === 100 ? 0 : Math.round(basePrice * (1 - voucher.discount / 100) * 100) / 100;
    
    res.json({
      valid: true,
      code: upperCode,
      discount: voucher.discount,
      newPrice,
      description: voucher.description
    });
    
  } catch (err) {
    res.status(500).json({ valid: false, error: err.message });
  }
});

// Admin: List all vouchers
app.get('/api/vouchers', (req, res) => {
  try {
    const voucherData = loadVouchers();
    res.json({ success: true, vouchers: voucherData.vouchers });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Admin: Create new voucher
app.post('/api/vouchers', (req, res) => {
  try {
    const { code, discount, maxUses, description, expiresAt } = req.body;
    const upperCode = (code || '').toUpperCase().trim();
    
    if (!upperCode || discount === undefined) {
      return res.status(400).json({ success: false, error: 'Code and discount required' });
    }
    
    const voucherData = loadVouchers();
    
    if (voucherData.vouchers[upperCode]) {
      return res.status(400).json({ success: false, error: 'Voucher code already exists' });
    }
    
    voucherData.vouchers[upperCode] = {
      discount: parseInt(discount),
      maxUses: maxUses ? parseInt(maxUses) : null,
      uses: 0,
      description: description || '',
      expiresAt: expiresAt || null,
      createdAt: new Date().toISOString()
    };
    
    saveVouchers(voucherData);
    
    res.json({ success: true, voucher: voucherData.vouchers[upperCode] });
    
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Use a voucher (called when unlocking with voucher)
app.post('/api/vouchers/use', (req, res) => {
  try {
    const { code, matchId } = req.body;
    const upperCode = (code || '').toUpperCase().trim();
    
    const voucherData = loadVouchers();
    const voucher = voucherData.vouchers[upperCode];
    
    if (!voucher) {
      return res.json({ success: false, error: 'Invalid voucher' });
    }
    
    voucher.uses = (voucher.uses || 0) + 1;
    if (!voucher.usedOn) voucher.usedOn = [];
    voucher.usedOn.push({ matchId, usedAt: new Date().toISOString() });
    
    saveVouchers(voucherData);
    
    res.json({ success: true });
    
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Generate and serve OG image
app.get('/og-image.png', async (req, res) => {
  try {
    const ogImagePath = path.join(OUTPUT_DIR, 'og-image.png');
    
    // Generate if doesn't exist
    if (!fs.existsSync(ogImagePath)) {
      const puppeteer = require('puppeteer');
      const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
      const page = await browser.newPage();
      await page.setViewport({ width: 1200, height: 630 });
      await page.goto(`file://${path.join(__dirname, '../public/og-image.html')}`, { waitUntil: 'networkidle0' });
      await page.screenshot({ path: ogImagePath, type: 'png' });
      await browser.close();
    }
    
    res.sendFile(ogImagePath);
  } catch (err) {
    console.error('OG image error:', err);
    res.status(500).send('Error generating image');
  }
});

// ============ STRIPE CHECKOUT ============

// Create Stripe checkout session
app.post('/api/checkout', async (req, res) => {
  try {
    const { matchId, voucherCode } = req.body;
    
    const data = loadData();
    const match = data.matches[matchId];
    
    if (!match) {
      return res.status(404).json({ success: false, error: 'Match not found' });
    }
    
    if (match.unlocked) {
      return res.status(400).json({ success: false, error: 'Already unlocked' });
    }
    
    // Calculate price (apply voucher if provided)
    let price = 300; // £3 in pence
    let discountApplied = null;
    
    if (voucherCode) {
      const voucherData = loadVouchers();
      const voucher = voucherData.vouchers[voucherCode.toUpperCase()];
      
      if (voucher && voucher.uses < (voucher.maxUses || Infinity)) {
        if (voucher.discount === 100) {
          // Free - shouldn't reach Stripe, handle client-side
          return res.status(400).json({ success: false, error: 'Use voucher unlock for 100% discount' });
        }
        price = Math.round(price * (1 - voucher.discount / 100));
        discountApplied = voucher.discount;
      }
    }
    
    // Get the base URL from the request
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'gbp',
          product_data: {
            name: `Match Highlights - ${match.teamName} vs ${match.opponent}`,
            description: `${match.clips?.length || 0} clips • ${formatDateSimple(match.matchDate)}`,
            images: [], // Could add OG image here
          },
          unit_amount: price,
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${baseUrl}/reel/${matchId}?paid=true`,
      cancel_url: `${baseUrl}/reel/${matchId}?cancelled=true`,
      metadata: {
        matchId,
        voucherCode: voucherCode || '',
        discountApplied: discountApplied || ''
      },
      // Collect customer email for receipt
      customer_creation: 'always',
      billing_address_collection: 'auto',
    });
    
    res.json({ success: true, sessionId: session.id, url: session.url });
    
  } catch (err) {
    console.error('Checkout error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

function formatDateSimple(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// OG image for upload page
app.get('/og-upload.png', async (req, res) => {
  try {
    const ogImagePath = path.join(OUTPUT_DIR, 'og-upload.png');
    
    if (!fs.existsSync(ogImagePath)) {
      const puppeteer = require('puppeteer');
      const chromiumPaths = [
        process.env.PUPPETEER_EXECUTABLE_PATH,
        process.env.CHROMIUM_PATH,
        '/nix/var/nix/profiles/default/bin/chromium',
      ].filter(Boolean);
      let executablePath = null;
      for (const p of chromiumPaths) {
        if (fs.existsSync(p)) { executablePath = p; break; }
      }
      const browser = await puppeteer.launch({ headless: true, executablePath: executablePath || undefined, args: ['--no-sandbox'] });
      const page = await browser.newPage();
      await page.setViewport({ width: 1200, height: 630 });
      await page.goto(`file://${path.join(__dirname, '../public/og-upload.html')}`, { waitUntil: 'networkidle0' });
      await page.screenshot({ path: ogImagePath, type: 'png' });
      await browser.close();
    }
    
    res.sendFile(ogImagePath);
  } catch (err) {
    console.error('OG upload image error:', err);
    res.status(500).send('Error generating image');
  }
});

// OG image for reel page
app.get('/og-reel.png', async (req, res) => {
  try {
    const ogImagePath = path.join(OUTPUT_DIR, 'og-reel.png');
    
    if (!fs.existsSync(ogImagePath)) {
      const puppeteer = require('puppeteer');
      const chromiumPaths = [
        process.env.PUPPETEER_EXECUTABLE_PATH,
        process.env.CHROMIUM_PATH,
        '/nix/var/nix/profiles/default/bin/chromium',
      ].filter(Boolean);
      let executablePath = null;
      for (const p of chromiumPaths) {
        if (fs.existsSync(p)) { executablePath = p; break; }
      }
      const browser = await puppeteer.launch({ headless: true, executablePath: executablePath || undefined, args: ['--no-sandbox'] });
      const page = await browser.newPage();
      await page.setViewport({ width: 1200, height: 630 });
      await page.goto(`file://${path.join(__dirname, '../public/og-reel.html')}`, { waitUntil: 'networkidle0' });
      await page.screenshot({ path: ogImagePath, type: 'png' });
      await browser.close();
    }
    
    res.sendFile(ogImagePath);
  } catch (err) {
    console.error('OG reel image error:', err);
    res.status(500).send('Error generating image');
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Diagnostic endpoint - check FFmpeg, memory, files
app.get('/api/diagnostic', async (req, res) => {
  const { execSync, spawn } = require('child_process');
  const results = {
    time: new Date().toISOString(),
    memory: process.memoryUsage(),
    ffmpeg: null,
    chromium: null,
    uploads: null,
    output: null,
    matches: null
  };
  
  // Check FFmpeg
  try {
    const ffmpegPath = process.platform === 'win32' 
      ? 'C:/Users/micha/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-8.0.1-full_build/bin/ffmpeg.exe'
      : '/usr/bin/ffmpeg';
    const version = execSync(`${ffmpegPath} -version 2>&1`).toString().split('\n')[0];
    results.ffmpeg = { status: 'ok', version, path: ffmpegPath };
  } catch (err) {
    results.ffmpeg = { status: 'error', error: err.message };
  }
  
  // Check Chromium (for Puppeteer)
  try {
    const chromium = execSync('which chromium || which google-chrome || echo "not found"').toString().trim();
    results.chromium = { status: chromium !== 'not found' ? 'ok' : 'error', path: chromium };
  } catch (err) {
    results.chromium = { status: 'error', error: err.message };
  }
  
  // Check uploads directory
  try {
    const uploads = fs.readdirSync(UPLOADS_DIR);
    results.uploads = { status: 'ok', count: uploads.length, items: uploads.slice(0, 10) };
  } catch (err) {
    results.uploads = { status: 'error', error: err.message };
  }
  
  // Check output directory  
  try {
    const output = fs.readdirSync(OUTPUT_DIR);
    results.output = { status: 'ok', count: output.length, items: output.slice(0, 10) };
  } catch (err) {
    results.output = { status: 'error', error: err.message };
  }
  
  // Check matches data
  try {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    const matchIds = Object.keys(data.matches || {});
    results.matches = { 
      status: 'ok', 
      count: matchIds.length,
      recent: matchIds.slice(-5).map(id => ({
        id,
        status: data.matches[id].status,
        team: data.matches[id].teamName,
        clips: (data.matches[id].clips || []).length
      }))
    };
  } catch (err) {
    results.matches = { status: 'error', error: err.message };
  }
  
  res.json(results);
});

// Start server
app.listen(PORT, () => {
  console.log(`
  ⚽ MatchReel server running!
  
  Local:   http://localhost:${PORT}
  
  Pages:
  - Home:   http://localhost:${PORT}/
  - Create: http://localhost:${PORT}/create
  `);
});
