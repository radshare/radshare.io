import {IUser, Models} from "../schema";
import {PasswordEncryptor} from "../utils";

import {Connection} from "mongoose";
import passport from "passport";
import {Strategy} from 'passport-local'

export function initialize(connection: Connection) {
	const User = connection.model<IUser>(Models.USER);

	passport.use(
		new Strategy(
			{
				usernameField: 'email'
			},
			async (username: string, password: string, done: any) => {

				try {
					let user: IUser|null = await User.findOne({ email: username }).exec();

					if(!user) {
						return done(null, false, {
							message: 'Email does not exist'
						});
					}

					if(!PasswordEncryptor.validate(password, {salt: user.salt, hash: user.hash})) {
						return done(null, false, {
							message: 'Invalid password'
						});
					}

					return done(null, user);
				} catch (e) {
					console.error('Error validating user', e);
					return done(e)
				}
			}
		)
	)
}
