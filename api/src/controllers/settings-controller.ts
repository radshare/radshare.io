import {Connection} from 'mongoose';
import {Response} from 'express';

import {IUser} from "../schema";

export class SettingsController {

	constructor(private readonly connection: Connection) {
	}

	public async get(req: any, res: Response): Promise<void> {
		let User = this.connection.model<IUser>('User');

		// If no user ID exists in the JWT return a 401
		if (!req.payload._id) {
			res.status(401).json({
				message: 'UnauthorizedError: private settings'
			});
			return
		}

		try {
			let user = await User.findById(req.payload._id).exec();
			res.status(200).json(user);
		} catch (e) {
			console.error('Error retrieving user settings', e)
		}
	}
}
