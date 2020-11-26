const mongoose = require('mongoose');

const roomSchema = new mongoose.Schema({
    relic: {
        type: String,
        required: true
    },
    quality: {
        type: String,
        enum: ['intact', 'exceptional', 'flawless', 'radiant'],
        required: true
    },
    platform: {
        type: String,
        enum: ['pc', 'playstation', 'xbox', 'switch'],
        required: true
    },
    tenno: {
        type: String,
        required: true
    },
    expire_at: {type: Date, default: Date.now, expires: 7200},
    roomCode: {
        type: String,
        required: true,
        unique: true
    }
});

mongoose.model('Room', roomSchema);
