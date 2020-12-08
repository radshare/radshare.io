import {Connection, Model} from "mongoose";
import {IRoom, Models} from "../schema";

import {v4 as uuid} from "uuid";

export class RoomController {

	private readonly room: Model<IRoom>;

	constructor(connection: Connection) {
		this.room = connection.model<IRoom>(Models.ROOM);
	}

	public async post(req, res): Promise<void> {
		const room = new this.room();
		room.relic = req.body.relic;
		room.quality = req.body.quality;
		room.platform = req.body.platform;
		room.expirationDate = Date.now() + 7200000;
		room.tenno = req.body.tenno;
		room.roomCode = uuid();

		try {
			let result: IRoom = await room.save();
			res.status(200);
			res.json({
				data : result
			});
		} catch (e) {
			console.error('Error saving room', e);
			res.status(500);
		}
	}

	public async get(req, res): Promise<void> {
		try {
			let result: IRoom[] = await this.room.find().exec();
			res.status(200);
			res.json({
				data : result
			});
		} catch (e) {
			console.error('Error retrieving room list', e);
			res.status(500);
		}
	}
}
