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
	getDatabase,
	getPermission,
	listenEvent,
	Member,
	Role,
	Session,
	LazyRequestSchema,
} from "@fosscord/util";
import {
	WebSocket,
	Payload,
	handlePresenceUpdate,
	OPCODES,
	Send,
} from "@fosscord/gateway";
import { check } from "./instanceOf";

// TODO: only show roles/members that have access to this channel
// TODO: config: to list all members (even those who are offline) sorted by role, or just those who are online
// TODO: rewrite typeorm

async function getMembers(guild_id: string, range: [number, number]) {
	if (!Array.isArray(range) || range.length !== 2) {
		throw new Error("range is not a valid array");
	}
	// TODO: wait for typeorm to implement ordering for .find queries https://github.com/typeorm/typeorm/issues/2620

	let members: Member[] = [];
	try {
		members =
			(await getDatabase()
				?.getRepository(Member)
				.createQueryBuilder("member")
				.where("member.guild_id = :guild_id", { guild_id })
				.leftJoinAndSelect("member.roles", "role")
				.leftJoinAndSelect("member.user", "user")
				.leftJoinAndSelect("user.sessions", "session")
				.addSelect("user.settings")
				.addSelect(
					"CASE WHEN session.status = 'offline' THEN 0 ELSE 1 END",
					"_status",
				)
				.orderBy("role.position", "DESC")
				.addOrderBy("_status", "DESC")
				.addOrderBy("user.username", "ASC")
				.offset(Number(range[0]) || 0)
				.limit(Number(range[1]) || 100)
				.getMany()) ?? [];
	} catch (e) {
		console.error(`LazyRequest`, e);
	}

	if (!members) {
		return {
			items: [],
			groups: [],
			range: [],
			members: [],
		};
	}

	const groups = [];
	const items = [];
	const member_roles = members
		.map((m) => m.roles)
		.flat()
		.unique((r: Role) => r.id);
	member_roles.push(
		member_roles.splice(
			member_roles.findIndex((x) => x.id === x.guild_id),
			1,
		)[0],
	);

	const offlineItems = [];

	for (const role of member_roles) {
		const [role_members, other_members] = partition(
			members,
			(m: Member) => !!m.roles.find((r) => r.id === role.id),
		);
		const group = {
			count: role_members.length,
			id: role.id === guild_id ? "online" : role.id,
		};

		items.push({ group });
		groups.push(group);

		for (const member of role_members) {
			const roles = member.roles
				.filter((x: Role) => x.id !== guild_id)
				.map((x: Role) => x.id);

			const statusMap = {
				online: 0,
				idle: 1,
				dnd: 2,
				invisible: 3,
				offline: 4,
			};
			// sort sessions by relevance
			const sessions = member.user.sessions.sort((a, b) => {
				return (
					statusMap[a.status] -
					statusMap[b.status] +
					(a.activities.length - b.activities.length) * 2
				);
			});
			const session: Session | undefined = sessions.first();

			if (session?.status == "offline") {
				session.status = member?.user?.settings?.status || "online";
			}

			const item = {
				member: {
					...member,
					roles,
					user: member.user.toPublicUser(),
					presence: {
						...session,
						activities: session?.activities || [],
						user: { id: member.user.id },
					},
				},
			};

			if (
				!session ||
				session.status == "invisible" ||
				session.status == "offline"
			) {
				item.member.presence.status = "offline";
				offlineItems.push(item);
				group.count--;
				continue;
			}

			items.push(item);
		}
		members = other_members;
	}

	if (offlineItems.length) {
		const group = {
			count: offlineItems.length,
			id: "offline",
		};
		items.push({ group });
		groups.push(group);

		items.push(...offlineItems);
	}

	return {
		items,
		groups,
		range,
		members: items
			.map((x) =>
				"member" in x
					? { ...x.member, settings: undefined }
					: undefined,
			)
			.filter((x) => !!x),
	};
}

export async function onLazyRequest(this: WebSocket, { d }: Payload) {
	// TODO: check data
	check.call(this, LazyRequestSchema, d);
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	const { guild_id, typing, channels, activities } = d as LazyRequestSchema;
	if (!channels) throw new Error("Must provide channel ranges");

	const channel_id = Object.keys(channels || {}).first();
	if (!channel_id) return;

	const permissions = await getPermission(this.user_id, guild_id, channel_id);
	permissions.hasThrow("VIEW_CHANNEL");

	const ranges = channels[channel_id];
	if (!Array.isArray(ranges)) throw new Error("Not a valid Array");

	const member_count = await Member.count({ where: { guild_id } });
	const ops = await Promise.all(ranges.map((x) => getMembers(guild_id, x)));

	// TODO: unsubscribe member_events that are not in op.members

	ops.forEach((op) => {
		op.members.forEach(async (member) => {
			if (!member) return;
			if (this.events[member.user.id]) return; // already subscribed as friend
			if (this.member_events[member.user.id]) return; // already subscribed in member list
			this.member_events[member.user.id] = await listenEvent(
				member.user.id,
				handlePresenceUpdate.bind(this),
				this.listen_options,
			);
		});
	});

	const groups = ops
		.map((x) => x.groups)
		.flat()
		.unique();

	return await Send(this, {
		op: OPCODES.Dispatch,
		s: this.sequence++,
		t: "GUILD_MEMBER_LIST_UPDATE",
		d: {
			ops: ops.map((x) => ({
				items: x.items,
				op: "SYNC",
				range: x.range,
			})),
			online_count:
				member_count -
				(groups.find((x) => x.id == "offline")?.count ?? 0),
			member_count,
			id: "everyone",
			guild_id,
			groups,
		},
	});
}

/* https://stackoverflow.com/a/50636286 */
function partition<T>(array: T[], filter: (elem: T) => boolean) {
	const pass: T[] = [],
		fail: T[] = [];
	array.forEach((e) => (filter(e) ? pass : fail).push(e));
	return [pass, fail];
}
