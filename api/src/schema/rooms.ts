import {Schema, Document} from "mongoose";

export interface IRoom extends Document {
	relic: string,
	quality: string,
	platform: string,
	creationDate: Date,
	expirationDate: number,
	tenno: Array<{email: string, username: string}>,
	roomCode: string
}

export class RoomSchema extends Schema<IRoom> {

	constructor() {
		super({
			relic: {
				type: String,
				required: true,
			},
			quality: {
				type: String,
				enum: ['intact', 'exceptional', 'flawless', 'radiant'],
				required: true
			},
			platform: {
				type: String,
				enum: ['pc', 'playstation', 'xbox', 'switch'],
				required: true
			},
			creationDate: {
				type: Date,
				default: Date.now,
				expires: 7200,
				required: true
			},
			expirationDate: {
				type: Number,
				required: true
			},
			tenno: [
				{email: {
					type: String,
					required: true,
					unique: true
				},
				username: {
					type: String,
					required: true
				}}
			]
			,
			roomCode: {
				type: String,
				required: true,
				unique: true
			}
		});
	}
}
