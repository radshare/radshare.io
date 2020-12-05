import mongoose from 'mongoose';
import {IUser} from "../models/mongoose";

export class SettingsController {

	constructor() {
	}

	public get(req: any, res: any) {
		mongoose.model<IUser>('User').findById()
		// If no user ID exists in the JWT return a 401
		if (!req.payload._id) {
			res.status(401).json({
				message: 'UnauthorizedError: private settings'
			});
		} else {
			// Otherwise continue
			User.findById(req.payload._id).exec((err, user) => {
				res.status(200).json(user);
			});
		}
	}
}
