const mongoose = require('mongoose');
const Room = mongoose.model('Room');

module.exports.newRoom = (req, res) => {
    const room = new Room();
    room.relic = req.body.relic;
    room.quality = req.body.quality;
    room.platform = req.body.platform;
    room.expirationDate = Date.now() + 7200000;
    room.tenno = req.body.tenno;
    room.genRoomCode();

    room.save((err, data) => {
        if (err){
            console.error(err);
            res.status(500);
            res.json(err);
        }
        else{
            res.status(200);
            res.json({
                data : data
            });
        }
    });
};

module.exports.getRooms = (req, res) => {
    Room.find((err, data) => {
        if (err){
            console.error(err);
            res.status(500);
            res.json(err);
        }
        else{
            res.status(200);
            res.json({
                data : data
            });
        }
    });
};
