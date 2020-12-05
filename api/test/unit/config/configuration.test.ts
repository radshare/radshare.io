import { expect } from "chai";
import {Configuration} from "../../../src/config";

describe('Configuration', () => {
	it('should load express variables', () => {
		let port  = 8080;
		let host = 'localhost';

		process.env.PORT = String(port);
		process.env.HOST = host;

		expect(Configuration.express).to.include({port: port, host: host})
	})
})
