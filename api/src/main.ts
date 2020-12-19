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
	private readonly settingsController: SettingsController;
	private readonly app: Express;

	constructor() {
		try {
			this.mongoService = new MongoService();
		} catch (e) {
			console.error(e)
			process.exit(1);
		}

		this.app = express();
		this.authController = new AuthenticationController(this.mongoService.connection);
		this.roomController = new RoomController(this.mongoService.connection);
		this.settingsController = new SettingsController(this.mongoService.connection);

		// Use Setup
		this.app.use(express.json());
		this.app.use(express.urlencoded({ extended: false }));
		this.app.use(express.static('/app/client/dist/client'));
		this.app.get('*', (req, res) => {
			res.sendFile('/app/client/dist/client/index.html')
		});
		this.app.use(cookieParser());
		this.app.use("/app/api", this.Routes());

		//	auth
		initialize(this.mongoService.connection)
		this.app.use(passport.initialize());

	}

	private Routes(): Router {
		let router: Router = express.Router();
		router.get('/settings',
			jwt({
				secret: 'MY_SECRET', //don't keep!
				userProperty: 'payload',
			}),
			(req, res) => this.settingsController.get(req, res));

		router.post('/register',
			(req, res) => this.authController.register(req, res));
		router.post('/login',
			(req, res) => this.authController.login(req, res));
		router.get('/register',
			(req, res, next) => this.authController.checkEmail(req, res, next));

		router.post('/home',
			(req, res) => this.roomController.post(req, res));
		router.get('/home',
			((req, res) => this.roomController.get(req, res)));

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

let api = new Api();
api.Start()
