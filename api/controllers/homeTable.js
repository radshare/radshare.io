const mongoose = require('mongoose');
const Room = mongoose.model('Room');

module.exports.newRoom = (req, res) => {
    const user = new User();

    user.username = req.body.name;
    user.email = req.body.email;

    user.setPassword(req.body.password);

    user.save(() => {
        const token = user.generateJwt();
        res.status(200);
        res.json({
            token: token
        });
    });
};

module.exports.getRooms = (req, res) => {
    const user = new User();

    user.username = req.body.name;
    user.email = req.body.email;

    user.setPassword(req.body.password);

    user.save(() => {
        const token = user.generateJwt();
        res.status(200);
        res.json({
            token: token
        });
    });
};
