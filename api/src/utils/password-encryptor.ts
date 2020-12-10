import Crypto from 'crypto'

export interface EncryptedPassword {
	salt: string,
	hash: string
}

export class PasswordEncryptor {

	public static encrypt(password: string): EncryptedPassword {
		let salt: string = Crypto.randomBytes(16).toString('hex');
		return {
			salt: salt,
			hash: Crypto
				.pbkdf2Sync(password, salt, 1000, 64, 'sha512')
				.toString('hex')
		}
	}

	public static validate(password: string, encryptedPassword: EncryptedPassword): boolean {
		const hash = Crypto
			.pbkdf2Sync(password, encryptedPassword.salt, 1000, 64, 'sha512')
			.toString('hex');
		return encryptedPassword.hash === hash;
	}
}
