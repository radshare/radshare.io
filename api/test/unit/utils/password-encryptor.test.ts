import { expect } from "chai"
import {EncryptedPassword, PasswordEncryptor} from "../../../src/utils";

describe('PasswordEncryptor', () => {

	describe('encrypt', () => {

		it('should return hash and salt', () => {
			expect(PasswordEncryptor.encrypt('Hello world!')).to.have.keys('hash', 'salt');
		})
	})

	describe('validate', () => {

		it('should return true', () => {
			let password: string = 'Hello world!';
			let encrypted: EncryptedPassword = PasswordEncryptor.encrypt(password);

			expect(PasswordEncryptor.validate(password, encrypted)).to.eq(true);
		})
	})
})
