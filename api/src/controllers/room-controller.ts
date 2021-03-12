import {Connection, Model} from "mongoose";
import {Request, Response} from 'express';
import {v4 as uuid} from "uuid";

import {IRoom, Models} from '../schema';

export class RoomController {

	private readonly room: Model<IRoom>;

	constructor(private readonly connection: Connection) {
		this.room = connection.model<IRoom>(Models.ROOM);
	}

	public async post(req: any, res: Response): Promise<void> {
		const room = new this.room();
		room.relic = req.body.relic;
		room.quality = req.body.quality;
		room.platform = req.body.platform;
		room.expirationDate = Date.now() + 7200000;
		room.roomCode = uuid();
		room.tenno = req.body.tenno;

		try {
			let result: IRoom = await room.save();
			res.status(200);
			res.json({data : result});
		} catch (e) {
			console.error('Error saving room', e);
			res.status(500);
		}
	}

	public async get(req: Request, res: Response): Promise<void> {
		try {
			let result: IRoom[] = await this.room.find().exec();

			if(!result) {
				console.warn('Room not found for request', req);
				res.status(404);
				return;
			}

			res.status(200);
			res.json({
				data : result
			});
		} catch (e) {
			console.error('Error retrieving room list', e);
			res.status(500);
		}
	}

	public async put(req: any, res: Response): Promise<void> {
		try{
        	//this.room.updateOne()
		}
		catch(e){
			console.error('Room ID not in database')
		}
	}

}
