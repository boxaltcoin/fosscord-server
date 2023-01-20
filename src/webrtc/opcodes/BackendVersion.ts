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

import { Payload, Send, WebSocket } from "@fosscord/gateway";
import { VoiceOPCodes } from "../util";

export async function onBackendVersion(this: WebSocket, data: Payload) {
	await Send(this, {
		op: VoiceOPCodes.VOICE_BACKEND_VERSION,
		d: { voice: "0.8.43", rtc_worker: "0.3.26" },
	});
}
