const ctrlAuth = require('../controllers/authentication');
const ctrlProfile = require('../controllers/profile');

const express = require('express');
const router = express.Router();
const jwt = require('express-jwt');

const auth = jwt({
    secret: 'MY_SECRET', //don't keep!
    userProperty: 'payload',
});

// profile
router.get('/profile', auth, ctrlProfile.profileRead);

// authentication
router.post('/register', ctrlAuth.register);
router.post('/login', ctrlAuth.login);
router.get('/register', ctrlAuth.checkEmail);

module.exports = router;
