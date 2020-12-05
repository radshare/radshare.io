import express, {ErrorRequestHandler, Express} from 'express';
import {Configuration} from "./config";
import cookieParser from "cookie-parser";
import passport from "passport";
import http, {Server} from 'http';
import jwt from "express-jwt";

class App {

	private readonly app: Express;

	private auth = jwt({
		secret: 'MY_SECRET', //don't keep!
		userProperty: 'payload',
	});

	constructor() {
		this.app = express();

		// Use Setup
		this.app.use(express.json());
		this.app.use(express.urlencoded({ extended: false }));
		this.app.use(cookieParser());
		this.app.use(passport.initialize());
	}

	public Setup(): Server {
		this.app.get('/settings', this.auth, (req, res) => {
			// If no user ID exists in the JWT return a 401
			if (!req.payload._id) {
				res.status(401).json({
					message: 'UnauthorizedError: private settings'
				});
			} else {
				// Otherwise continue
				User.findById(req.payload._id).exec(function (err, user) {
					res.status(200).json(user);
				});
			}
		})

		return http.createServer(this.app);
	}

	public Start() {
		let server = http.createServer(this.app);

		server.listen(Configuration.express.port, () => {
			console.log('Listening on port: ' + Configuration.express.port)
		});
	}

	private errorHandler: ErrorRequestHandler = (err, req, res, next) => {
		if (err.syscall !== 'listen') {
			throw err;
		}

		var bind = typeof Configuration.express.port === 'string'
			? 'Pipe ' + Configuration.express.port
			: 'Port ' + Configuration.express.port;

		// handle specific listen errors with friendly messages
		switch (err.code) {
			case 'EACCES':
				console.error(bind + ' requires elevated privileges');
				process.exit(1);
				break;
			case 'EADDRINUSE':
				console.error(bind + ' is already in use');
				process.exit(1);
				break;
			default:
				throw err;
		}
	};
}
