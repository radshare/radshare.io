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
			// Verify that the user ID exists in the database and return the cooresponding usenrame/email
			let user = await User.findById(req.payload._id, {email : 1, username : 1}).exec();
			console.log('Contents of user after database query: ', user);
			res.status(200).json(user);
		} catch (e) {
			console.error('Error retrieving user settings', e)
		}
	}
}
