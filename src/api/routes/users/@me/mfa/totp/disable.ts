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

import { Router, Request, Response } from "express";
import { route } from "@fosscord/api";
import { verifyToken } from "node-2fa";
import { HTTPError } from "lambert-server";
import {
	User,
	generateToken,
	BackupCode,
	TotpDisableSchema,
} from "@fosscord/util";

const router = Router();

router.post(
	"/",
	route({ body: "TotpDisableSchema" }),
	async (req: Request, res: Response) => {
		const body = req.body as TotpDisableSchema;

		const user = await User.findOneOrFail({
			where: { id: req.user_id },
			select: ["totp_secret"],
		});

		const backup = await BackupCode.findOne({ where: { code: body.code } });
		if (!backup) {
			const ret = verifyToken(user.totp_secret || "", body.code);
			if (!ret || ret.delta != 0)
				throw new HTTPError(
					req.t("auth:login.INVALID_TOTP_CODE"),
					60008,
				);
		}

		await User.update(
			{ id: req.user_id },
			{
				mfa_enabled: false,
				totp_secret: "",
			},
		);

		await BackupCode.update(
			{ user: { id: req.user_id } },
			{
				expired: true,
			},
		);

		return res.json({
			token: await generateToken(user.id),
		});
	},
);

export default router;
