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
		let room = new this.room();
		room.relic = req.body.relic;
		room.quality = req.body.quality;
		room.platform = req.body.platform;
		room.expirationDate = Date.now() + 7200000;
		room.roomCode = uuid();
		room.tenno.push({email: req.payload.email, username: req.payload.username});

		try {
			let result: IRoom = await room.save();
			res.status(200);
			res.json({data : result});
		} catch (e) {
			console.error('Error saving room', e);
			res.status(500);
		}
	}

	public async getAllRadshares(req: Request, res: Response): Promise<void> {
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

	public async putUser(req: any, res: Response): Promise<void> {
		try{
		    let userDetails = {email: req.payload.email, username: req.payload.username};
        	this.room.updateOne({id: req.body.id},
				{$push: {tenno: userDetails}});
        	res.status(200);
		}
		catch(e){
			console.error('Room ID not in database');
			res.status(500);
			res.json(e);
		}
	}

	public async getRoom(req: any, res: Response): Promise<void>{
		try{
			let result: IRoom | null = await this.room.findById(req.url.substring(6)).exec();
			if (!result){
				console.warn('Room not found for request', req);
				res.status(404);
				return;
			}
			else{
				res.status(200);
				res.json({
					result
				});
			}
		}
		catch(e){
			console.error('Room ID not in database');
			res.status(500);
			res.json(e);
		}
	}
}
