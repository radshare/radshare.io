module.exports.register = (req, res) => {
    console.log(`Registering user: ${req.body.email}`);
    res.status(200);
    res.json({
        message : `User registered: ${req.body.email}`
    });
};

module.exports.login = (req, res) => {
    console.log(`Logging in user: ${req.body.email}`);
    res.status(200);
    res.json({
        message : `User logged in: ${req.body.email}`
    });
};