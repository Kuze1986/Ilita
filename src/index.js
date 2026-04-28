require('dotenv').config();
const express = require('express');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const ilitaRoutes = require('./routes/ilita');
const { startScheduler } = require('./utils/scheduler');

// ============================================================
// VALIDATION
// ============================================================

const required = ['ANTHROPIC_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'INTERNAL_API_KEY'];
const missing = required.filter(key => !process.env[key]);

if (missing.length > 0) {
  console.error('[ilita] Missing required environment variables:', missing.join(', '));
  process.exit(1);
}

// ============================================================
// APP
// ============================================================

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json({ limit: '2mb' }));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'ilita-chat.html'));
});

// Routes
app.use('/ilita', ilitaRoutes);

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('[ilita] Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ============================================================
// START
// ============================================================

app.listen(PORT, () => {
  console.log(`[ilita] ilita-core running on port ${PORT}`);
  console.log(`[ilita] Environment: ${process.env.NODE_ENV || 'development'}`);

  // Start scheduled cycles
  startScheduler();

  console.log('[ilita] She is awake.');
});

module.exports = app;
