import mongoose, {ClientSession, Connection} from "mongoose";
import {IRoom, IUser, Models, RoomSchema, UserSchema} from "../schema";

export class MongoService {

	private readonly _connection: Connection;
	private readonly uri: string;

	constructor() {
		if(!process.env.mongoURI) {
			throw Error('Invalid uri env variable');
		}
		this.uri = process.env.mongoURI;

		this._connection = mongoose.createConnection(this.uri, {
			useNewUrlParser: true,
			useUnifiedTopology: true,
			useCreateIndex: true
		});

		this._connection.model<IUser>(Models.USER, new UserSchema());
		this._connection.model<IRoom>(Models.ROOM, new RoomSchema());
	}

	public get connection(): Connection {
		return this._connection;
	}

	public async connect(): Promise<ClientSession> {
		try {
			return await this._connection.startSession();
		} catch (e) {
			console.error('Unable to connect to mongodb', e);
			throw new Error('Unable to connect to mongodb');
		}
	}

	public async disconnect(): Promise<void> {
		try {
			await this._connection.close()
		} catch (e) {
			console.error('Error closing connection', e)
		}
	}
}

