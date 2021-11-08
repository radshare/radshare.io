import {Model, Connection} from "mongoose";
import passport from "passport";
import {sign} from "jsonwebtoken";
import {Request, Response} from 'express';

import {IUser, Models} from "../schema";
import {EncryptedPassword, PasswordEncryptor} from "../utils";

export class AuthenticationController {

	private readonly User: Model<IUser>;

	constructor(connection: Connection) {
		this.User = connection.model<IUser>(Models.USER);
	}

	public async register(req: Request, res: Response): Promise<void> {
		const user = new this.User();

		user.username = req.body.username;
		user.email = req.body.email;

		let encrypted: EncryptedPassword = PasswordEncryptor.encrypt(req.body.password);
		user.salt = encrypted.salt;
		user.hash = encrypted.hash;

		try {
			let result = await user.save();

			res.status(200);
			res.json({
				token: this.generateToken(result)
			});
		} catch (e) {
			console.error('Error registering new user', e);
			res.status(500);
		}
	}

	public async login(req: Request, res: Response): Promise<void> {

		passport.authenticate('local', (err, user, info) => {
			// If Passport throws/catches an error
			if (err) {
				res.status(404).json(err);
				return;
			}

			// If a user is found
			if (user) {
				const token = this.generateToken(user);
				res.status(200);
				res.json({
					token: token
				});
			} else {
				// If user is not found
				res.status(401).json(info);
			}
		})(req, res);
	}

	public async checkEmail(req: Request, res: Response, next: Function): Promise<void> {
		try {
			let user: IUser|null = await this.User.findOne({email: req.query.email as string}, 'email -_id').exec();

			if (!user) {
				res.status(404);
			}

			res
				.status(200)
				.json(user);
		} catch (e) {
			console.error('Error checking email');
			return next(e)
		}
	}

	private generateToken(user: IUser): string {
		const expiry = new Date();
		expiry.setDate(expiry.getDate() + 7);

		return sign(
			{
				_id: user._id,
				email: user.email,
				username: user.username,
				exp: Math.round(expiry.getTime() / 1000)
			},
			'MY_SECRET'
		); // DO NOT KEEP YOUR SECRET IN THE CODE!
	}

	// Checks if the provided usr exists in the database
    public async checkTokenCredentials(req: any) {
		if (!req.payload._id) {
			return false
		}
		try {
			// Verify that the user ID exists in the database
			let user = await this.User.findById(req.payload._id).exec();
			return !!user;
		} catch (e) {
			console.error('User ID not in database', e);
			return false;
		}
	}
}
