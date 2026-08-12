const express = require('express');
const { query } = require('../db');
const bansRouter = require('./bans');
const blocklistRouter = require('./blocklist');
const router = express.Router();

router.use('/bans', bansRouter);
router.use('/blocklist', blocklistRouter);

module.exports = router;
