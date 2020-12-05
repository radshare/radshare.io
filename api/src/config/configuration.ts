export interface ExpressConfiguration {
	port: number
}

export class Configuration {

	public static get express(): ExpressConfiguration {
		let port: number = Number(process.env.PORT);
		return {
			port: isNaN(port) ? port : 3000
		}
	}
}
