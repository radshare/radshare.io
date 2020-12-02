const mongoose = require('mongoose');
const User = mongoose.model('User');

module.exports.settingsRead = (req, res) => {
    // If no user ID exists in the JWT return a 401
    if (!req.payload._id) {
        res.status(401).json({
            message: 'UnauthorizedError: private settings'
        });
    } else {
        // Otherwise continue
        console.log(req);
        User.findById(req.payload._id).exec(function (err, user) {
            console.log(user);
            res.status(200).json(user);
        });
    }
};
