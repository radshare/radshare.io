const mongoose = require('mongoose');

const roomSchema = new mongoose.Schema(
{
    relic: {
        type: String,
        required: true,
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
    creationDate: {
        type: Date,
        default: Date.now,
        expires: 7200,
        required: true
    },
    expirationDate: {
        type: Number,
        required: true
    },
    tenno: {
        type: String,
        required: true
    },
    roomCode: {
        type: String,
        required: true,
        unique: true
    }
});

roomSchema.methods.genRoomCode = function() {
    let forbiddenWords
        = new RegExp('(ASS.|.ASS|.CUM|CUM.|.JEW|JEW.' +
        '|.TIT|TIT.|.WOP|WOP.|.FAG|FAG.|.GAY|GAY.|SHIT|FUCK|CUNT|ANUS' +
        '|ANAL|ARSE|CLIT|COCK|C0CK|CRAP|DICK|D1CK|DYKE|GOOK|HOMO' +
        '|KIKE|PAKI|PISS|SLUT|SPIC|TWAT|WANK|PRICK|JIZZ|COON)');

    let result = Math.random().toString(36).substr(2,4).toUpperCase();
    if (result.match(forbiddenWords)){
        genRoomCode();
    }
    else{
        this.roomCode = result;
    }
};

mongoose.model('Room', roomSchema);
