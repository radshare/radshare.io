const mongoose = require('mongoose');

const roomSchema = new mongoose.Schema({
    relic: {
        type: String,
        required: true
    },
    quality: {
        type: String,
        required: true
    },
    platform: {
        type: String,
        required: true
    },
    tenno: String,
    deadline: {
        type: Date,
        required: true
    },
    roomCode: {
        type: String,
        required: true
    }
});

mongoose.model('Room', roomSchema);
