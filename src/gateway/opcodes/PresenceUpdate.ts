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

import { WebSocket, Payload } from "@fosscord/gateway";
import {
	emitEvent,
	PresenceUpdateEvent,
	Session,
	User,
	ActivitySchema,
} from "@fosscord/util";
import { check } from "./instanceOf";

export async function onPresenceUpdate(this: WebSocket, { d }: Payload) {
	check.call(this, ActivitySchema, d);
	const presence = d as ActivitySchema;

	await Session.update(
		{ session_id: this.session_id },
		{ status: presence.status, activities: presence.activities },
	);

	await emitEvent({
		event: "PRESENCE_UPDATE",
		user_id: this.user_id,
		data: {
			user: await User.getPublicUser(this.user_id),
			activities: presence.activities,
			client_status: {}, // TODO:
			status: presence.status,
		},
	} as PresenceUpdateEvent);
}
