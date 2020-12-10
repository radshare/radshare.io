import passport from "passport";
import {Strategy} from "passport-local";
import {IUser, Models} from "../schema";
import {PasswordEncryptor} from "../utils";
import {Connection} from "mongoose";

export class AuthenticationService {

	private readonly authenticator: passport.Authenticator;

	constructor(connection: Connection) {
		const User = connection.model<IUser>(Models.USER);

		this.authenticator = new passport.Authenticator()
			.use(new Strategy(
				{
					usernameField: 'email'
				},
				async (username: string, password: string, done: any) => {

					try {
						let user: IUser|null = await User.findOne({ email: username }).exec();

						if(!user) {
							console.warn('Email does not exist')
							return done(null, false);
						}

						if(!PasswordEncryptor.validate(password, {salt: user.salt, hash: user.hash})) {
							console.warn('Invalid password')
							return done(null, false);
						}

						return done(null, user);
					} catch (e) {
						console.error('Error validating user', e);
						return done(e)
					}
				}
			));
	}
}
