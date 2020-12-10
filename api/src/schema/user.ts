import {Document, Schema} from "mongoose";

export interface IUser extends Document {
	email: string,
	username: string,
	hash: string,
	salt: string
}

export class UserSchema extends Schema<IUser> {

	constructor() {
		super({
			email: {
				type: String,
				unique: true,
				required: true
			},
			username: {
				type: String,
				required: true
			},
			hash: String,
			salt: String
		});
	}
}
