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

import { WebSocket, Payload, CLOSECODES, OPCODES } from "@fosscord/gateway";
import OPCodeHandlers from "../opcodes";
import { check } from "../opcodes/instanceOf";
import WS from "ws";
import { PayloadSchema } from "@fosscord/util";
import * as Sentry from "@sentry/node";
import BigIntJson from "json-bigint";
import path from "path";
import fs from "fs/promises";
const bigIntJson = BigIntJson({ storeAsString: true });

let erlpack: { unpack: (buffer: Buffer) => Payload };
try {
	erlpack = require("@yukikaze-bot/erlpack");
} catch (error) {
	/* empty */
}

export async function Message(this: WebSocket, buffer: WS.Data) {
	// TODO: compression
	let data: Payload;

	if (
		(buffer instanceof Buffer && buffer[0] === 123) || // ASCII 123 = `{`. Bad check for JSON
		typeof buffer === "string"
	) {
		data = bigIntJson.parse(buffer.toString());
	} else if (this.encoding === "json" && buffer instanceof Buffer) {
		if (this.inflate) {
			try {
				buffer = this.inflate.process(buffer);
			} catch {
				buffer = buffer.toString();
			}
		}
		data = bigIntJson.parse(buffer as string);
	} else if (this.encoding === "etf" && buffer instanceof Buffer) {
		try {
			data = erlpack.unpack(buffer);
		} catch {
			return this.close(CLOSECODES.Decode_error);
		}
	} else return this.close(CLOSECODES.Decode_error);

	if (process.env.WS_VERBOSE)
		console.log(`[Websocket] Incomming message: ${JSON.stringify(data)}`);

	if (process.env.WS_DUMP) {
		const id = this.session_id || "unknown";

		await fs.mkdir(path.join("dump", id), { recursive: true });
		await fs.writeFile(
			path.join("dump", id, `${Date.now()}.in.json`),
			JSON.stringify(data, null, 2),
		);

		if (!this.session_id)
			console.log(
				"[Gateway] Unknown session id, dumping to unknown folder",
			);
	}

	check.call(this, PayloadSchema, data);

	const OPCodeHandler = OPCodeHandlers[data.op];
	if (!OPCodeHandler) {
		console.error("[Gateway] Unkown opcode " + data.op);
		// TODO: if all opcodes are implemented comment this out:
		// this.close(CLOSECODES.Unknown_opcode);
		return;
	}

	const transaction =
		data.op != 1
			? Sentry.startTransaction({
					op: OPCODES[data.op],
					name: `GATEWAY ${OPCODES[data.op]}`,
					data: {
						...data.d,
						token: data?.d?.token ? "[Redacted]" : undefined,
					},
			  })
			: undefined;

	try {
		const ret = await OPCodeHandler.call(this, data);
		Sentry.withScope((scope) => {
			scope.setSpan(transaction);
			scope.setUser({ id: this.user_id });
			transaction?.finish();
		});
		return ret;
	} catch (error) {
		Sentry.withScope((scope) => {
			scope.setSpan(transaction);
			if (this.user_id) scope.setUser({ id: this.user_id });
			Sentry.captureException(error);
		});
		transaction?.finish();
		console.error(`Error: Op ${data.op}`, error);
		// if (!this.CLOSED && this.CLOSING)
		return this.close(CLOSECODES.Unknown_error);
	}
}
