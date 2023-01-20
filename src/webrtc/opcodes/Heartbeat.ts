/*
	Fosscord: A FOSS re-implementation and extension of the Discord.com backend.
	Copyright (C) 2023 Fosscord and Fosscord Contributors
	
	This program is free software: you can redistribute it and/or modify
	it under the terms of the GNU Affero General Public License as published
	by the Free Software Foundation, either version 3 of the License, or
	(at your option) any later version.
	
	This program is distributed in the hope that it will be useful,
	but WITHOUT ANY WARRANTY; without even the implied warranty of
	MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
	GNU Affero General Public License for more details.
	
	You should have received a copy of the GNU Affero General Public License
	along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import {
	CLOSECODES,
	Payload,
	Send,
	setHeartbeat,
	WebSocket,
} from "@fosscord/gateway";
import { VoiceOPCodes } from "../util";

export async function onHeartbeat(this: WebSocket, data: Payload) {
	setHeartbeat(this);
	if (isNaN(data.d)) return this.close(CLOSECODES.Decode_error);

	await Send(this, { op: VoiceOPCodes.HEARTBEAT_ACK, d: data.d });
}
