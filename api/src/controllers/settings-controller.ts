import mongoose from 'mongoose';
import {IUser} from "../schema/user";

export class SettingsController {

	constructor() {
	}

	public async get(req: any, res: any): Promise<void> {
		let User = mongoose.model<IUser>('User');
		// If no user ID exists in the JWT return a 401
		req.headers.authorization
		if (!req.payload._id) {
			res.status(401).json({
				message: 'UnauthorizedError: private settings'
			});
		} else {
			// Otherwise continue
			try {
				let user = await User.findById(req.payload._id).exec();
				res.status(200).json(user)
			} catch (e) {
			}
		}
	}
}
