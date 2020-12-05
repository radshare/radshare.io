import {expect} from "chai";
import {Configuration} from "../../../src/config";

describe('Configuration', () => {
	it('should load express env variables', () => {
		let port  = 8080;
		let host = 'localhost';

		process.env.PORT = String(port);

		expect(Configuration.express).to.include({port: port})
	})

	it('should load express default variables', () => {

		process.env.PORT = 'this should not work';

		expect(Configuration.express).to.include({port: 3000})
	})
})
