const ctrlAuth = require('../controllers/authentication');
const ctrlSettings = require('../controllers/settings');
const ctrlHomeTable = require('../controllers/homeTable');

const express = require('express');
const router = express.Router();
const jwt = require('express-jwt');

const auth = jwt({
    secret: 'MY_SECRET', //don't keep!
    userProperty: 'payload',
});

// settings
router.get('/settings', auth, ctrlSettings.settingsRead);

// authentication
router.post('/register', ctrlAuth.register);
router.post('/login', ctrlAuth.login);
router.get('/register', ctrlAuth.checkEmail);

// homeTable
router.post('/home', ctrlHomeTable.newRoom);
router.get('/home', ctrlHomeTable.getRooms);

module.exports = router;
