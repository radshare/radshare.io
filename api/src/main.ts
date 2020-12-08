import express, {Express, Router} from 'express';
import cookieParser from "cookie-parser";
import passport from "passport";
import http, {Server} from 'http';
import jwt from "express-jwt";

import {Configuration} from "./config";
import {AuthenticationController, RoomController, SettingsController} from "./controllers";
import {MongoService} from "./services";
import {initialize} from "./config/passport";

class Api {

	private readonly mongoService: MongoService;

	private readonly authController: AuthenticationController;
	private readonly roomController: RoomController;
	private readonly app: Express;

	constructor() {
		try {
			this.mongoService = new MongoService();
			this.mongoService.DefineModels();
		} catch (e) {
			console.error(e)
			process.exit(1);
		}

		this.app = express();
		this.authController = new AuthenticationController(this.mongoService.connection);
		this.roomController = new RoomController(this.mongoService.connection);

		// Use Setup
		this.app.use(express.json());
		this.app.use(express.urlencoded({ extended: false }));
		this.app.use(cookieParser());
		this.app.use("/api", this.Routes());

		//	auth
		initialize(this.mongoService.connection)
		this.app.use(passport.initialize());

	}

	public Routes(): Router {
		let router: Router = express.Router();
		router.get('/settings',
			jwt({
				secret: 'MY_SECRET', //don't keep!
				userProperty: 'payload',
			}),
			new SettingsController().get);

		router.post('/register', this.authController.register);
		router.post('/login', this.authController.login);
		router.get('/register', this.authController.checkEmail);

		router.post('/home', this.roomController.post);
		router.get('/home', this.roomController.get);

		return router;
	}

	public async Start(): Promise<Server> {
		await this.mongoService.connect();

		let server = http.createServer(this.app);

		server.on("listening", () => {
			console.log('Listening on port: ' + Configuration.express.port)
		});

		return server.listen(Configuration.express.port);
	}
}

new Api().Start()
