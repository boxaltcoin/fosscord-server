import { Config, ConnectedAccount, OrmUtils } from "@fosscord/util";
import fetch from "node-fetch";
import { BaseOIDConnection } from "./BaseOIDConnection";

export interface SteamConnectionUserInfo {
	steamid: string;
	username: string;
	name: string;
}

export class SteamConnection extends BaseOIDConnection {
	public apiKey: string | null;
	constructor() {
		super({
			id: "steam",
			identifier: "https://steamcommunity.com/openid"
		});
	}

	initCustom(): void {
		this.apiKey = Config.get().connections.steam.apiKey;
	}

	exchangeCode(claimedIdentifier: string): string {
		return claimedIdentifier.replace("https://steamcommunity.com/openid/id/", "");
	}

	async getUser(steamId: string): Promise<SteamConnectionUserInfo> {
		return new Promise((resolve, reject) => {
			fetch(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${this.apiKey}&steamids=${steamId}`)
				.then((res) => res.json())
				.then((res) => {
					if (!res.response || !res.response.players) return reject(new Error("Failed to get user info"));
					const user = res.response.players[0];
					resolve({
						steamid: user.steamid,
						username: user.personaname,
						name: user.realname
					} as SteamConnectionUserInfo);
				})
				.catch(reject);
		});
	}

	createConnection(userId: string, friend_sync: boolean, userInfo: SteamConnectionUserInfo): ConnectedAccount {
		return OrmUtils.mergeDeep(new ConnectedAccount(), {
			user_id: userId,
			external_id: userInfo.steamid,
			friend_sync: friend_sync,
			name: userInfo.username,
			revoked: false,
			show_activity: false,
			type: this.options.id,
			verified: true,
			visibility: 0,
			integrations: []
		});
	}
}
