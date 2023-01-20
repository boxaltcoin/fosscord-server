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
	checkToken,
	Intents,
	Member,
	ReadyEventData,
	User,
	Session,
	EVENTEnum,
	Config,
	PublicUser,
	PrivateUserProjection,
	ReadState,
	Application,
	emitEvent,
	SessionsReplace,
	PrivateSessionProjection,
	MemberPrivateProjection,
	PresenceUpdateEvent,
	IdentifySchema,
	DefaultUserGuildSettings,
	ReadyGuildDTO,
	Guild,
	PublicUserProjection,
	ReadyUserGuildSettingsEntries,
} from "@fosscord/util";
import { Send } from "../util/Send";
import { CLOSECODES, OPCODES } from "../util/Constants";
import { check } from "./instanceOf";
import { Recipient } from "@fosscord/util";

// TODO: user sharding
// TODO: check privileged intents, if defined in the config
// TODO: check if already identified

const getUserFromToken = async (token: string): Promise<string | null> => {
	try {
		const { jwtSecret } = Config.get().security;
		const { decoded } = await checkToken(token, jwtSecret);
		return decoded.id;
	} catch (e) {
		console.error(`[Gateway] Invalid token`, e);
		return null;
	}
};

export async function onIdentify(this: WebSocket, data: Payload) {
	clearTimeout(this.readyTimeout);

	// Check payload matches schema
	check.call(this, IdentifySchema, data.d);
	const identify: IdentifySchema = data.d;

	// Check auth
	// TODO: the checkToken call will fetch user, and then we have to refetch with different select
	// checkToken should be able to select what we want
	const user_id = await getUserFromToken(identify.token);
	if (!user_id) return this.close(CLOSECODES.Authentication_failed);
	this.user_id = user_id;

	// Check intents
	if (!identify.intents) identify.intents = 30064771071n; // TODO: what is this number?
	this.intents = new Intents(identify.intents);

	// TODO: actually do intent things.

	// Validate sharding
	if (identify.shard) {
		this.shard_id = identify.shard[0];
		this.shard_count = identify.shard[1];

		if (
			this.shard_count == null ||
			this.shard_id == null ||
			this.shard_id > this.shard_count ||
			this.shard_id < 0 ||
			this.shard_count <= 0
		) {
			// TODO: why do we even care about this?
			console.log(
				`[Gateway] Invalid sharding from ${user_id}: ${identify.shard}`,
			);
			return this.close(CLOSECODES.Invalid_shard);
		}
	}

	// Generate a new gateway session ( id is already made, just save it in db )
	const session = Session.create({
		user_id: this.user_id,
		session_id: this.session_id,
		status: identify.presence?.status || "online",
		client_info: {
			client: identify.properties.$device,
			os: identify.properties.os,
			version: 0,
		},
		activities: identify.presence?.activities, // TODO: validation
	});

	// Get from database:
	// * the current user,
	// * the users read states
	// * guild members for this user
	// * recipients ( dm channels )
	// * the bot application, if it exists
	const [, user, application, read_states, members, recipients] =
		await Promise.all([
			session.save(),

			// TODO: Refactor checkToken to allow us to skip this additional query
			User.findOneOrFail({
				where: { id: this.user_id },
				relations: ["relationships", "relationships.to", "settings"],
				select: [...PrivateUserProjection, "relationships"],
			}),

			Application.findOne({
				where: { id: this.user_id },
				select: ["id", "flags"],
			}),

			ReadState.find({
				where: { user_id: this.user_id },
				select: [
					"id",
					"channel_id",
					"last_message_id",
					"last_pin_timestamp",
					"mention_count",
				],
			}),

			Member.find({
				where: { id: this.user_id },
				select: {
					// We only want some member props
					...Object.fromEntries(
						MemberPrivateProjection.map((x) => [x, true]),
					),
					settings: true, // guild settings
					// We also only want some guild props
					// guild: {
					// 	id: true,
					// 	large: true,
					// 	// lazy: true,
					// 	member_count: true,
					// 	premium_subscription_count: true,
					// },
					guild: true,
				},
				relations: [
					"guild",
					"guild.channels",
					"guild.emojis",
					"guild.roles",
					"guild.stickers",
					"user",
					"roles",
				],
			}),

			Recipient.find({
				where: { user_id: this.user_id, closed: false },
				relations: [
					"channel",
					"channel.recipients",
					"channel.recipients.user",
				],
				select: {
					channel: {
						id: true,
						flags: true,
						// is_spam: true,	// TODO
						last_message_id: true,
						last_pin_timestamp: true,
						type: true,
						icon: true,
						name: true,
						owner_id: true,
						recipients: {
							// We only want public user data for each dm channel
							user: Object.fromEntries(
								PublicUserProjection.map((x) => [x, true]),
							),
						},
					},
				},
			}),
		]);

	const users: PublicUser[] = [];

	// Generate merged_members
	const merged_members = members.map((x) => {
		return [
			{
				...x,
				roles: x.roles.map((x) => x.id),
			},
		];
	});

	// Generate guilds list ( make them unavailable if user is bot )
	type GuildOrUnavailable =
		| { id: string; unavailable: true }
		| (Guild & { joined_at: Date; unavailable: false });

	const guilds: GuildOrUnavailable[] = members.map((x) => {
		if (user.bot) return { id: x.guild.id, unavailable: true };
		return { ...x.guild.toJSON(), joined_at: x.joined_at };
	});

	// Generate user_guild_settings
	// TODO: move this type somewhere?
	const user_guild_settings_entries: ReadyUserGuildSettingsEntries[] =
		members.map((x) => ({
			...DefaultUserGuildSettings,
			...x.settings,
			guild_id: x.guild_id,
			channel_overrides: Object.entries(
				x.settings.channel_overrides ?? {},
			).map((y) => ({
				...y[1],
				channel_id: y[0],
			})),
		}));

	// Generate dm channels from recipients list. Append recipients to `users` list
	const channels = recipients.map((x) => {
		const channelUsers = x.channel.recipients?.map((x) =>
			x.user.toPublicUser(),
		);
		if (channelUsers) users.push(...channelUsers);

		// Remove ourself from the list of other users in dm channel
		if (x.channel.isDm()) {
			x.channel.recipients = x.channel.recipients?.filter(
				(y) => y.id !== this.user_id,
			);
		}

		return x.channel;
	});

	// From user relationships ( friends ), also append to `users` list
	users.push(...user.relationships.map((x) => x.to.toPublicUser()));

	// Send SESSIONS_REPLACE and PRESENCE_UPDATE
	const allSessions = await Session.find({
		where: { user_id: this.user_id },
		select: PrivateSessionProjection,
	});

	await Promise.all([
		emitEvent({
			event: "SESSIONS_REPLACE",
			user_id: this.user_id,
			// We need to find all sessions for the current user
			data: allSessions,
		} as SessionsReplace),
		emitEvent({
			event: "PRESENCE_UPDATE",
			user_id: this.user_id,
			data: {
				user: user.toPublicUser(),
				activities: session.activities,
				client_status: session.client_info,
				status: session.status,
			},
		} as PresenceUpdateEvent),
	]);

	// Build READY

	read_states.forEach((x) => {
		x.id = x.channel_id;
	});

	const d: ReadyEventData = {
		v: 9,
		application: application
			? { id: application.id, flags: application.flags }
			: undefined,
		//@ts-ignore TODO
		user: user,
		user_settings: user.settings,
		guilds: guilds
			// This filter is kind of messy, but we're just telling
			// TS that the filter limits our guilds to the available type
			.filter(
				(
					guild,
				): guild is Guild & { joined_at: Date; unavailable: false } =>
					!guild.unavailable,
			)
			.map((x) => ({
				...new ReadyGuildDTO(x).toJSON(),
				joined_at: x.joined_at,
			})),
		relationships: user.relationships.map((x) => x.toPublicRelationship()),
		read_state: {
			entries: read_states,
			partial: false,
			// TODO: what is this magic number?
			// Isn't `version` referring to the number of changes since this obj was created?
			// Why do we send this specific version?
			version: 304128,
		},
		user_guild_settings: {
			entries: user_guild_settings_entries,
			partial: false,
			version: 642, // TODO: see above
		},
		private_channels: channels,
		session_id: this.session_id,
		country_code: user.settings.locale, // TODO: do ip analysis instead
		users: users.unique(),
		merged_members: merged_members,
		sessions: allSessions,

		consents: {
			personalization: {
				consented: false, // TODO
			},
		},
		experiments: [],
		guild_join_requests: [],
		connected_accounts: [],
		guild_experiments: [],
		geo_ordered_rtc_regions: [],
		api_code_version: 1,
		friend_suggestion_count: 0,
		analytics_token: "",
		tutorial: null,
		resume_gateway_url:
			Config.get().gateway.endpointClient ||
			Config.get().gateway.endpointPublic ||
			"ws://127.0.0.1:3001",
		session_type: "norma;", // TODO
	};

	// Send READY
	await Send(this, {
		op: OPCODES.Dispatch,
		t: EVENTEnum.Ready,
		s: this.sequence++,
		d,
	});

	// If we're a bot user, send GUILD_CREATE for each unavailable guild
	await Promise.all(
		guilds
			.filter(
				(x): x is { id: string; unavailable: true } => x.unavailable,
			)
			.map((x) =>
				Send(this, {
					op: OPCODES.Dispatch,
					t: EVENTEnum.GuildCreate,
					s: this.sequence++,
					d: x,
				})?.catch((e) =>
					console.error(`[Gateway] error when sending bot guilds`, e),
				),
			),
	);
}
