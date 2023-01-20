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

import { ConfigEntity } from "../entities/Config";
import fs from "fs/promises";
import syncFs from "fs";
import { ConfigValue } from "../config";

// TODO: yaml instead of json
const overridePath = process.env.CONFIG_PATH ?? "";

let config: ConfigValue;
let pairs: ConfigEntity[];

// TODO: use events to inform about config updates
// Config keys are separated with _

export const Config = {
	init: async function init() {
		if (config) return config;
		console.log("[Config] Loading configuration...");
		pairs = await ConfigEntity.find();
		config = pairsToConfig(pairs);
		// TODO: this overwrites existing config values with defaults.
		// we actually want to extend the object with new keys instead.
		// config = (config || {}).merge(new ConfigValue());
		// Object.assign(config, new ConfigValue());

		// If a config doesn't exist, create it.
		if (Object.keys(config).length == 0) config = new ConfigValue();

		if (process.env.CONFIG_PATH) {
			console.log(
				`[Config] Using config path from environment rather than database.`,
			);
			try {
				const overrideConfig = JSON.parse(
					await fs.readFile(overridePath, { encoding: "utf8" }),
				);
				config = overrideConfig.merge(config);
			} catch (error) {
				await fs.writeFile(
					overridePath,
					JSON.stringify(config, null, 4),
				);
			}
		}

		return this.set(config);
	},
	get: function get() {
		if (!config) {
			// If we haven't initialised the config yet, return default config.
			// Typeorm instantiates each entity once when initising database,
			// which means when we use config values as default values in entity classes,
			// the config isn't initialised yet and would throw an error about the config being undefined.

			return new ConfigValue();
		}

		return config;
	},
	set: function set(val: Partial<ConfigValue>) {
		if (!config || !val) return;
		config = val.merge(config);

		return applyConfig(config);
	},
};

function applyConfig(val: ConfigValue) {
	// TODO: typings
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	async function apply(obj: any, key = ""): Promise<any> {
		if (typeof obj === "object" && obj !== null)
			return Promise.all(
				Object.keys(obj).map((k) =>
					apply(obj[k], key ? `${key}_${k}` : k),
				),
			);

		let pair = pairs.find((x) => x.key === key);
		if (!pair) pair = new ConfigEntity();

		pair.key = key;
		pair.value = obj;
		return pair.save();
	}

	if (process.env.CONFIG_PATH)
		syncFs.writeFileSync(overridePath, JSON.stringify(val, null, 4));

	return apply(val);
}

function pairsToConfig(pairs: ConfigEntity[]) {
	// TODO: typings
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const value: any = {};

	pairs.forEach((p) => {
		const keys = p.key.split("_");
		let obj = value;
		let prev = "";
		let prevObj = obj;
		let i = 0;

		for (const key of keys) {
			if (!isNaN(Number(key)) && !prevObj[prev]?.length)
				prevObj[prev] = obj = [];
			if (i++ === keys.length - 1) obj[key] = p.value;
			else if (!obj[key]) obj[key] = {};

			prev = key;
			prevObj = obj;
			obj = obj[key];
		}
	});

	return value as ConfigValue;
}
