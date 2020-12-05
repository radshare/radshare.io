export interface ExpressConfiguration {
	host: string,
	port: number
}

export class Configuration {

	public static get express(): ExpressConfiguration {
		return {
			host: String(process.env.HOST),
			port: Number(process.env.PORT)
		}
	}
}
