require('./users');
require('./rooms');
const mongoose = require('mongoose');
const dbURI = 'mongodb+srv://radsharebot:jk8jLw62ktjnmWjt@rad01.vh9n4.mongodb.net/radshare?retryWrites=true&w=majority';

mongoose.set('useCreateIndex', true);
mongoose.connect(dbURI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
});

mongoose.connection.on('connected', () => {
    console.log(`Mongoose connected to ${dbURI}`);
});
mongoose.connection.on('error', (err) => {
    console.log(`Mongoose connection error: ${err}`);
});
mongoose.connection.on('disconnected', () => {
    console.log('Mongoose disconnected');
});
