import express, {ErrorRequestHandler, Express} from 'express';
import {Configuration} from "./config";
import cookieParser from "cookie-parser";
import passport from "passport";
import http, {Server} from 'http';
import jwt from "express-jwt";
import * as mongoose from "mongoose";
import {SettingsController} from "./controllers";

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

	public Routes(): Express {
		this.app.get('/settings',
			jwt({
				secret: 'MY_SECRET', //don't keep!
				userProperty: 'payload',
			}),
			new SettingsController().get);


		return this.app;
	}

	public Setup(): Server {
		let server = http.createServer(this.app);

		server.on("listening", () => {
			console.log('Listening on port: ' + Configuration.express.port)
		});

		return http.createServer(this.app);
	}
}
